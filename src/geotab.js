/**
 * geotab.js
 * Geotab MyGeotab API integration layer + add-in lifecycle entry point.
 */

// ── Geotab Add-in Namespace ──────────────────────────────────────────────────

geotab.addin.fleetMaintenance = function () {
  'use strict';

  let _api     = null;
  let _state   = null;
  let _elAddin = null;

  return {

    initialize: function (freshApi, freshState, initializeCallback) {
      _api     = freshApi;
      _state   = freshState;
      _elAddin = document.getElementById('fleetMaintenance');
      if (_state.translate) _state.translate(_elAddin || '');
      initializeCallback();
    },

    focus: function (freshApi, freshState) {
      _api   = freshApi;
      _state = freshState;
      if (_elAddin) _elAddin.style.display = 'block';
      if (window.app) window.app.init();
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

  const DIAG_ODOMETER     = 'DiagnosticOdometerAdjustmentId';
  const DIAG_ENGINE_HOURS = 'DiagnosticEngineHoursAdjustmentId';
  const POLL_INTERVAL_MS  = 30_000;

  let _api       = null;
  let _pollTimer = null;
  let _vehicles  = [];

  // ── Public ──────────────────────────────────────────────────────────────────

  const init = async (api) => {
    _api = api;

    if (!_api) {
      console.warn('GeotabIntegration: No API — running in demo mode.');
      await DataStore.connect(null);
      _startDemoMode();
      return;
    }

    _api.getSession(async function (session) {
      const databaseName = session.database;

      const dbEl = document.getElementById('currentDatabase');
      if (dbEl) dbEl.textContent = databaseName;

      await DataStore.connect(databaseName);

      try {
        await _loadVehicles();
        await _pollOdometers();
        _pollTimer = setInterval(_pollOdometers, POLL_INTERVAL_MS);
        _setSyncStatus(true);
      } catch (err) {
        console.error('GeotabIntegration: init failed.', err);
        _setSyncStatus(false);
      }
    });
  };

  const destroy = () => {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  };

  const getVehicles = () => _vehicles;

  // ── Load Vehicles ─────────────────────────────────────────────────────────

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

    if (window.app && typeof window.app.setVehicles === 'function') {
      window.app.setVehicles(_vehicles);
    }

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

  // ── Asset Data for Reminder Modal ─────────────────────────────────────────
  // Returns last odometer (mi), engine hours, and last maintenance date per vehicle.

  const getVehicleAssetData = async () => {
    if (!_api || !_vehicles.length) {
      return _vehicles.map(v => ({
        ...v, lastOdometer: null, lastEngineHours: null, lastMaintenanceDate: null,
      }));
    }

    const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const results = await Promise.all(_vehicles.map(async (vehicle) => {
      try {
        const [odomData, hoursData] = await Promise.all([
          _api.call('Get', {
            typeName: 'StatusData',
            search: {
              deviceSearch:     { id: vehicle.geotabId },
              diagnosticSearch: { id: DIAG_ODOMETER },
              fromDate,
            },
            resultsLimit: 1,
          }),
          _api.call('Get', {
            typeName: 'StatusData',
            search: {
              deviceSearch:     { id: vehicle.geotabId },
              diagnosticSearch: { id: DIAG_ENGINE_HOURS },
              fromDate,
            },
            resultsLimit: 1,
          }),
        ]);

        const completedWOs = DataStore.getWorkOrders()
          .filter(w => w.vehicle === vehicle.name && w.status === 'Completed')
          .sort((a, b) => new Date(b.date) - new Date(a.date));

        return {
          ...vehicle,
          lastOdometer:        odomData.length  ? Math.round(odomData[0].data  * 0.000621371) : null,
          lastEngineHours:     hoursData.length ? Math.round(hoursData[0].data / 3600)         : null,
          lastMaintenanceDate: completedWOs.length ? completedWOs[0].date : null,
        };
      } catch {
        return { ...vehicle, lastOdometer: null, lastEngineHours: null, lastMaintenanceDate: null };
      }
    }));

    return results;
  };

  // ── Odometer Polling ──────────────────────────────────────────────────────

  const _pollOdometers = async () => {
    if (!_api || !_vehicles.length) return;

    try {
      const trackedNames   = DataStore.getUniqueVehicles();
      const trackedDevices = _vehicles.filter(v => trackedNames.includes(v.name));

      if (!trackedDevices.length) { _updateSyncLabel(); return; }

      const promises = trackedDevices.map(device =>
        _api.call('Get', {
          typeName: 'StatusData',
          search: {
            deviceSearch:     { id: device.geotabId },
            diagnosticSearch: { id: DIAG_ODOMETER },
            fromDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          },
          resultsLimit: 1,
        }).then(res => ({
          vehicleName: device.name,
          odometer: res.length ? Math.round(res[0].data * 0.000621371) : null,
        })).catch(() => ({ vehicleName: device.name, odometer: null }))
      );

      const readings = await Promise.all(promises);

      let anyChanged = false;
      readings.forEach(({ vehicleName, odometer }) => {
        if (odometer !== null && DataStore.updateOdometer(vehicleName, odometer)) {
          anyChanged = true;
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

  // ── Triggered Reminder Notifications ─────────────────────────────────────

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

  // ── Status Helpers ────────────────────────────────────────────────────────

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

  // ── Demo Mode ─────────────────────────────────────────────────────────────

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

  return { init, destroy, getVehicles, getVehicleAssetData };

})();

// ── Standalone / GitHub Pages Fallback ───────────────────────────────────────

if (typeof geotab === 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (window.app) window.app.init();
    GeotabIntegration.init(null);
  });
}
