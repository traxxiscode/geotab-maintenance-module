/**
 * app.js
 * Main UI controller for the Fleet Maintenance Add-in.
 * Handles rendering, modals, filtering, theme toggle, and user interactions.
 */

const app = (() => {

  // State
  let _activeTab = 'reminders';
  let _reminderFilter = { query: '', status: '', vehicle: '' };
  let _woFilter = { query: '', status: '' };
  let _pendingNotifReminder = null;
  let _editingReminderId = null;
  let _isDark = true;

  // Multi-vehicle picker state (used while reminder modal is open)
  let _pickerSelected = [];

  // Vehicle list — populated by Geotab API when running inside MyGeotab,
  // falls back to demo vehicles when running standalone.
  let KNOWN_VEHICLES = [
    { id: 'TRK-041', make: '2022 Ford F-250' },
    { id: 'VAN-012', make: '2021 Mercedes Sprinter' },
    { id: 'FLT-088', make: '2023 Chevy Silverado' },
    { id: 'TRK-022', make: '2020 Ram 2500' },
    { id: 'SED-055', make: '2022 Ford Explorer' },
    { id: 'TRK-099', make: '2023 Ram 1500' },
    { id: 'VAN-031', make: '2021 Ford Transit' },
  ];

  // Called by geotab.js once real vehicles are loaded from the API
  const setVehicles = (vehicles) => {
    KNOWN_VEHICLES = vehicles.map(v => ({
      id:   v.name,
      make: [v.year, v.make].filter(Boolean).join(' ') || v.licensePlate || '',
    }));
    // Refresh the reminder modal picker if it's currently open
    const picker = document.getElementById('vehiclePicker');
    if (picker) _refreshPickerUI();
    // Refresh stats so vehicle count updates
    _renderReminderStats();
  };

  // ── Init ───────────────────────────────────────────────────────────────────

  const init = () => {
    const savedTheme = localStorage.getItem('fleetmaint_theme') || 'dark';
    _isDark = savedTheme === 'dark';
    _applyTheme(_isDark);
    refreshAll();
  };

  const refreshAll = () => {
    _renderReminderStats();
    _renderReminders();
    _renderWOStats();
    _renderWorkOrders();
    _updateCounts();
  };

  // ── Theme Toggle ───────────────────────────────────────────────────────────

  const toggleTheme = (isChecked) => {
    _isDark = !isChecked;
    _applyTheme(_isDark);
    localStorage.setItem('fleetmaint_theme', _isDark ? 'dark' : 'light');
  };

  const _applyTheme = (dark) => {
    document.body.classList.toggle('light', !dark);
    const icon  = document.getElementById('themeIcon');
    const label = document.getElementById('themeLabel');
    const toggle = document.getElementById('themeToggle');
    if (icon)  icon.textContent  = dark ? '🌙' : '☀️';
    if (label) label.textContent = dark ? 'DARK' : 'LIGHT';
    if (toggle) toggle.checked = !dark;
  };

  // ── Tab Switching ──────────────────────────────────────────────────────────

  const switchTab = (tab) => {
    _activeTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    document.getElementById('panel-' + tab).classList.add('active');
  };

  // ── Stats ──────────────────────────────────────────────────────────────────

  const _renderReminderStats = () => {
    const s = DataStore.getReminderStats();
    _set('stat-overdue',   s.overdue);
    _set('stat-due-soon',  s.dueSoon);
    _set('stat-scheduled', s.scheduled);
    _set('stat-vehicles',  DataStore.getUniqueVehicles().length);
  };

  const _renderWOStats = () => {
    const s = DataStore.getWOStats();
    _set('stat-wo-open',       s.open);
    _set('stat-wo-inprogress', s.inProgress);
    _set('stat-wo-completed',  s.completed);
    _set('stat-wo-spend',      '$' + s.spend.toLocaleString());
  };

  const _updateCounts = () => {
    _set('reminderCount', DataStore.getReminders().length);
    _set('woCount',       DataStore.getWorkOrders().length);
  };

  // ── Render Reminders ───────────────────────────────────────────────────────

  const _renderReminders = () => {
    let data = DataStore.getReminders();

    if (_reminderFilter.query) {
      const q = _reminderFilter.query.toLowerCase();
      data = data.filter(r => {
        const vehicles = Array.isArray(r.vehicles) ? r.vehicles : [r.vehicle];
        return vehicles.some(v => v.toLowerCase().includes(q)) ||
               r.task.toLowerCase().includes(q);
      });
    }
    if (_reminderFilter.status) {
      data = data.filter(r => r.status === _reminderFilter.status);
    }
    if (_reminderFilter.vehicle) {
      data = data.filter(r => {
        const vehicles = Array.isArray(r.vehicles) ? r.vehicles : [r.vehicle];
        return vehicles.includes(_reminderFilter.vehicle);
      });
    }

    const tbody = document.getElementById('remindersBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
        <div class="empty-icon">⏰</div>
        <div class="empty-title">No reminders found</div>
        <div class="empty-sub">Create a reminder to start tracking maintenance</div>
        <button class="btn btn-primary" onclick="app.openReminderModal()">＋ New Reminder</button>
      </div></td></tr>`;
      _set('rowCount', 0);
      return;
    }

    data.forEach(r => {
      const vehicles = Array.isArray(r.vehicles) ? r.vehicles : [r.vehicle || 'Unknown'];
      const pct = Math.min(100, Math.round((r.current / r.target) * 100));
      const over = r.current > r.target;
      const nearWarn = !over && (r.target - r.current) <= r.warn;

      const statusBadge =
        r.status === 'overdue'  ? `<span class="badge badge-danger">Overdue</span>` :
        r.status === 'due-soon' ? `<span class="badge badge-warn">Due Soon</span>` :
                                  `<span class="badge badge-ok">Scheduled</span>`;

      const typeBadge = `<span class="badge badge-gray">${r.type}</span>`;
      const progColor = over ? 'var(--danger)' : nearWarn ? 'var(--warn)' : 'var(--accent3)';

      const triggerDisplay = r.type === 'Date'
        ? `<div class="odo-chip"><span>📅</span> Due: ${r.date || 'N/A'}</div>`
        : `<div class="progress-wrap">
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${progColor}"></div></div>
            <span class="progress-label">${r.current.toLocaleString()} / ${r.target.toLocaleString()} mi</span>
          </div>`;

      const prioClass = r.priority === 'High' ? 'priority-high' : r.priority === 'Medium' ? 'priority-medium' : 'priority-low';
      const vehiclePillsHTML = _renderVehicleMiniPills(vehicles);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><div class="vehicles-cell">${vehiclePillsHTML}</div></td>
        <td style="font-weight:500">${r.task}</td>
        <td>${typeBadge}</td>
        <td>${statusBadge}</td>
        <td style="min-width:200px">${triggerDisplay}</td>
        <td><span class="${prioClass}" style="font-family:var(--mono);font-size:11px;font-weight:600">▲ ${r.priority}</span></td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="app.openReminderModal('${r.id}')">✏️ Edit</button>
            <button class="btn btn-danger btn-sm" onclick="app.deleteReminder('${r.id}')">🗑</button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });

    _set('rowCount', data.length);

    // Populate vehicle filter dropdown
    const sel = document.getElementById('vehicleFilter');
    if (sel && sel.options.length <= 1) {
      DataStore.getUniqueVehicles().forEach(v => {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        sel.appendChild(opt);
      });
    }
  };

  const _renderVehicleMiniPills = (vehicles) => {
    const MAX_SHOW = 3;
    let html = '';
    vehicles.slice(0, MAX_SHOW).forEach((v, i) => {
      html += `<span class="vehicle-mini-pill${i === 0 ? ' primary' : ''}">🚛 ${v}</span>`;
    });
    if (vehicles.length > MAX_SHOW) {
      html += `<span class="vehicle-mini-more">+${vehicles.length - MAX_SHOW} more</span>`;
    }
    return html;
  };

  // ── Render Work Orders ─────────────────────────────────────────────────────

  const _renderWorkOrders = () => {
    let data = DataStore.getWorkOrders();

    if (_woFilter.query) {
      const q = _woFilter.query.toLowerCase();
      data = data.filter(w =>
        w.id.toLowerCase().includes(q) ||
        w.vehicle.toLowerCase().includes(q) ||
        w.task.toLowerCase().includes(q)
      );
    }
    if (_woFilter.status) {
      data = data.filter(w => w.status === _woFilter.status);
    }

    const tbody = document.getElementById('woBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">No work orders</div>
        <div class="empty-sub">Accept a reminder or create one manually</div>
      </div></td></tr>`;
      _set('woRowCount', 0);
      return;
    }

    data.forEach(wo => {
      const statusBadge =
        wo.status === 'Open'        ? `<span class="badge badge-info">Open</span>` :
        wo.status === 'In Progress' ? `<span class="badge badge-warn">In Progress</span>` :
                                      `<span class="badge badge-ok">Completed</span>`;

      const costDisplay = wo.cost != null
        ? `<span class="cost-value">$${Number(wo.cost).toLocaleString()}</span>`
        : `<span style="color:var(--text-dim);font-family:var(--mono);font-size:11px">—</span>`;

      const tr = document.createElement('tr');
      tr.onclick = () => openWOModal(wo.id);
      tr.innerHTML = `
        <td><span style="font-family:var(--mono);font-size:11px;color:var(--accent2)">${wo.id}</span></td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="vehicle-avatar">🚛</div>
            <div>
              <div style="font-weight:500;font-size:12px">${wo.vehicle}</div>
              <div style="font-size:11px;color:var(--text-muted)">${wo.make || ''}</div>
            </div>
          </div>
        </td>
        <td style="font-weight:500">${wo.task}</td>
        <td>${statusBadge}</td>
        <td style="color:var(--text-muted);font-size:12px">${wo.assignee || '—'}</td>
        <td><span class="odo-chip">🛣 ${wo.odo} mi</span></td>
        <td>${costDisplay}</td>
        <td style="color:var(--text-muted);font-family:var(--mono);font-size:11px">${wo.date}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();app.openWOModal('${wo.id}')">Open</button></td>`;
      tbody.appendChild(tr);
    });

    _set('woRowCount', data.length);
  };

  // ── Filters ────────────────────────────────────────────────────────────────

  const filterReminders = (q) => { _reminderFilter.query = q; _renderReminders(); };
  const filterRemindersByStatus = (s) => { _reminderFilter.status = s; _renderReminders(); };
  const filterRemindersByVehicle = (v) => { _reminderFilter.vehicle = v; _renderReminders(); };
  const filterWorkOrders = (q) => { _woFilter.query = q; _renderWorkOrders(); };
  const filterWOByStatus = (s) => { _woFilter.status = s; _renderWorkOrders(); };

  // ── Notifications ──────────────────────────────────────────────────────────

  const showNotification = (reminder, milesOver) => {
    _pendingNotifReminder = reminder;
    const vehicles = Array.isArray(reminder.vehicles) ? reminder.vehicles : [reminder.vehicle];
    document.getElementById('notifTitle').textContent =
      `Maintenance Reminder Triggered — ${vehicles.join(', ')}`;
    document.getElementById('notifDesc').textContent =
      `${reminder.task} due — Odometer ${reminder.current.toLocaleString()} mi has reached trigger of ${reminder.target.toLocaleString()} mi` +
      (milesOver > 0 ? ` (+${milesOver.toLocaleString()} mi over)` : '');
    const dot = document.getElementById('notifDot');
    document.getElementById('notifBanner').style.display = 'flex';
    if (dot) dot.style.display = 'none';
  };

  const dismissNotif = () => {
    document.getElementById('notifBanner').style.display = 'none';
    _pendingNotifReminder = null;
  };

  // ── Accept Modal ───────────────────────────────────────────────────────────

  const openAcceptModal = () => {
    dismissNotif();
    if (!_pendingNotifReminder) return;
    const r = _pendingNotifReminder;
    const over = r.current - r.target;
    const vehicles = Array.isArray(r.vehicles) ? r.vehicles : [r.vehicle];

    document.getElementById('acceptModalBody').innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
        Review the triggered reminder and confirm to automatically generate Work Orders.
      </div>
      <div class="accept-preview">
        <div class="accept-preview-row">
          <span class="accept-preview-label">Vehicles</span>
          <span class="accept-preview-value">${vehicles.join(', ')}</span>
        </div>
        <div class="accept-preview-row">
          <span class="accept-preview-label">Task</span>
          <span class="accept-preview-value">${r.task}</span>
        </div>
        <div class="accept-preview-row">
          <span class="accept-preview-label">Triggered At</span>
          <span class="accept-preview-value" style="color:var(--danger)">${r.current.toLocaleString()} mi${over > 0 ? ' (+' + over.toLocaleString() + ' over)' : ''}</span>
        </div>
        <div class="accept-preview-row">
          <span class="accept-preview-label">Priority</span>
          <span class="accept-preview-value" style="color:var(--danger)">${r.priority}</span>
        </div>
        ${vehicles.length > 1 ? `<div class="accept-preview-row">
          <span class="accept-preview-label">Orders to Create</span>
          <span class="accept-preview-value" style="color:var(--accent2)">${vehicles.length} orders (one per vehicle)</span>
        </div>` : ''}
      </div>
      <div class="form-section-label">Work Order Details</div>
      <div class="form-grid">
        <div class="form-group">
          <label>Assigned Technician</label>
          <input type="text" id="accept-assignee" placeholder="Name or shop" value="${r.assignee || ''}">
        </div>
        <div class="form-group">
          <label>Scheduled Date</label>
          <input type="date" id="accept-date" value="${new Date().toISOString().split('T')[0]}">
        </div>
        <div class="form-group full">
          <label>Initial Notes</label>
          <textarea id="accept-notes" placeholder="Pre-work notes...">${r.notes || ''}</textarea>
        </div>
      </div>`;

    document.getElementById('acceptModal').style.display = 'flex';
  };

  const acceptAndCreateWO = () => {
    if (!_pendingNotifReminder) return;
    const r = _pendingNotifReminder;
    const vehicles = Array.isArray(r.vehicles) ? r.vehicles : [r.vehicle];
    const assignee = document.getElementById('accept-assignee')?.value || 'Unassigned';
    const date     = document.getElementById('accept-date')?.value    || new Date().toISOString().split('T')[0];
    const notes    = document.getElementById('accept-notes')?.value   || '';

    const created = vehicles.map(vehicleId => {
      const info = KNOWN_VEHICLES.find(v => v.id === vehicleId);
      return DataStore.addWorkOrder({
        vehicle: vehicleId, make: info ? info.make : '',
        task: r.task, status: 'Open', assignee,
        odo: r.current.toLocaleString(), cost: null, date,
        notes: notes || `Auto-created from reminder ${r.id}`,
        parts: '', labor: '', reminderId: r.id,
      });
    });

    closeModal('acceptModal');
    _pendingNotifReminder = null;
    refreshAll();
    switchTab('workorders');
    const msg = created.length === 1
      ? `✓ Work Order ${created[0].id} created`
      : `✓ ${created.length} Work Orders created`;
    _showToast(msg);
  };

  // ── Multi-Vehicle Picker ───────────────────────────────────────────────────

  const _buildVehiclePickerHTML = (selectedVehicles = []) => {
    _pickerSelected = [...selectedVehicles];
    return `
      <div class="vehicle-picker" id="vehiclePicker">
        <div class="vehicle-pills" id="vehiclePills">${_buildPillsHTML()}</div>
        <input class="vehicle-picker-search" id="vehiclePickerSearch"
          placeholder="Search vehicles..." oninput="app._filterPickerList(this.value)">
        <div class="vehicle-picker-list" id="vehiclePickerList">
          ${_buildPickerListHTML('')}
        </div>
      </div>`;
  };

  const _buildPillsHTML = () => {
    if (_pickerSelected.length === 0)
      return `<span class="vehicle-pills-empty">No vehicles selected — choose below</span>`;
    return _pickerSelected.map(id =>
      `<span class="vehicle-pill">🚛 ${id}
        <span class="vehicle-pill-remove" onclick="app._removeVehicleFromPicker('${id}')">×</span>
      </span>`
    ).join('');
  };

  const _buildPickerListHTML = (query) => {
    const q = query.toLowerCase();
    const filtered = KNOWN_VEHICLES.filter(v =>
      !q || v.id.toLowerCase().includes(q) || v.make.toLowerCase().includes(q)
    );
    if (!filtered.length)
      return `<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:12px">No vehicles match</div>`;
    return filtered.map(v => {
      const checked = _pickerSelected.includes(v.id);
      return `<div class="vehicle-picker-item${checked ? ' checked' : ''}" onclick="app._toggleVehicleInPicker('${v.id}')">
        <div class="vehicle-checkbox">${checked ? '✓' : ''}</div>
        <span class="vehicle-picker-name">${v.id}</span>
        <span class="vehicle-picker-make">${v.make}</span>
      </div>`;
    }).join('');
  };

  const _toggleVehicleInPicker = (id) => {
    const idx = _pickerSelected.indexOf(id);
    idx === -1 ? _pickerSelected.push(id) : _pickerSelected.splice(idx, 1);
    _refreshPickerUI();
  };

  const _removeVehicleFromPicker = (id) => {
    _pickerSelected = _pickerSelected.filter(v => v !== id);
    _refreshPickerUI();
  };

  const _filterPickerList = (query) => {
    const list = document.getElementById('vehiclePickerList');
    if (list) list.innerHTML = _buildPickerListHTML(query);
  };

  const _refreshPickerUI = () => {
    const pills = document.getElementById('vehiclePills');
    if (pills) pills.innerHTML = _buildPillsHTML();
    const search = document.getElementById('vehiclePickerSearch');
    const list = document.getElementById('vehiclePickerList');
    if (list) list.innerHTML = _buildPickerListHTML(search ? search.value : '');
  };

  // ── Reminder Modal ─────────────────────────────────────────────────────────

  const openReminderModal = (reminderId) => {
    _editingReminderId = reminderId || null;
    const existing = reminderId ? DataStore.getReminder(reminderId) : null;

    document.getElementById('reminderModalTitle').textContent =
      existing ? `✏️ Edit Reminder — ${existing.task}` : '＋ New Maintenance Reminder';

    const existingVehicles = existing
      ? (Array.isArray(existing.vehicles) ? existing.vehicles : [existing.vehicle].filter(Boolean))
      : [];

    document.getElementById('reminderModalBody').innerHTML =
      _getReminderFormHTML(existing, existingVehicles);
    document.getElementById('reminderModal').style.display = 'flex';
  };

  const _getReminderFormHTML = (r, existingVehicles = []) => `
    <div class="form-section-label">Vehicles &amp; Task</div>

    <div class="form-group full" style="margin-bottom:16px">
      <label>Assign to Vehicles <span style="color:var(--text-dim);font-weight:400;text-transform:none;font-size:10px;letter-spacing:0">(select one or more)</span></label>
      ${_buildVehiclePickerHTML(existingVehicles)}
    </div>

    <div class="form-grid">
      <div class="form-group">
        <label>Maintenance Task</label>
        <select id="r-task-select" onchange="app._taskSelectChanged(this.value)">
          ${['Oil Change','Air Filter Replacement','Cabin Filter Replacement','Tire Rotation',
             'Brake Inspection','Transmission Fluid','Coolant Flush','Spark Plugs',
             'Battery Check','Custom Issue / Repair']
            .map(t => `<option${r && r.task === t ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" id="r-custom-group" style="display:${r && !['Oil Change','Air Filter Replacement','Cabin Filter Replacement','Tire Rotation','Brake Inspection','Transmission Fluid','Coolant Flush','Spark Plugs','Battery Check'].includes(r.task) ? 'flex' : 'none'}">
        <label>Custom Task Name</label>
        <input type="text" id="r-custom-task" placeholder="Describe the task" value="${r ? r.task || '' : ''}">
      </div>
      <div class="form-group">
        <label>Priority</label>
        <select id="r-priority">
          <option${r && r.priority === 'High' ? ' selected' : ''}>High</option>
          <option${!r || r.priority === 'Medium' ? ' selected' : ''}>Medium</option>
          <option${r && r.priority === 'Low' ? ' selected' : ''}>Low</option>
        </select>
      </div>
      <div class="form-group">
        <label>Assigned To</label>
        <input type="text" id="r-assignee" placeholder="Technician or shop" value="${r ? r.assignee || '' : ''}">
      </div>
    </div>

    <div class="form-section-label" style="margin-top:16px">Trigger Condition</div>
    <div class="trigger-options" id="triggerOptions">
      <div class="trigger-option${!r || r.type === 'Odometer' ? ' selected' : ''}" onclick="app._selectTrigger(this,'Odometer')">
        <div class="trigger-option-title">🛣 Odometer</div>
        <div class="trigger-option-desc">Trigger at a specific mileage reading</div>
      </div>
      <div class="trigger-option${r && r.type === 'Interval' ? ' selected' : ''}" onclick="app._selectTrigger(this,'Interval')">
        <div class="trigger-option-title">🔁 Mileage Interval</div>
        <div class="trigger-option-desc">Repeat every X miles from last service</div>
      </div>
      <div class="trigger-option${r && r.type === 'Date' ? ' selected' : ''}" onclick="app._selectTrigger(this,'Date')">
        <div class="trigger-option-title">📅 Date</div>
        <div class="trigger-option-desc">Trigger on a specific calendar date</div>
      </div>
      <div class="trigger-option${r && r.type === 'Engine Hours' ? ' selected' : ''}" onclick="app._selectTrigger(this,'Engine Hours')">
        <div class="trigger-option-title">⏱ Engine Hours</div>
        <div class="trigger-option-desc">Trigger after N engine hours</div>
      </div>
    </div>

    <div id="triggerFields" style="margin-top:14px">
      ${_getTriggerFieldsHTML(r ? r.type : 'Odometer', r)}
    </div>

    <div class="form-group full" style="margin-top:12px">
      <label>Notes / Description</label>
      <textarea id="r-notes" placeholder="Additional instructions...">${r ? r.notes || '' : ''}</textarea>
    </div>`;

  const _getTriggerFieldsHTML = (type, r) => {
    const fg = (label, id, value, placeholder, inputType = 'number') =>
      `<div class="form-group"><label>${label}</label><input type="${inputType}" id="${id}" placeholder="${placeholder}" value="${value || ''}"></div>`;

    if (type === 'Odometer') return `<div class="form-grid">
      ${fg('Target Odometer (mi)', 'r-target', r ? r.target : '', 'e.g. 90000')}
      ${fg('Warning Threshold (mi before)', 'r-warn', r ? r.warn : '', 'e.g. 500')}
      ${fg('Current Odometer (mi)', 'r-current', r ? r.current : '', 'Live from Geotab')}
    </div>`;

    if (type === 'Interval') return `<div class="form-grid">
      ${fg('Repeat Every (mi)', 'r-target', r ? r.target : '', 'e.g. 5000')}
      ${fg('Last Service Odometer (mi)', 'r-current', r ? r.current : '', 'e.g. 80000')}
      ${fg('Warning (mi before)', 'r-warn', r ? r.warn : '', 'e.g. 500')}
    </div>`;

    if (type === 'Date') return `<div class="form-grid">
      ${fg('Trigger Date', 'r-date', r ? r.date : '', '', 'date')}
      ${fg('Warn X Days Before', 'r-warn', r ? r.warn : '', 'e.g. 7')}
    </div>`;

    if (type === 'Engine Hours') return `<div class="form-grid">
      ${fg('Target Engine Hours', 'r-target', r ? r.target : '', 'e.g. 250')}
      ${fg('Warning (hours before)', 'r-warn', r ? r.warn : '', 'e.g. 10')}
    </div>`;

    return '';
  };

  const _selectTrigger = (el, type) => {
    document.querySelectorAll('.trigger-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
    const fields = document.getElementById('triggerFields');
    if (fields) fields.innerHTML = _getTriggerFieldsHTML(type, null);
  };

  const _taskSelectChanged = (val) => {
    const grp = document.getElementById('r-custom-group');
    if (grp) grp.style.display = val === 'Custom Issue / Repair' ? 'flex' : 'none';
  };

  const saveReminder = () => {
    if (_pickerSelected.length === 0) {
      _showToast('Please select at least one vehicle', true); return;
    }

    const taskSel  = document.getElementById('r-task-select')?.value;
    const customT  = document.getElementById('r-custom-task')?.value?.trim();
    const task     = taskSel === 'Custom Issue / Repair' ? (customT || 'Custom Task') : taskSel;
    const priority = document.getElementById('r-priority')?.value || 'Medium';
    const assignee = document.getElementById('r-assignee')?.value?.trim();
    const notes    = document.getElementById('r-notes')?.value?.trim();
    const target   = parseInt(document.getElementById('r-target')?.value) || 0;
    const warn     = parseInt(document.getElementById('r-warn')?.value) || 500;
    const current  = parseInt(document.getElementById('r-current')?.value) || 0;
    const date     = document.getElementById('r-date')?.value;

    const selectedTriggerEl = document.querySelector('.trigger-option.selected .trigger-option-title');
    const typeText = selectedTriggerEl ? selectedTriggerEl.textContent.trim() : '🛣 Odometer';
    const typeMap = { 'Odometer': 'Odometer', 'Interval': 'Interval', 'Date': 'Date', 'Hours': 'Engine Hours' };
    const triggerType = Object.keys(typeMap).find(k => typeText.includes(k))
      ? typeMap[Object.keys(typeMap).find(k => typeText.includes(k))] : 'Odometer';

    if (!task) { _showToast('Please select a task', true); return; }

    let status = 'scheduled';
    if (triggerType !== 'Date') {
      if (current >= target) status = 'overdue';
      else if (target - current <= warn) status = 'due-soon';
    }

    const data = {
      vehicles:  [..._pickerSelected],
      vehicle:   _pickerSelected[0],
      make:      KNOWN_VEHICLES.find(v => v.id === _pickerSelected[0])?.make || '',
      task, type: triggerType, priority, assignee, notes, target, warn, current, status, date,
    };

    if (_editingReminderId) {
      DataStore.updateReminder(_editingReminderId, data);
      _showToast('Reminder updated');
    } else {
      DataStore.addReminder(data);
      _showToast('Reminder saved');
    }

    closeModal('reminderModal');
    refreshAll();
  };

  const deleteReminder = (id) => {
    if (!confirm('Delete this reminder? This cannot be undone.')) return;
    DataStore.deleteReminder(id);
    refreshAll();
    _showToast('Reminder deleted');
  };

  // ── Work Order Modal ───────────────────────────────────────────────────────

  const openWOModal = (woId) => {
    const modal  = document.getElementById('woModal');
    const title  = document.getElementById('woModalTitle');
    const body   = document.getElementById('woModalBody');
    const footer = document.getElementById('woModalFooter');

    if (!woId) {
      title.textContent = '＋ New Work Order';
      body.innerHTML = _getWOFormHTML();
      footer.innerHTML = `
        <button class="btn btn-ghost" onclick="app.closeModal('woModal')">Cancel</button>
        <button class="btn btn-primary" onclick="app._saveNewWO()">Create Work Order</button>`;
    } else {
      const wo = DataStore.getWorkOrder(woId);
      if (!wo) return;
      title.innerHTML = `<span style="color:var(--accent2);margin-right:8px">${wo.id}</span>${wo.task}`;
      body.innerHTML = _getWODetailHTML(wo);
      footer.innerHTML = `
        <button class="btn btn-ghost" onclick="app.closeModal('woModal')">Close</button>
        ${wo.status !== 'Completed'
          ? `<button style="background:rgba(227,179,65,0.1);color:var(--warn);border:1px solid rgba(227,179,65,0.3)" class="btn btn-sm" onclick="app._updateWO('${wo.id}','In Progress')">→ Mark In Progress</button>
             <button class="btn btn-success" onclick="app._saveAndCompleteWO('${wo.id}')">✓ Save &amp; Mark Completed</button>`
          : `<button class="btn btn-secondary btn-sm" onclick="app._saveWOEdits('${wo.id}')">💾 Save Changes</button>`}`;
    }
    modal.style.display = 'flex';
  };

  const _getWOFormHTML = () => `
    <div class="form-grid">
      <div class="form-group"><label>Vehicle ID</label><input type="text" id="wo-vehicle" placeholder="e.g. TRK-041"></div>
      <div class="form-group"><label>Make / Model</label><input type="text" id="wo-make" placeholder="e.g. 2022 Ford F-250"></div>
      <div class="form-group"><label>Maintenance Task</label><input type="text" id="wo-task" placeholder="e.g. Oil Change"></div>
      <div class="form-group"><label>Assigned Technician</label><input type="text" id="wo-assignee" placeholder="Name or shop"></div>
      <div class="form-group"><label>Odometer at Service (mi)</label><input type="number" id="wo-odo" placeholder="Current odometer"></div>
      <div class="form-group"><label>Scheduled Date</label><input type="date" id="wo-date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="form-group full"><label>Work Description / Notes</label><textarea id="wo-notes" placeholder="Describe the work..."></textarea></div>
      <div class="form-group"><label>Parts Used</label><input type="text" id="wo-parts" placeholder="e.g. Oil filter, 5qt 5W-30"></div>
      <div class="form-group"><label>Labor Cost ($)</label><input type="number" id="wo-labor" placeholder="0.00"></div>
      <div class="form-group"><label>Total Cost ($)</label><input type="number" id="wo-cost" placeholder="0.00"></div>
    </div>`;

  const _getWODetailHTML = (wo) => {
    const statusBadge =
      wo.status === 'Open'        ? `<span class="badge badge-info">Open</span>` :
      wo.status === 'In Progress' ? `<span class="badge badge-warn">In Progress</span>` :
                                    `<span class="badge badge-ok">Completed</span>`;
    return `
      <div class="wo-status-header">
        <div>
          <div class="wo-id">${wo.id}</div>
          <div style="font-size:11px;color:var(--text-muted);font-family:var(--mono)">Created: ${wo.date}</div>
        </div>
        <div class="wo-meta">
          <div class="wo-meta-title">${wo.vehicle}${wo.make ? ' — ' + wo.make : ''}</div>
          <div class="wo-meta-sub">${wo.task}</div>
        </div>
        ${statusBadge}
      </div>
      <div class="form-section-label">Work Details</div>
      <div class="form-grid">
        <div class="form-group"><label>Assigned To</label><input type="text" id="wo-assignee" value="${wo.assignee || ''}"></div>
        <div class="form-group"><label>Odometer at Service</label><input type="text" id="wo-odo" value="${wo.odo}"></div>
        <div class="form-group full"><label>Work Notes</label><textarea id="wo-notes">${wo.notes || ''}</textarea></div>
      </div>
      <div class="form-section-label" style="margin-top:12px">Costs &amp; Parts</div>
      <div class="form-grid">
        <div class="form-group"><label>Parts Used</label><input type="text" id="wo-parts" value="${wo.parts || ''}" placeholder="Parts and costs..."></div>
        <div class="form-group"><label>Labor</label><input type="text" id="wo-labor" value="${wo.labor || ''}" placeholder="Labor cost"></div>
        <div class="form-group"><label>Total Cost ($)</label><input type="number" id="wo-cost" value="${wo.cost || ''}" placeholder="0.00"></div>
        <div class="form-group"><label>Completion Date</label><input type="date" id="wo-completion-date" value="${wo.completionDate || ''}"></div>
      </div>
      ${wo.reminderId ? `<div style="margin-top:12px;padding:10px 14px;background:rgba(121,192,255,0.05);border:1px solid rgba(121,192,255,0.2);border-radius:8px;font-size:12px;color:var(--text-muted)">
        🔗 Auto-generated from Reminder <span style="color:var(--accent2);font-family:var(--mono)">${wo.reminderId}</span>
      </div>` : ''}`;
  };

  const _saveNewWO = () => {
    const vehicle = document.getElementById('wo-vehicle')?.value?.trim();
    const task    = document.getElementById('wo-task')?.value?.trim();
    if (!vehicle || !task) { _showToast('Vehicle and Task are required', true); return; }

    const wo = DataStore.addWorkOrder({
      vehicle, make: document.getElementById('wo-make')?.value?.trim() || '',
      task, status: 'Open',
      assignee: document.getElementById('wo-assignee')?.value?.trim() || 'Unassigned',
      odo: document.getElementById('wo-odo')?.value || '0',
      cost: parseFloat(document.getElementById('wo-cost')?.value) || null,
      date: document.getElementById('wo-date')?.value || new Date().toISOString().split('T')[0],
      notes: document.getElementById('wo-notes')?.value?.trim() || '',
      parts: document.getElementById('wo-parts')?.value?.trim() || '',
      labor: document.getElementById('wo-labor')?.value?.trim() || '',
      reminderId: null,
    });

    closeModal('woModal');
    refreshAll();
    _showToast(`✓ Work Order ${wo.id} created`);
  };

  const _saveWOEdits = (woId) => {
    DataStore.updateWorkOrder(woId, {
      assignee:       document.getElementById('wo-assignee')?.value || '',
      odo:            document.getElementById('wo-odo')?.value || '',
      notes:          document.getElementById('wo-notes')?.value || '',
      parts:          document.getElementById('wo-parts')?.value || '',
      labor:          document.getElementById('wo-labor')?.value || '',
      cost:           parseFloat(document.getElementById('wo-cost')?.value) || null,
      completionDate: document.getElementById('wo-completion-date')?.value || '',
    });
    closeModal('woModal');
    refreshAll();
    _showToast('Work Order saved');
  };

  const _saveAndCompleteWO = (woId) => {
    DataStore.updateWorkOrder(woId, {
      status: 'Completed',
      assignee:       document.getElementById('wo-assignee')?.value || '',
      odo:            document.getElementById('wo-odo')?.value || '',
      notes:          document.getElementById('wo-notes')?.value || '',
      parts:          document.getElementById('wo-parts')?.value || '',
      labor:          document.getElementById('wo-labor')?.value || '',
      cost:           parseFloat(document.getElementById('wo-cost')?.value) || null,
      completionDate: document.getElementById('wo-completion-date')?.value || new Date().toISOString().split('T')[0],
    });
    closeModal('woModal');
    refreshAll();
    _showToast('Work Order marked as Completed');
  };

  const _updateWO = (woId, status) => {
    DataStore.updateWorkOrder(woId, { status });
    closeModal('woModal');
    refreshAll();
  };

  // ── Modal Helpers ──────────────────────────────────────────────────────────

  const closeModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  };

  const closeModalOnOverlay = (e, id) => {
    if (e.target === document.getElementById(id)) closeModal(id);
  };

  // ── Toast ──────────────────────────────────────────────────────────────────

  const _showToast = (msg, error = false) => {
    const el = document.createElement('div');
    el.className = 'toast' + (error ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  };

  // ── Utility ────────────────────────────────────────────────────────────────

  const _set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    init, refreshAll, switchTab, toggleTheme,
    setVehicles,
    filterReminders, filterRemindersByStatus, filterRemindersByVehicle,
    openReminderModal, saveReminder, deleteReminder,
    _selectTrigger, _taskSelectChanged,
    _toggleVehicleInPicker, _removeVehicleFromPicker, _filterPickerList,
    showNotification, dismissNotif, openAcceptModal, acceptAndCreateWO,
    filterWorkOrders, filterWOByStatus,
    openWOModal, _saveNewWO, _saveWOEdits, _saveAndCompleteWO, _updateWO,
    closeModal, closeModalOnOverlay,
  };

})();
