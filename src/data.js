/**
 * data.js
 * Data store for reminders and work orders.
 * Persists to Firestore under the current Geotab database's document.
 *
 * Collection structure:
 *   fleet_maintenance/{databaseName}
 *     reminders:   Array
 *     workOrders:  Array
 *     woCounter:   Number
 *     rCounter:    Number
 *     updated_at:  Timestamp
 */

const DataStore = (() => {

  // ── In-memory state ─────────────────────────────────────────────────────────

  let _reminders  = [];
  let _workOrders = [];
  let _woCounter  = 2024;
  let _rCounter   = 1;
  let _databaseName = null;
  let _docRef = null;  // Firestore DocumentReference for this database

  // ── Firestore helpers ───────────────────────────────────────────────────────

  /**
   * Called by geotab.js once the Geotab session resolves.
   * Ensures a Firestore document exists for this database, then loads data.
   */
  const connect = async (databaseName) => {
    if (!databaseName || !window.db) {
      console.warn('DataStore: Firestore not available — using in-memory store.');
      _loadDefaults();
      return;
    }

    _databaseName = databaseName;

    try {
      // Ensure Firebase auth
      await _ensureAuth();

      const col = window.db.collection('fleet_maintenance');
      const snap = await col.where('database_name', '==', databaseName).get();

      if (snap.empty) {
        // First time — seed with defaults and create the document
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
        console.log(`DataStore: Created new Firestore document for database "${databaseName}".`);
      } else {
        _docRef = snap.docs[0].ref;
        const data = snap.docs[0].data();
        _reminders  = data.reminders   || [];
        _workOrders = data.workOrders  || [];
        _woCounter  = data.woCounter   || 2024;
        _rCounter   = data.rCounter    || 1;
        console.log(`DataStore: Loaded data for database "${databaseName}" from Firestore.`);
      }

      // Refresh UI now that real data is loaded
      if (window.app && typeof window.app.refreshAll === 'function') {
        window.app.refreshAll();
      }

    } catch (err) {
      console.error('DataStore: Firestore connect error — falling back to in-memory.', err);
      _loadDefaults();
    }
  };

  const _ensureAuth = () => {
    return new Promise((resolve, reject) => {
      firebase.auth().onAuthStateChanged(user => {
        if (user) {
          resolve(user);
        } else {
          firebase.auth().signInAnonymously().then(resolve).catch(reject);
        }
      });
    });
  };

  /**
   * Persist current in-memory state back to Firestore.
   */
  const _persist = async () => {
    if (!_docRef) return; // no Firestore — in-memory only

    try {
      await _docRef.update({
        reminders:  _reminders,
        workOrders: _workOrders,
        woCounter:  _woCounter,
        rCounter:   _rCounter,
        updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error('DataStore: Failed to persist to Firestore.', err);
    }
  };

  // ── Default seed data ───────────────────────────────────────────────────────

  const _loadDefaults = () => {
    // No seed data — reminders and work orders are created by the user
    // against real vehicles pulled from the Geotab session database.
    _reminders  = [];
    _workOrders = [];
    _woCounter  = 2000;
    _rCounter   = 1;
  };

  // ── Reminders ───────────────────────────────────────────────────────────────

  const getReminders = () => [..._reminders];

  const getReminder = (id) => _reminders.find(r => r.id === id) || null;

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

  /**
   * Called by geotab.js to push live odometer readings in.
   */
  const updateOdometer = (vehicleId, odometer) => {
    let changed = false;
    _reminders.forEach(r => {
      const vehicles = Array.isArray(r.vehicles) ? r.vehicles : [r.vehicle];
      if (vehicles.includes(vehicleId) && r.type !== 'Date') {
        r.current = odometer;
        if (odometer >= r.target) {
          r.status = 'overdue';
        } else if (r.target - odometer <= r.warn) {
          r.status = 'due-soon';
        } else {
          r.status = 'scheduled';
        }
        changed = true;
      }
    });
    if (changed) _persist();
    return changed;
  };

  // ── Work Orders ─────────────────────────────────────────────────────────────

  const getWorkOrders = () => [..._workOrders];

  const getWorkOrder = (id) => _workOrders.find(w => w.id === id) || null;

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
    const r = _reminders;
    return {
      overdue:   r.filter(x => x.status === 'overdue').length,
      dueSoon:   r.filter(x => x.status === 'due-soon').length,
      scheduled: r.filter(x => x.status === 'scheduled').length,
    };
  };

  const getWOStats = () => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const wos = _workOrders;
    const mtd = wos.filter(w => w.date && w.date.startsWith(thisMonth));
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

  // ── Public API ──────────────────────────────────────────────────────────────

  return {
    connect,
    getReminders, getReminder, addReminder, updateReminder, deleteReminder, updateOdometer,
    getWorkOrders, getWorkOrder, addWorkOrder, updateWorkOrder, deleteWorkOrder,
    getReminderStats, getWOStats, getUniqueVehicles,
  };

})();
