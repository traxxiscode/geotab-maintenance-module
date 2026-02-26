/**
 * geotab.js
 * Geotab MyGeotab API integration layer.
 *
 * - Connects to the Geotab API via the addin initialize() callback
 * - Loads all real vehicles (Devices) from your database
 * - Polls live odometer (StatusData) every 30 seconds
 * - Detects triggered reminders and surfaces notifications
 * - Falls back to demo mode when running outside of MyGeotab
 */

const GeotabIntegration = (() => {

  const ODOMETER_DIAGNOSTIC_ID = 'DiagnosticOdometerAdjustmentId';
  const POLL_INTERVAL_MS = 30_000;

  let _api = null;
  let _pollTimer = null;
  let _vehicles = []; // { id, name, licensePlate, make, model, year }

  // ── Public ──────────────────────────────────────────────────────────────────

  const init = async (api) => {
    _api = api;

    if (!_api) {
      console.warn('GeotabIntegration: No API — running in demo mode.');
      _startDemoMode();
      return;
    }

    try {
      await _loadVehicles();
      await _pollOdometers();
      _pollTimer = setInterval(_pollOdometers, POLL_INTERVAL_MS);
      _setSyncStatus(true);
    } catch (err) {
      console.error('GeotabIntegration: Failed to initialise.', err);
      _setSyncStatus(false);
    }
  };

  const destroy = () => {
    if (_pollTimer) clearInterval(_pollTimer);
  };

  // Expose vehicle list so app.js picker can use real vehicles
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
        id:           d.name,           // use device name as our vehicle ID (e.g. "TRK-041")
        geotabId:     d.id,             // internal Geotab GUID for API calls
        name:         d.name,
        licensePlate: d.licensePlate || '',
        make:         d.vehicleIdentificationNumber ? _inferMake(d) : '',
        year:         d.year || '',
      }));

    // Sort alphabetically by name
    _vehicles.sort((a, b) => a.name.localeCompare(b.name));

    // Push real vehicles into the app picker
    if (window.app && typeof window.app.setVehicles === 'function') {
      window.app.setVehicles(_vehicles);
    }

    // Populate the vehicle filter dropdown in the reminders table
    const select = document.getElementById('vehicleFilter');
    if (select) {
      // Clear any existing options except "All Vehicles"
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
      const trackedNames = DataStore.getUniqueVehicles();
      const trackedDevices = _vehicles.filter(v => trackedNames.includes(v.name));

      if (!trackedDevices.length) {
        _updateSyncLabel();
        return;
      }

      const promises = trackedDevices.map(device =>
        _api.call('Get', {
          typeName: 'StatusData',
          search: {
            deviceSearch: { id: device.geotabId },
            diagnosticSearch: { id: ODOMETER_DIAGNOSTIC_ID },
            fromDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // last 2hrs
          },
          resultsLimit: 1,
        }).then(results => ({
          vehicleName: device.name,
          // Geotab returns odometer in metres — convert to miles
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
      .sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.priority] - { High: 0, Medium: 1, Low: 2 }[b.priority]));

    if (triggered.length && window.app) {
      const r = triggered[0];
      window.app.showNotification(r, r.current - r.target);
      DataStore.updateReminder(r.id, { notified: true });
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const _inferMake = (device) => {
    // Geotab doesn't always expose make directly — use comment/description if set
    return device.comment || '';
  };

  const _setSyncStatus = (connected) => {
    const el = document.getElementById('syncLabel');
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
    if (el) el.textContent = `LIVE · Synced just now`;
    // Reset to time-ago after 30s
    let secs = 0;
    const t = setInterval(() => {
      secs += 5;
      if (!el) { clearInterval(t); return; }
      if (secs >= 30) { clearInterval(t); return; }
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

// ── Geotab Add-in Entry Point ─────────────────────────────────────────────────
//
// MyGeotab automatically calls initialize(api, state, callback) when the
// add-in iframe loads. This is the official Geotab add-in contract.

var initialize = function (freshApi, state, callback) {
  DataStore.init();
  if (window.app) window.app.init();
  GeotabIntegration.init(freshApi || null);
  if (typeof callback === 'function') callback();
};

// ── Standalone / GitHub Pages fallback ───────────────────────────────────────
// When opened directly in a browser (not inside MyGeotab), geotab is undefined
// so we boot in demo mode automatically.

if (typeof geotab === 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    DataStore.init();
    if (window.app) window.app.init();
    GeotabIntegration.init(null);
  });
}
