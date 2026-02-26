/**
 * geotab.js
 * Geotab MyGeotab API integration layer + add-in lifecycle entry point.
 *
 * - Uses the official geotab.addin namespace and initialize/focus/blur lifecycle
 * - Resolves the Geotab session to get the database name
 * - Passes the database name to DataStore.connect() so Firestore loads the right data
 * - Loads all real vehicles (Devices) from your database
 * - Polls live odometer (StatusData) every 30 seconds
 * - Detects triggered reminders and surfaces notifications
 * - Falls back gracefully when running outside MyGeotab
 */

// ── Geotab Add-in Namespace ──────────────────────────────────────────────────

geotab.addin.fleetMaintenance = function () {
  'use strict';

  let _api   = null;
  let _state = null;
  let _elAddin = null;

  // ── Return the add-in lifecycle object ──────────────────────────────────────

  return {

    initialize: function (freshApi, freshState, initializeCallback) {
      _api   = freshApi;
      _state = freshState;
      _elAddin = document.getElementById('fleetMaintenance');

      if (_state.translate) _state.translate(_elAddin || '');

      initializeCallback();
    },

    focus: function (freshApi, freshState) {
      _api   = freshApi;
      _state = freshState;

      if (_elAddin) _elAddin.style.display = 'block';

      // Initialize the UI shell first (renders with empty/default data)
      if (window.app) window.app.init();

      // Then resolve the Geotab session → connect Firestore → load real data
      GeotabIntegration.init(_api);
    },

    blur: function () {
      GeotabIntegration.destroy();
      if (_elAddin) _elAddin.style.display = 'none';
    },

  };
};

// ── GeotabIntegration Module ─────────────────────────────────────────────────

