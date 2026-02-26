/**
 * data.js
 * Local data store for reminders and work orders.
 * Uses localStorage for persistence between sessions.
 * In production, replace save/load with your backend API calls.
 */

const STORAGE_KEYS = {
  REMINDERS: 'fleetmaint_reminders',
  WORK_ORDERS: 'fleetmaint_workorders',
  WO_COUNTER: 'fleetmaint_wo_counter',
  R_COUNTER:  'fleetmaint_r_counter',
};

// ── Default seed data (used on first load) ──────────────────────────────────

const DEFAULT_REMINDERS = [
  {
    id: 'R001',
    vehicle: 'TRK-041',
    make: '2022 Ford F-250',
    task: 'Oil Change',
    type: 'Odometer',
    status: 'overdue',
    current: 84312,
    target: 84000,
    warn: 500,
    priority: 'High',
    notes: 'Use 5W-30 synthetic',
    assignee: 'Mike Torres',
  },
  {
    id: 'R002',
    vehicle: 'VAN-012',
    make: '2021 Mercedes Sprinter',
    task: 'Air Filter',
    type: 'Interval',
    status: 'due-soon',
    current: 44850,
    target: 45000,
    warn: 500,
    priority: 'Medium',
    notes: '',
    assignee: '',
  },
  {
    id: 'R003',
    vehicle: 'FLT-088',
    make: '2023 Chevy Silverado',
    task: 'Tire Rotation',
    type: 'Odometer',
    status: 'due-soon',
    current: 22800,
    target: 23000,
    warn: 500,
    priority: 'Low',
    notes: '',
    assignee: '',
  },
  {
    id: 'R004',
    vehicle: 'TRK-022',
    make: '2020 Ram 2500',
    task: 'Brake Inspection',
    type: 'Date',
    status: 'scheduled',
    current: 61200,
    target: 65000,
    warn: 1000,
    priority: 'High',
    notes: 'Fleet brake check required by DOT',
    assignee: 'Shop B',
    date: '2026-03-15',
  },
  {
    id: 'R005',
    vehicle: 'SED-055',
    make: '2022 Ford Explorer',
    task: 'Cabin Filter',
    type: 'Interval',
    status: 'scheduled',
    current: 38100,
    target: 40000,
    warn: 500,
    priority: 'Low',
    notes: '',
    assignee: '',
  },
  {
    id: 'R006',
    vehicle: 'TRK-041',
    make: '2022 Ford F-250',
    task: 'Transmission Fluid',
    type: 'Odometer',
    status: 'overdue',
    current: 84312,
    target: 80000,
    warn: 2000,
    priority: 'High',
    notes: 'Check for leaks during service',
    assignee: '',
  },
];

const DEFAULT_WORK_ORDERS = [
  {
    id: 'WO-2023',
    vehicle: 'VAN-012',
    make: '2021 Mercedes Sprinter',
    task: 'Coolant Flush',
    status: 'In Progress',
    assignee: 'Shop A',
    odo: '44,200',
    cost: 280,
    date: '2026-02-20',
    notes: 'Flushing and replacing with OEM spec coolant',
    parts: 'Coolant — $45',
    labor: '$235',
    reminderId: null,
  },
  {
    id: 'WO-2022',
    vehicle: 'FLT-088',
    make: '2023 Chevy Silverado',
    task: 'Brake Pads — Front',
    status: 'Completed',
    assignee: 'Mike Torres',
    odo: '22,400',
    cost: 320,
    date: '2026-02-10',
    notes: 'Replaced front brake pads and rotors',
    parts: 'Pads + Rotors — $180',
    labor: '$140',
    reminderId: null,
  },
  {
    id: 'WO-2021',
    vehicle: 'TRK-022',
    make: '2020 Ram 2500',
    task: 'Tire Rotation',
    status: 'Open',
    assignee: 'Unassigned',
    odo: '61,000',
    cost: null,
    date: '2026-02-18',
    notes: '',
    parts: '',
    labor: '',
    reminderId: null,
  },
];

// ── DataStore ────────────────────────────────────────────────────────────────

