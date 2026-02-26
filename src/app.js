/**
 * app.js
 * Main UI controller for the Fleet Maintenance Add-in.
 */

const app = (() => {

  // ── State ──────────────────────────────────────────────────────────────────

  let _activeTab        = 'reminders';
  let _reminderFilter   = { query: '', status: '', vehicle: '' };
  let _woFilter         = { query: '', status: '' };
  let _pendingNotifReminder = null;
  let _editingReminderId    = null;
  let _isDark               = true;

  // Asset picker state (reminder modal)
  let _allAssets       = [];   // full list from Geotab, enriched with live data
  let _filteredAssets  = [];   // what's shown after search
  let _selectedAssets  = new Set(); // vehicle names currently checked

  // Vehicle list for work-order accept flow
  let KNOWN_VEHICLES = [];

  const setVehicles = (vehicles) => {
    KNOWN_VEHICLES = vehicles.map(v => ({
      id:   v.name,
      make: [v.year, v.make].filter(Boolean).join(' ') || v.licensePlate || '',
    }));
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

  // ── Theme ──────────────────────────────────────────────────────────────────

  const toggleTheme = (isChecked) => {
    _isDark = !isChecked;
    _applyTheme(_isDark);
    localStorage.setItem('fleetmaint_theme', _isDark ? 'dark' : 'light');
  };

  const _applyTheme = (dark) => {
    document.body.classList.toggle('light', !dark);
    const icon   = document.getElementById('themeIcon');
    const label  = document.getElementById('themeLabel');
    const toggle = document.getElementById('themeToggle');
    if (icon)   icon.textContent   = dark ? '🌙' : '☀️';
    if (label)  label.textContent  = dark ? 'DARK' : 'LIGHT';
    if (toggle) toggle.checked     = !dark;
  };

  // ── Tabs ───────────────────────────────────────────────────────────────────

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
    if (_reminderFilter.status)  data = data.filter(r => r.status === _reminderFilter.status);
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
      const vehicles  = Array.isArray(r.vehicles) ? r.vehicles : [r.vehicle || 'Unknown'];
      const conditions = r.conditions || [];

      const statusBadge =
        r.status === 'overdue'  ? `<span class="badge badge-danger">Overdue</span>`  :
        r.status === 'due-soon' ? `<span class="badge badge-warn">Due Soon</span>`   :
                                  `<span class="badge badge-ok">Scheduled</span>`;

      // Build a compact condition summary
      const condSummary = conditions.length
        ? conditions.map(c => {
            if (c.type === 'time')         return `📅 ${c.value} days`;
            if (c.type === 'distance')     return `🛣 ${Number(c.value).toLocaleString()} mi`;
            if (c.type === 'engineHours')  return `⏱ ${c.value} hrs`;
            return '';
          }).filter(Boolean).join(' · ')
        : '—';

      const prioClass  = r.priority === 'High' ? 'priority-high' : r.priority === 'Medium' ? 'priority-medium' : 'priority-low';
      const pillsHTML  = _renderVehicleMiniPills(vehicles);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><div class="vehicles-cell">${pillsHTML}</div></td>
        <td style="font-weight:500">${r.task}</td>
        <td style="font-size:11px;color:var(--text-muted);font-family:var(--mono)">${condSummary}</td>
        <td>${statusBadge}</td>
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
    const MAX = 3;
    let html = vehicles.slice(0, MAX).map((v, i) =>
      `<span class="vehicle-mini-pill${i === 0 ? ' primary' : ''}">🚛 ${v}</span>`
    ).join('');
    if (vehicles.length > MAX) html += `<span class="vehicle-mini-more">+${vehicles.length - MAX} more</span>`;
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
    if (_woFilter.status) data = data.filter(w => w.status === _woFilter.status);

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
        wo.status === 'Open'        ? `<span class="badge badge-info">Open</span>`        :
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

  const filterReminders          = (q) => { _reminderFilter.query   = q; _renderReminders(); };
  const filterRemindersByStatus  = (s) => { _reminderFilter.status  = s; _renderReminders(); };
  const filterRemindersByVehicle = (v) => { _reminderFilter.vehicle = v; _renderReminders(); };
  const filterWorkOrders         = (q) => { _woFilter.query         = q; _renderWorkOrders(); };
  const filterWOByStatus         = (s) => { _woFilter.status        = s; _renderWorkOrders(); };

  // ── Notifications ──────────────────────────────────────────────────────────

  const showNotification = (reminder, milesOver) => {
    _pendingNotifReminder = reminder;
    const vehicles = Array.isArray(reminder.vehicles) ? reminder.vehicles : [reminder.vehicle];
    document.getElementById('notifTitle').textContent =
      `Maintenance Reminder Triggered — ${vehicles.join(', ')}`;
    document.getElementById('notifDesc').textContent =
      `${reminder.task} is due` +
      (milesOver > 0 ? ` — ${milesOver.toLocaleString()} mi over trigger` : '');
    document.getElementById('notifBanner').style.display = 'flex';
    const dot = document.getElementById('notifDot');
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
    const r        = _pendingNotifReminder;
    const vehicles = Array.isArray(r.vehicles) ? r.vehicles : [r.vehicle];
    const assignee = document.getElementById('accept-assignee')?.value || 'Unassigned';
    const date     = document.getElementById('accept-date')?.value    || new Date().toISOString().split('T')[0];
    const notes    = document.getElementById('accept-notes')?.value   || '';

    const created = vehicles.map(vehicleId => {
      const info = KNOWN_VEHICLES.find(v => v.id === vehicleId);
      return DataStore.addWorkOrder({
        vehicle: vehicleId, make: info ? info.make : '',
        task: r.task, status: 'Open', assignee,
        odo: r.current ? r.current.toLocaleString() : '0',
        cost: null, date,
        notes: notes || `Auto-created from reminder ${r.id}`,
        parts: '', labor: '', reminderId: r.id,
      });
    });

    closeModal('acceptModal');
    _pendingNotifReminder = null;
    refreshAll();
    switchTab('workorders');
    _showToast(created.length === 1
      ? `✓ Work Order ${created[0].id} created`
      : `✓ ${created.length} Work Orders created`);
  };

  // ── Reminder Modal ─────────────────────────────────────────────────────────

  const openReminderModal = async (reminderId) => {
    _editingReminderId = reminderId || null;
    const existing = reminderId ? DataStore.getReminder(reminderId) : null;

    // Reset asset state
    _selectedAssets = new Set(
      existing
        ? (Array.isArray(existing.vehicles) ? existing.vehicles : [existing.vehicle].filter(Boolean))
        : []
    );

    document.getElementById('reminderModalTitle').textContent =
      existing ? `✏️ Edit Reminder — ${existing.task}` : '＋ New Maintenance Reminder';

    // Render the modal shell with a loading state for the assets table
    document.getElementById('reminderModalBody').innerHTML = _getReminderFormHTML(existing);
    document.getElementById('reminderModal').style.display = 'flex';

    // Load asset data from Geotab async, then populate the table
    _renderAssetTableLoading();
    try {
      _allAssets      = await GeotabIntegration.getVehicleAssetData();
      _filteredAssets = [..._allAssets];
      _renderAssetTable();
    } catch (err) {
      console.error('Could not load asset data:', err);
      // Fall back to plain vehicle list from KNOWN_VEHICLES
      _allAssets      = KNOWN_VEHICLES.map(v => ({ name: v.id, id: v.id, make: v.make, lastOdometer: null, lastEngineHours: null, lastMaintenanceDate: null }));
      _filteredAssets = [..._allAssets];
      _renderAssetTable();
    }
  };

  // ── Reminder Form HTML ─────────────────────────────────────────────────────

  const _getReminderFormHTML = (r) => {
    const existingConditions = r && r.conditions ? r.conditions : [];
    const hasTime  = existingConditions.find(c => c.type === 'time');
    const hasDist  = existingConditions.find(c => c.type === 'distance');
    const hasHours = existingConditions.find(c => c.type === 'engineHours');

    return `
    <!-- ── Task & Priority ── -->
    <div class="form-section-label">Task &amp; Details</div>
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
          <option${r && r.priority === 'High'   ? ' selected' : ''}>High</option>
          <option${!r || r.priority === 'Medium' ? ' selected' : ''}>Medium</option>
          <option${r && r.priority === 'Low'    ? ' selected' : ''}>Low</option>
        </select>
      </div>
      <div class="form-group">
        <label>Assigned To</label>
        <input type="text" id="r-assignee" placeholder="Technician or shop" value="${r ? r.assignee || '' : ''}">
      </div>
      <div class="form-group full">
        <label>Notes / Description</label>
        <textarea id="r-notes" placeholder="Additional instructions...">${r ? r.notes || '' : ''}</textarea>
      </div>
    </div>

    <!-- ── Conditions ── -->
    <div class="form-section-label" style="margin-top:20px">Conditions
      <span style="font-weight:400;font-size:10px;color:var(--text-dim);text-transform:none;letter-spacing:0;margin-left:6px">Select one or more trigger conditions</span>
    </div>
    <div class="conditions-wrap">

      <!-- Time -->
      <div class="condition-block" id="cond-time-block">
        <label class="condition-toggle">
          <input type="checkbox" id="cond-time-check" onchange="app._toggleCondition('time')"
            ${hasTime ? 'checked' : ''}>
          <span class="condition-label">📅 Repeats by time</span>
        </label>
        <div class="condition-fields" id="cond-time-fields" style="display:${hasTime ? 'flex' : 'none'}">
          <div class="form-group">
            <label>Every (days)</label>
            <input type="number" id="cond-time-value" placeholder="e.g. 90" value="${hasTime ? hasTime.value : ''}">
          </div>
          <div class="form-group">
            <label>Warn (days before)</label>
            <input type="number" id="cond-time-warn" placeholder="e.g. 7" value="${hasTime ? hasTime.warn || '' : ''}">
          </div>
        </div>
      </div>

      <!-- Distance -->
      <div class="condition-block" id="cond-distance-block">
        <label class="condition-toggle">
          <input type="checkbox" id="cond-distance-check" onchange="app._toggleCondition('distance')"
            ${hasDist ? 'checked' : ''}>
          <span class="condition-label">🛣 Repeats by distance</span>
        </label>
        <div class="condition-fields" id="cond-distance-fields" style="display:${hasDist ? 'flex' : 'none'}">
          <div class="form-group">
            <label>Every (miles)</label>
            <input type="number" id="cond-distance-value" placeholder="e.g. 5000" value="${hasDist ? hasDist.value : ''}">
          </div>
          <div class="form-group">
            <label>Warn (miles before)</label>
            <input type="number" id="cond-distance-warn" placeholder="e.g. 500" value="${hasDist ? hasDist.warn || '' : ''}">
          </div>
        </div>
      </div>

      <!-- Engine Hours -->
      <div class="condition-block" id="cond-hours-block">
        <label class="condition-toggle">
          <input type="checkbox" id="cond-hours-check" onchange="app._toggleCondition('engineHours')"
            ${hasHours ? 'checked' : ''}>
          <span class="condition-label">⏱ Repeats by engine hours</span>
        </label>
        <div class="condition-fields" id="cond-hours-fields" style="display:${hasHours ? 'flex' : 'none'}">
          <div class="form-group">
            <label>Every (hours)</label>
            <input type="number" id="cond-hours-value" placeholder="e.g. 250" value="${hasHours ? hasHours.value : ''}">
          </div>
          <div class="form-group">
            <label>Warn (hours before)</label>
            <input type="number" id="cond-hours-warn" placeholder="e.g. 10" value="${hasHours ? hasHours.warn || '' : ''}">
          </div>
        </div>
      </div>

    </div>

    <!-- ── Assets ── -->
    <div class="form-section-label" style="margin-top:20px">Assets
      <span style="font-weight:400;font-size:10px;color:var(--text-dim);text-transform:none;letter-spacing:0;margin-left:6px">Select vehicles to apply this reminder to</span>
    </div>
    <div class="asset-picker-wrap">
      <div class="asset-picker-toolbar">
        <input class="search-input" id="assetSearch" placeholder="Search assets..."
          oninput="app._filterAssets(this.value)" style="max-width:260px">
        <button class="btn btn-ghost btn-sm" onclick="app._selectAllAssets()" id="assetSelectAllBtn">Select All</button>
        <span id="assetSelectedCount" style="font-family:var(--mono);font-size:11px;color:var(--text-muted);margin-left:auto">
          0 selected
        </span>
      </div>
      <div id="assetTableWrap">
        <!-- Populated async by openReminderModal -->
      </div>
    </div>`;
  };

  // ── Asset Table Rendering ──────────────────────────────────────────────────

  const _renderAssetTableLoading = () => {
    const wrap = document.getElementById('assetTableWrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px">
        <span class="spinner-border spinner-border-sm" style="width:14px;height:14px;border-width:2px;display:inline-block;border-radius:50%;border:2px solid var(--text-dim);border-top-color:var(--accent2);animation:spin 0.7s linear infinite;margin-right:8px"></span>
        Loading vehicles from Geotab...
      </div>`;
  };

  const _renderAssetTable = () => {
    const wrap = document.getElementById('assetTableWrap');
    if (!wrap) return;

    _updateAssetSelectedCount();

    if (_filteredAssets.length === 0) {
      wrap.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No vehicles found</div>`;
      return;
    }

    const allFilteredSelected = _filteredAssets.length > 0 &&
      _filteredAssets.every(a => _selectedAssets.has(a.name));

    wrap.innerHTML = `
      <table class="asset-table">
        <thead>
          <tr>
            <th style="width:36px">
              <input type="checkbox" id="assetCheckAll"
                ${allFilteredSelected ? 'checked' : ''}
                onchange="app._toggleAllFiltered(this.checked)">
            </th>
            <th>Asset</th>
            <th>Last Maintenance</th>
            <th>Last Odometer</th>
            <th>Last Engine Hours</th>
          </tr>
        </thead>
        <tbody>
          ${_filteredAssets.map(a => `
            <tr class="asset-row${_selectedAssets.has(a.name) ? ' selected' : ''}"
                onclick="app._toggleAsset('${a.name}')">
              <td onclick="event.stopPropagation()">
                <input type="checkbox" ${_selectedAssets.has(a.name) ? 'checked' : ''}
                  onchange="app._toggleAsset('${a.name}')">
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="vehicle-avatar" style="width:28px;height:28px;font-size:13px">🚛</div>
                  <div>
                    <div style="font-weight:500;font-size:12px">${a.name}</div>
                    ${a.make ? `<div style="font-size:11px;color:var(--text-muted)">${a.make}</div>` : ''}
                  </div>
                </div>
              </td>
              <td style="font-family:var(--mono);font-size:11px;color:var(--text-muted)">
                ${a.lastMaintenanceDate || '—'}
              </td>
              <td style="font-family:var(--mono);font-size:11px;color:var(--text-muted)">
                ${a.lastOdometer != null ? a.lastOdometer.toLocaleString() + ' mi' : '—'}
              </td>
              <td style="font-family:var(--mono);font-size:11px;color:var(--text-muted)">
                ${a.lastEngineHours != null ? a.lastEngineHours.toLocaleString() + ' hrs' : '—'}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  };

  const _updateAssetSelectedCount = () => {
    const el = document.getElementById('assetSelectedCount');
    if (el) el.textContent = `${_selectedAssets.size} selected`;
  };

  const _toggleAsset = (name) => {
    if (_selectedAssets.has(name)) {
      _selectedAssets.delete(name);
    } else {
      _selectedAssets.add(name);
    }
    _renderAssetTable();
  };

  const _toggleAllFiltered = (checked) => {
    _filteredAssets.forEach(a => {
      if (checked) {
        _selectedAssets.add(a.name);
      } else {
        _selectedAssets.delete(a.name);
      }
    });
    _renderAssetTable();
  };

  const _selectAllAssets = () => {
    const allSelected = _filteredAssets.every(a => _selectedAssets.has(a.name));
    _filteredAssets.forEach(a => {
      if (allSelected) {
        _selectedAssets.delete(a.name);
      } else {
        _selectedAssets.add(a.name);
      }
    });
    _renderAssetTable();
  };

  const _filterAssets = (query) => {
    const q = query.toLowerCase();
    _filteredAssets = q
      ? _allAssets.filter(a =>
          a.name.toLowerCase().includes(q) ||
          (a.make || '').toLowerCase().includes(q)
        )
      : [..._allAssets];
    _renderAssetTable();
  };

  // ── Condition Toggle ───────────────────────────────────────────────────────

  const _toggleCondition = (type) => {
    const fieldMap = { time: 'cond-time-fields', distance: 'cond-distance-fields', engineHours: 'cond-hours-fields' };
    const checkMap = { time: 'cond-time-check',  distance: 'cond-distance-check',  engineHours: 'cond-hours-check'  };
    const checked  = document.getElementById(checkMap[type])?.checked;
    const fields   = document.getElementById(fieldMap[type]);
    if (fields) fields.style.display = checked ? 'flex' : 'none';
  };

  const _taskSelectChanged = (val) => {
    const grp = document.getElementById('r-custom-group');
    if (grp) grp.style.display = val === 'Custom Issue / Repair' ? 'flex' : 'none';
  };

  // ── Save Reminder ──────────────────────────────────────────────────────────

  const saveReminder = () => {
    if (_selectedAssets.size === 0) {
      _showToast('Please select at least one vehicle', true); return;
    }

    // Collect conditions
    const conditions = [];

    if (document.getElementById('cond-time-check')?.checked) {
      const val  = parseInt(document.getElementById('cond-time-value')?.value);
      const warn = parseInt(document.getElementById('cond-time-warn')?.value)  || 0;
      if (!val) { _showToast('Please enter a value for the Time condition', true); return; }
      conditions.push({ type: 'time', value: val, warn });
    }

    if (document.getElementById('cond-distance-check')?.checked) {
      const val  = parseInt(document.getElementById('cond-distance-value')?.value);
      const warn = parseInt(document.getElementById('cond-distance-warn')?.value) || 0;
      if (!val) { _showToast('Please enter a value for the Distance condition', true); return; }
      conditions.push({ type: 'distance', value: val, warn });
    }

    if (document.getElementById('cond-hours-check')?.checked) {
      const val  = parseInt(document.getElementById('cond-hours-value')?.value);
      const warn = parseInt(document.getElementById('cond-hours-warn')?.value)  || 0;
      if (!val) { _showToast('Please enter a value for the Engine Hours condition', true); return; }
      conditions.push({ type: 'engineHours', value: val, warn });
    }

    if (conditions.length === 0) {
      _showToast('Please select at least one condition', true); return;
    }

    const taskSel = document.getElementById('r-task-select')?.value;
    const customT = document.getElementById('r-custom-task')?.value?.trim();
    const task    = taskSel === 'Custom Issue / Repair' ? (customT || 'Custom Task') : taskSel;
    if (!task) { _showToast('Please select a task', true); return; }

    const vehicles = [..._selectedAssets];

    // Determine overall status from distance condition if present
    const distCond = conditions.find(c => c.type === 'distance');
    let status = 'scheduled';
    if (distCond) {
      // Get current odometer of first vehicle as proxy
      const firstAsset = _allAssets.find(a => a.name === vehicles[0]);
      if (firstAsset && firstAsset.lastOdometer != null) {
        if (firstAsset.lastOdometer >= distCond.value) status = 'overdue';
        else if (distCond.value - firstAsset.lastOdometer <= distCond.warn) status = 'due-soon';
      }
    }

    const data = {
      vehicles,
      vehicle:  vehicles[0],
      make:     KNOWN_VEHICLES.find(v => v.id === vehicles[0])?.make || '',
      task,
      conditions,
      // Legacy fields for backward compat with odometer polling
      type:     distCond ? 'Interval' : conditions[0]?.type === 'time' ? 'Date' : 'Engine Hours',
      target:   distCond ? distCond.value : 0,
      warn:     distCond ? distCond.warn  : 0,
      current:  _allAssets.find(a => a.name === vehicles[0])?.lastOdometer || 0,
      status,
      priority: document.getElementById('r-priority')?.value || 'Medium',
      assignee: document.getElementById('r-assignee')?.value?.trim() || '',
      notes:    document.getElementById('r-notes')?.value?.trim()    || '',
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
      body.innerHTML    = _getWOFormHTML();
      footer.innerHTML  = `
        <button class="btn btn-ghost" onclick="app.closeModal('woModal')">Cancel</button>
        <button class="btn btn-primary" onclick="app._saveNewWO()">Create Work Order</button>`;
    } else {
      const wo = DataStore.getWorkOrder(woId);
      if (!wo) return;
      title.innerHTML  = `<span style="color:var(--accent2);margin-right:8px">${wo.id}</span>${wo.task}`;
      body.innerHTML   = _getWODetailHTML(wo);
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
      wo.status === 'Open'        ? `<span class="badge badge-info">Open</span>`        :
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
      odo:  document.getElementById('wo-odo')?.value  || '0',
      cost: parseFloat(document.getElementById('wo-cost')?.value)  || null,
      date: document.getElementById('wo-date')?.value || new Date().toISOString().split('T')[0],
      notes: document.getElementById('wo-notes')?.value?.trim()  || '',
      parts: document.getElementById('wo-parts')?.value?.trim()  || '',
      labor: document.getElementById('wo-labor')?.value?.trim()  || '',
      reminderId: null,
    });

    closeModal('woModal');
    refreshAll();
    _showToast(`✓ Work Order ${wo.id} created`);
  };

  const _saveWOEdits = (woId) => {
    DataStore.updateWorkOrder(woId, {
      assignee:       document.getElementById('wo-assignee')?.value       || '',
      odo:            document.getElementById('wo-odo')?.value            || '',
      notes:          document.getElementById('wo-notes')?.value          || '',
      parts:          document.getElementById('wo-parts')?.value          || '',
      labor:          document.getElementById('wo-labor')?.value          || '',
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
      assignee:       document.getElementById('wo-assignee')?.value       || '',
      odo:            document.getElementById('wo-odo')?.value            || '',
      notes:          document.getElementById('wo-notes')?.value          || '',
      parts:          document.getElementById('wo-parts')?.value          || '',
      labor:          document.getElementById('wo-labor')?.value          || '',
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
    el.className  = 'toast' + (error ? ' error' : '');
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
    _taskSelectChanged, _toggleCondition,
    _toggleAsset, _toggleAllFiltered, _selectAllAssets, _filterAssets,
    showNotification, dismissNotif, openAcceptModal, acceptAndCreateWO,
    filterWorkOrders, filterWOByStatus,
    openWOModal, _saveNewWO, _saveWOEdits, _saveAndCompleteWO, _updateWO,
    closeModal, closeModalOnOverlay,
  };

})();
})();