const GeotabIntegration = (() => {

  const ODOMETER_DIAGNOSTIC_ID = 'DiagnosticOdometerAdjustmentId';
  const POLL_INTERVAL_MS = 30_000;

  let _api        = null;
  let _pollTimer  = null;
  let _vehicles   = []; // { id, geotabId, name, licensePlate, make, year }

  // ── Public ──────────────────────────────────────────────────────────────────

  const init = async (api) => {
    _api = api;

    if (!_api) {
      console.warn('GeotabIntegration: No API — running in demo mode.');
      // Connect DataStore without a real database name — uses defaults
      await DataStore.connect(null);
      _startDemoMode();
      return;
    }

    // Resolve session to get the database name, then boot everything
    _api.getSession(async function (session) {
      const databaseName = session.database;

      // Update the database label if present in the HTML
      const dbEl = document.getElementById('currentDatabase');
      if (dbEl) dbEl.textContent = databaseName;

      // Connect DataStore to Firestore for this database
      // (DataStore.connect handles auth, doc creation, and loading data)
      await DataStore.connect(databaseName);

      // Now load vehicles from Geotab and start polling
      try {
        await _loadVehicles();
        await _pollOdometers();
        _pollTimer = setInterval(_pollOdometers, POLL_INTERVAL_MS);
        _setSyncStatus(true);
      } catch (err) {
        console.error('GeotabIntegration: Failed to load vehicles / poll odometers.', err);
        _setSyncStatus(false);
      }
    });
  };

  const destroy = () => {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  };

  const getVehicles = () => _vehicles;

  // ── Load Vehicles ────────────────────────────────────────────────────────────

  const _loadVehicles = async () => {
    const devices = await _api.call('Get', {
      typeName: 'Device',
      resultsLimit: 2000,
    });

    _vehicles = devices
      .filter(d => d.id && d.name && d.name !== 'Unknown')
      .map(d => ({
        id:           d.name,
        geotabId:     d.id,
        name:         d.name,
        licensePlate: d.licensePlate || '',
        make:         d.comment || '',
        year:         d.year || '',
      }));

    _vehicles.sort((a, b) => a.name.localeCompare(b.name));

    // Push real vehicles into the app vehicle picker
    if (window.app && typeof window.app.setVehicles === 'function') {
      window.app.setVehicles(_vehicles);
    }

    // Populate the vehicle filter dropdown in the reminders table
    const select = document.getElementById('vehicleFilter');
    if (select) {
      while (select.options.length > 1) select.remove(1);
      _vehicles.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = v.name + (v.licensePlate ? ` (${v.licensePlate})` : '');
        select.appendChild(opt);
      });
    }

    console.log(`GeotabIntegration: Loaded ${_vehicles.length} vehicles.`);
  };

  // ── Odometer Polling ─────────────────────────────────────────────────────────

  const _pollOdometers = async () => {
    if (!_api || !_vehicles.length) return;

    try {
      const trackedNames   = DataStore.getUniqueVehicles();
      const trackedDevices = _vehicles.filter(v => trackedNames.includes(v.name));

      if (!trackedDevices.length) {
        _updateSyncLabel();
        return;
      }

      const promises = trackedDevices.map(device =>
        _api.call('Get', {
          typeName: 'StatusData',
          search: {
            deviceSearch:     { id: device.geotabId },
            diagnosticSearch: { id: ODOMETER_DIAGNOSTIC_ID },
            fromDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          },
          resultsLimit: 1,
        }).then(results => ({
          vehicleName: device.name,
          // Geotab returns metres — convert to miles
          odometer: results.length ? Math.round(results[0].data * 0.000621371) : null,
        })).catch(() => ({ vehicleName: device.name, odometer: null }))
      );

      const readings = await Promise.all(promises);

      let anyChanged = false;
      readings.forEach(({ vehicleName, odometer }) => {
        if (odometer !== null) {
          const changed = DataStore.updateOdometer(vehicleName, odometer);
          if (changed) anyChanged = true;
        }
      });

      if (anyChanged && window.app) window.app.refreshAll();

      _checkForTriggeredReminders();
      _updateSyncLabel();

    } catch (err) {
      console.error('GeotabIntegration: Odometer poll failed.', err);
      _setSyncStatus(false);
    }
  };

  // ── Triggered Reminder Notifications ────────────────────────────────────────

  const _checkForTriggeredReminders = () => {
    const triggered = DataStore.getReminders()
      .filter(r => r.status === 'overdue' && !r.notified)
      .sort((a, b) =>
        ({ High: 0, Medium: 1, Low: 2 }[a.priority] ?? 1) -
        ({ High: 0, Medium: 1, Low: 2 }[b.priority] ?? 1)
      );

    if (triggered.length && window.app) {
      const r = triggered[0];
      window.app.showNotification(r, r.current - r.target);
      DataStore.updateReminder(r.id, { notified: true });
    }
  };

  // ── Status Helpers ───────────────────────────────────────────────────────────

  const _setSyncStatus = (connected) => {
    const el   = document.getElementById('syncLabel');
    const wrap = document.querySelector('.sync-status');
    if (!el) return;
    if (connected) {
      el.textContent = 'LIVE · Synced with Geotab';
      wrap && wrap.classList.remove('disconnected');
    } else {
      el.textContent = 'Disconnected';
      wrap && wrap.classList.add('disconnected');
    }
  };

  const _updateSyncLabel = () => {
    const el = document.getElementById('syncLabel');
    if (!el) return;
    el.textContent = 'LIVE · Synced just now';
    let secs = 0;
    const t = setInterval(() => {
      secs += 5;
      if (!el || secs >= 30) { clearInterval(t); return; }
      el.textContent = `LIVE · Synced ${secs}s ago`;
    }, 5000);
  };

  // ── Demo Mode ────────────────────────────────────────────────────────────────

  const _startDemoMode = () => {
    const el = document.getElementById('syncLabel');
    if (el) el.textContent = 'DEMO · Click 🔔 to simulate trigger';

    const bell = document.getElementById('notifBell');
    if (bell) {
      bell.title = 'Click to simulate a triggered odometer reminder';
      bell.addEventListener('click', () => {
        const overdue = DataStore.getReminders().find(r => r.status === 'overdue');
        if (overdue && window.app) {
          window.app.showNotification(overdue, overdue.current - overdue.target);
        }
      });
    }

    const dot = document.getElementById('notifDot');
    if (dot) dot.style.display = 'block';
  };

  return { init, destroy, getVehicles };

})();

// ── Standalone / GitHub Pages Fallback ───────────────────────────────────────
// When opened directly in a browser (not inside MyGeotab), geotab is undefined.
// We detect this and boot in demo mode using DOMContentLoaded.

if (typeof geotab === 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (window.app) window.app.init();
    GeotabIntegration.init(null);
  });
}