const DataStore = {

  _reminders: [],
  _workOrders: [],
  _woCounter: 2024,
  _rCounter: 7,

  init() {
    try {
      const r = localStorage.getItem(STORAGE_KEYS.REMINDERS);
      const w = localStorage.getItem(STORAGE_KEYS.WORK_ORDERS);
      const wc = localStorage.getItem(STORAGE_KEYS.WO_COUNTER);
      const rc = localStorage.getItem(STORAGE_KEYS.R_COUNTER);

      this._reminders  = r  ? JSON.parse(r) : [...DEFAULT_REMINDERS];
      this._workOrders = w  ? JSON.parse(w) : [...DEFAULT_WORK_ORDERS];
      this._woCounter  = wc ? parseInt(wc)  : 2024;
      this._rCounter   = rc ? parseInt(rc)  : 7;
    } catch (e) {
      console.warn('DataStore: localStorage unavailable, using in-memory store.', e);
      this._reminders  = [...DEFAULT_REMINDERS];
      this._workOrders = [...DEFAULT_WORK_ORDERS];
    }
  },

  _persist() {
    try {
      localStorage.setItem(STORAGE_KEYS.REMINDERS,   JSON.stringify(this._reminders));
      localStorage.setItem(STORAGE_KEYS.WORK_ORDERS,  JSON.stringify(this._workOrders));
      localStorage.setItem(STORAGE_KEYS.WO_COUNTER,   this._woCounter);
      localStorage.setItem(STORAGE_KEYS.R_COUNTER,    this._rCounter);
    } catch (e) {
      console.warn('DataStore: could not persist to localStorage.', e);
    }
  },

  // ── Reminders ──

  getReminders() { return [...this._reminders]; },

  getReminder(id) { return this._reminders.find(r => r.id === id) || null; },

  addReminder(data) {
    const id = 'R' + String(this._rCounter++).padStart(3, '0');
    const reminder = { id, ...data };
    this._reminders.unshift(reminder);
    this._persist();
    return reminder;
  },

  updateReminder(id, data) {
    const idx = this._reminders.findIndex(r => r.id === id);
    if (idx === -1) return null;
    this._reminders[idx] = { ...this._reminders[idx], ...data };
    this._persist();
    return this._reminders[idx];
  },

  deleteReminder(id) {
    const idx = this._reminders.findIndex(r => r.id === id);
    if (idx === -1) return false;
    this._reminders.splice(idx, 1);
    this._persist();
    return true;
  },

  // Called by geotab.js to push live odometer readings in
  updateOdometer(vehicleId, odometer) {
    let changed = false;
    this._reminders.forEach(r => {
      if (r.vehicle === vehicleId && r.type !== 'Date') {
        r.current = odometer;
        // Recalculate status
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
    if (changed) this._persist();
    return changed;
  },

  // ── Work Orders ──

  getWorkOrders() { return [...this._workOrders]; },

  getWorkOrder(id) { return this._workOrders.find(w => w.id === id) || null; },

  addWorkOrder(data) {
    const id = 'WO-' + (++this._woCounter);
    const wo = { id, ...data };
    this._workOrders.unshift(wo);
    this._persist();
    return wo;
  },

  updateWorkOrder(id, data) {
    const idx = this._workOrders.findIndex(w => w.id === id);
    if (idx === -1) return null;
    this._workOrders[idx] = { ...this._workOrders[idx], ...data };
    this._persist();
    return this._workOrders[idx];
  },

  deleteWorkOrder(id) {
    const idx = this._workOrders.findIndex(w => w.id === id);
    if (idx === -1) return false;
    this._workOrders.splice(idx, 1);
    this._persist();
    return true;
  },

  // ── Stats helpers ──

  getReminderStats() {
    const r = this._reminders;
    return {
      overdue:   r.filter(x => x.status === 'overdue').length,
      dueSoon:   r.filter(x => x.status === 'due-soon').length,
      scheduled: r.filter(x => x.status === 'scheduled').length,
    };
  },

  getWOStats() {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const wos = this._workOrders;
    const mtd = wos.filter(w => w.date && w.date.startsWith(thisMonth));
    return {
      open:       wos.filter(w => w.status === 'Open').length,
      inProgress: wos.filter(w => w.status === 'In Progress').length,
      completed:  mtd.filter(w => w.status === 'Completed').length,
      spend:      mtd.reduce((sum, w) => sum + (w.cost || 0), 0),
    };
  },

  getUniqueVehicles() {
    return [...new Set(this._reminders.map(r => r.vehicle))];
  },
};
