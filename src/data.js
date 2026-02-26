/**
 * data.js
 * Data store for reminders and work orders.
 * Persists to Firestore under the current Geotab database's document.
 *
 * Key model:
 *   reminder.conditions  — array of { type: 'time'|'distance'|'engineHours', value, warn }
 *   reminder.vehicleStates — map of vehicleName → {
 *       lastMaintenanceDate,   // ISO date string — when this task was last done on this vehicle
 *       lastOdometer,          // odometer at last maintenance (miles)
 *       lastEngineHours,       // engine hours at last maintenance
 *       currentOdometer,       // latest live reading from Geotab
 *       currentEngineHours,    // latest live reading from Geotab
 *       status,                // 'scheduled' | 'due-soon' | 'overdue'
 *       notified,              // bool — alert has been surfaced to user
 *       triggeredBy,           // which condition type fired first
 *   }
 */

const DataStore = (() => {

  let _reminders    = [];
  let _workOrders   = [];
  let _woCounter    = 2000;
  let _rCounter     = 1;
  let _databaseName = null;
  let _docRef       = null;

  // ── Firestore ───────────────────────────────────────────────────────────────

  const connect = async (databaseName) => {
    if (!databaseName || !window.db) {
      console.warn('DataStore: Firestore not available — using in-memory store.');
      _loadDefaults();
      return;
    }

    _databaseName = databaseName;

    try {
      await _ensureAuth();

      const col  = window.db.collection('fleet_maintenance');
      const snap = await col.where('database_name', '==', databaseName).get();

      if (snap.empty) {
        _loadDefaults();
        const docRef = await col.add({
          database_name: databaseName,
          reminders:    _reminders,
          workOrders:   _workOrders,
          woCounter:    _woCounter,
          rCounter:     _rCounter,
          created_at:   firebase.firestore.FieldValue.serverTimestamp(),
          updated_at:   firebase.firestore.FieldValue.serverTimestamp(),
        });
        _docRef = docRef;
        console.log(`DataStore: Created document for "${databaseName}".`);
      } else {
        _docRef = snap.docs[0].ref;
        const data  = snap.docs[0].data();
        _reminders  = data.reminders  || [];
        _workOrders = data.workOrders || [];
        _woCounter  = data.woCounter  || 2000;
        _rCounter   = data.rCounter   || 1;
        console.log(`DataStore: Loaded data for "${databaseName}".`);
      }

      if (window.app && typeof window.app.refreshAll === 'function') {
        window.app.refreshAll();
      }
    } catch (err) {
      console.error('DataStore: Firestore connect error.', err);
      _loadDefaults();
    }
  };

  const _ensureAuth = () => new Promise((resolve, reject) => {
    firebase.auth().onAuthStateChanged(user => {
      if (user) resolve(user);
      else firebase.auth().signInAnonymously().then(resolve).catch(reject);
    });
  });

  const _persist = async () => {
    if (!_docRef) return;
    try {
      await _docRef.update({
        reminders:  _reminders,
        workOrders: _workOrders,
        woCounter:  _woCounter,
        rCounter:   _rCounter,
        updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error('DataStore: persist failed.', err);
    }
  };

  const _loadDefaults = () => {
    _reminders  = [];
    _workOrders = [];
    _woCounter  = 2000;
    _rCounter   = 1;
  };

  // ── Condition Evaluation ────────────────────────────────────────────────────
  //
  // Returns 'overdue' | 'due-soon' | 'scheduled' for a single vehicle state
  // against a reminder's conditions array.
  // The FIRST condition that is met (overdue or due-soon) wins.

  const evaluateConditions = (conditions, vState) => {
    let worstStatus = 'scheduled';

    for (const cond of conditions) {
      let status = 'scheduled';

      if (cond.type === 'distance') {
        const lastOdo   = vState.lastOdometer      || 0;
        const currentOdo = vState.currentOdometer  || lastOdo;
        const driven    = currentOdo - lastOdo;
        const remaining = cond.value - driven;
        if (remaining <= 0)          status = 'overdue';
        else if (remaining <= (cond.warn || 0)) status = 'due-soon';

      } else if (cond.type === 'engineHours') {
        const lastHrs    = vState.lastEngineHours   || 0;
        const currentHrs = vState.currentEngineHours || lastHrs;
        const used       = currentHrs - lastHrs;
        const remaining  = cond.value - used;
        if (remaining <= 0)          status = 'overdue';
        else if (remaining <= (cond.warn || 0)) status = 'due-soon';

      } else if (cond.type === 'time') {
        if (vState.lastMaintenanceDate) {
          const lastDate  = new Date(vState.lastMaintenanceDate);
          const nowDate   = new Date();
          const daysSince = Math.floor((nowDate - lastDate) / (1000 * 60 * 60 * 24));
          const remaining = cond.value - daysSince;
          if (remaining <= 0)          status = 'overdue';
          else if (remaining <= (cond.warn || 0)) status = 'due-soon';
        }
      }

      // First condition to hit overdue wins immediately
      if (status === 'overdue') return { status: 'overdue', triggeredBy: cond.type };
      if (status === 'due-soon') worstStatus = 'due-soon';
    }

    return { status: worstStatus, triggeredBy: worstStatus !== 'scheduled' ? conditions[0]?.type : null };
  };

  // ── Live Data Update (called by geotab.js on each poll) ─────────────────────
  //
  // Updates currentOdometer / currentEngineHours for a vehicle across all
  // reminders, re-evaluates conditions, and returns true if anything changed.

  const updateVehicleLiveData = (vehicleName, currentOdometer, currentEngineHours) => {
    let changed = false;

    _reminders.forEach(r => {
      const vehicles = Array.isArray(r.vehicles) ? r.vehicles : [r.vehicle].filter(Boolean);
      if (!vehicles.includes(vehicleName)) return;

      if (!r.vehicleStates) r.vehicleStates = {};
      const vs = r.vehicleStates[vehicleName] || {};

      // Update live readings
      if (currentOdometer    != null) vs.currentOdometer    = currentOdometer;
      if (currentEngineHours != null) vs.currentEngineHours = currentEngineHours;

      // Re-evaluate conditions
      const conditions = r.conditions || [];
      if (conditions.length > 0) {
        const { status, triggeredBy } = evaluateConditions(conditions, vs);
        const prevStatus = vs.status || 'scheduled';

        vs.status      = status;
        vs.triggeredBy = triggeredBy;

        // Reset notified if it went back to scheduled (e.g. after a WO is completed)
        if (status === 'scheduled' && prevStatus !== 'scheduled') {
          vs.notified = false;
        }
      }

      r.vehicleStates[vehicleName] = vs;
      changed = true;
    });

    if (changed) _persist();
    return changed;
  };

  // ── Reminder completed for one vehicle — reset its state ────────────────────
  // Called when a work order for a specific vehicle+reminder is marked complete.

  const resetVehicleReminderState = (reminderId, vehicleName, completionDate, completionOdometer, completionEngineHours) => {
    const r = _reminders.find(x => x.id === reminderId);
    if (!r) return;
    if (!r.vehicleStates) r.vehicleStates = {};

    r.vehicleStates[vehicleName] = {
      ...r.vehicleStates[vehicleName],
      lastMaintenanceDate: completionDate,
      lastOdometer:        completionOdometer  || r.vehicleStates[vehicleName]?.currentOdometer  || 0,
      lastEngineHours:     completionEngineHours || r.vehicleStates[vehicleName]?.currentEngineHours || 0,
      status:    'scheduled',
      notified:  false,
      triggeredBy: null,
    };

    _persist();
  };

  // ── Reminders ───────────────────────────────────────────────────────────────

  const getReminders = () => [..._reminders];
  const getReminder  = (id) => _reminders.find(r => r.id === id) || null;

  const addReminder = (data) => {
    const id = 'R' + String(_rCounter++).padStart(3, '0');
    const reminder = { id, ...data };
    _reminders.unshift(reminder);
    _persist();
    return reminder;
  };

  const updateReminder = (id, data) => {
    const idx = _reminders.findIndex(r => r.id === id);
    if (idx === -1) return null;
    _reminders[idx] = { ..._reminders[idx], ...data };
    _persist();
    return _reminders[idx];
  };

  const deleteReminder = (id) => {
    const idx = _reminders.findIndex(r => r.id === id);
    if (idx === -1) return false;
    _reminders.splice(idx, 1);
    _persist();
    return true;
  };

  // ── Work Orders ─────────────────────────────────────────────────────────────

  const getWorkOrders  = () => [..._workOrders];
  const getWorkOrder   = (id) => _workOrders.find(w => w.id === id) || null;

  const addWorkOrder = (data) => {
    const id = 'WO-' + (++_woCounter);
    const wo = { id, ...data };
    _workOrders.unshift(wo);
    _persist();
    return wo;
  };

  const updateWorkOrder = (id, data) => {
    const idx = _workOrders.findIndex(w => w.id === id);
    if (idx === -1) return null;
    _workOrders[idx] = { ..._workOrders[idx], ...data };
    _persist();
    return _workOrders[idx];
  };

  const deleteWorkOrder = (id) => {
    const idx = _workOrders.findIndex(w => w.id === id);
    if (idx === -1) return false;
    _workOrders.splice(idx, 1);
    _persist();
    return true;
  };

  // ── Stats ───────────────────────────────────────────────────────────────────

  const getReminderStats = () => {
    let overdue = 0, dueSoon = 0, scheduled = 0;

    _reminders.forEach(r => {
      const vehicles = Array.isArray(r.vehicles) ? r.vehicles : [r.vehicle].filter(Boolean);
      vehicles.forEach(v => {
        const vs = r.vehicleStates?.[v] || {};
        const s  = vs.status || r.status || 'scheduled';
        if (s === 'overdue')   overdue++;
        else if (s === 'due-soon') dueSoon++;
        else scheduled++;
      });
    });

    return { overdue, dueSoon, scheduled };
  };

  const getWOStats = () => {
    const now      = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const wos      = _workOrders;
    const mtd      = wos.filter(w => w.date && w.date.startsWith(thisMonth));
    return {
      open:       wos.filter(w => w.status === 'Open').length,
      inProgress: wos.filter(w => w.status === 'In Progress').length,
      completed:  mtd.filter(w => w.status === 'Completed').length,
      spend:      mtd.reduce((sum, w) => sum + (w.cost || 0), 0),
    };
  };

  const getUniqueVehicles = () => {
    const all = _reminders.flatMap(r =>
      Array.isArray(r.vehicles) ? r.vehicles : [r.vehicle].filter(Boolean)
    );
    return [...new Set(all)];
  };

  // ── Triggered alerts — per-vehicle ─────────────────────────────────────────
  // Returns flat list of { reminder, vehicleName, vehicleState } for every
  // vehicle that is overdue or due-soon and not yet notified.

  const getTriggeredAlerts = () => {
    const alerts = [];
    _reminders.forEach(r => {
      const vehicles = Array.isArray(r.vehicles) ? r.vehicles : [r.vehicle].filter(Boolean);
      vehicles.forEach(v => {
        const vs = r.vehicleStates?.[v] || {};
        if ((vs.status === 'overdue' || vs.status === 'due-soon') && !vs.notified) {
          alerts.push({ reminder: r, vehicleName: v, vehicleState: vs });
        }
      });
    });
    return alerts;
  };

  const markAlertNotified = (reminderId, vehicleName) => {
    const r = _reminders.find(x => x.id === reminderId);
    if (!r || !r.vehicleStates?.[vehicleName]) return;
    r.vehicleStates[vehicleName].notified = true;
    _persist();
  };

  // ── Public API ──────────────────────────────────────────────────────────────

  return {
    connect,
    evaluateConditions,
    updateVehicleLiveData,
    resetVehicleReminderState,
    getReminders, getReminder, addReminder, updateReminder, deleteReminder,
    getWorkOrders, getWorkOrder, addWorkOrder, updateWorkOrder, deleteWorkOrder,
    getReminderStats, getWOStats, getUniqueVehicles,
    getTriggeredAlerts, markAlertNotified,
  };

})();
