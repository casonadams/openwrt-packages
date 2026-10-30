'use strict';
'require view';
'require dom';
'require ui';
'require uci';
'require rpc';
'require form';

const callHostHints = rpc.declare({
	object: 'luci-rpc',
	method: 'getHostHints',
	expect: { '': {} }
});

const callSystemInfo = rpc.declare({
	object: 'system',
	method: 'info',
	expect: { '': {} }
});

const callExec = rpc.declare({
	object: 'file',
	method: 'exec',
	params: [ 'command', 'params' ],
	expect: { '': {} }
});

function parse24to12(timeStr) {
	if (!timeStr) return { h: 6, m: 0, ampm: 'PM' };
	const parts = String(timeStr).split(':');
	let h = parseInt(parts[0], 10);
	if (isNaN(h)) h = 18;
	let m = parseInt(parts[1], 10);
	if (isNaN(m)) m = 0;
	const ampm = (h >= 12) ? 'PM' : 'AM';
	let h12 = h % 12;
	if (h12 === 0) h12 = 12;
	return { h: h12, m: m, ampm: ampm };
}

function parse12to24(h12, m, ampm) {
	let h = parseInt(h12, 10);
	if (isNaN(h)) h = 12;
	const min = parseInt(m, 10);
	const mins = isNaN(min) ? 0 : min;
	if (ampm === 'PM' && h < 12) {
		h += 12;
	} else if (ampm === 'AM' && h === 12) {
		h = 0;
	}
	const hStr = (h < 10 ? '0' : '') + h;
	const mStr = (mins < 10 ? '0' : '') + mins;
	return hStr + ':' + mStr + ':00';
}

function formatDurationLabel(mins) {
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	if (h > 0 && m > 0) return h + 'h ' + m + 'm';
	if (h > 0) return h + 'h';
	return m + 'm';
}

function calcCutoffLabel(start24, durationMins) {
	const parts = String(start24 || '18:00:00').split(':');
	let h = parseInt(parts[0], 10);
	if (isNaN(h)) h = 18;
	let m = parseInt(parts[1], 10);
	if (isNaN(m)) m = 0;
	const dur = parseInt(durationMins, 10) || 90;

	const startTot = h * 60 + m;
	const stopTot = (startTot + dur) % 1440;
	const stopH = Math.floor(stopTot / 60);
	const stopM = stopTot % 60;
	const ampm = (stopH >= 12) ? 'PM' : 'AM';
	let h12 = stopH % 12;
	if (h12 === 0) h12 = 12;
	return h12 + ':' + (stopM < 10 ? '0' : '') + stopM + ' ' + ampm;
}

function formatDaysLabel(rawDays) {
	if (!rawDays || rawDays === 'all') return _('Daily');
	let days = [];
	if (Array.isArray(rawDays)) {
		days = rawDays;
	} else if (typeof rawDays === 'string') {
		days = rawDays.split(/[,\s]+/).filter(Boolean);
	}
	days = days.filter(d => d.toLowerCase() !== 'all');
	if (days.length === 0 || days.length === 7) return _('Daily');

	const daySet = new Set(days.map(d => d.toLowerCase()));
	const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'];
	const weekends = ['sat', 'sun'];

	if (weekdays.every(d => daySet.has(d)) && daySet.size === 5) return _('Weekdays');
	if (weekends.every(d => daySet.has(d)) && daySet.size === 2) return _('Weekends');

	const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
	const labels = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
	return order.filter(d => daySet.has(d)).map(d => labels[d] || d).join(', ');
}

const TimePicker12h = form.Value.extend({
	default: '18:00:00',

	formvalue: function(section_id) {
		const node = this.map.findElement('id', this.cbid(section_id));
		if (!node) {
			const cfg = this.cfgvalue(section_id);
			return (cfg != null && cfg !== '') ? cfg : this.default;
		}
		const hSel = node.querySelector('.tp-hour');
		const mSel = node.querySelector('.tp-minute');
		const aSel = node.querySelector('.tp-ampm');
		const h = hSel ? hSel.value : '6';
		const m = mSel ? mSel.value : '0';
		const a = aSel ? aSel.value : 'PM';
		return parse12to24(h, m, a);
	},

	validate: function(_section_id, value) {
		if (!value || !/^\d{2}:\d{2}:\d{2}$/.test(value)) {
			return _('Invalid time format');
		}
		return true;
	},

	renderWidget: function(section_id, _option_index, cfgvalue) {
		const parsed = parse24to12(cfgvalue || this.default);

		const selStyle = 'width:68px !important;max-width:68px !important;min-width:58px !important;flex:0 0 68px !important;height:32px;';
		const hourSelect = E('select', { 'class': 'cbi-input-select tp-hour', 'style': selStyle });
		for (let hr = 1; hr <= 12; hr++) {
			hourSelect.appendChild(E('option', {
				'value': hr,
				'selected': (hr === parsed.h) ? '' : null
			}, (hr < 10 ? '0' : '') + hr));
		}

		const minuteSelect = E('select', { 'class': 'cbi-input-select tp-minute', 'style': selStyle });
		const mins = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
		if (!mins.includes(parsed.m)) mins.push(parsed.m);
		mins.sort((a, b) => a - b);
		for (let i = 0; i < mins.length; i++) {
			minuteSelect.appendChild(E('option', {
				'value': mins[i],
				'selected': (mins[i] === parsed.m) ? '' : null
			}, (mins[i] < 10 ? '0' : '') + mins[i]));
		}

		const ampmStyle = 'width:76px !important;max-width:76px !important;min-width:68px !important;flex:0 0 76px !important;height:32px;';
		const ampmSelect = E('select', { 'class': 'cbi-input-select tp-ampm', 'style': ampmStyle }, [
			E('option', { 'value': 'AM', 'selected': (parsed.ampm === 'AM') ? '' : null }, 'AM'),
			E('option', { 'value': 'PM', 'selected': (parsed.ampm === 'PM') ? '' : null }, 'PM')
		]);

		const node = E('div', {
			'id': this.cbid(section_id),
			'style': 'display:inline-flex;align-items:center;gap:6px;max-width:240px;width:auto;'
		}, [
			hourSelect,
			E('span', { 'style': 'font-weight:700;padding:0 2px;' }, ':'),
			minuteSelect,
			ampmSelect
		]);
		return node;
	}
});

const CompactDayPicker = form.Value.extend({
	default: 'all',

	formvalue: function(section_id) {
		const node = this.map.findElement('id', this.cbid(section_id));
		if (!node) {
			const cfg = this.cfgvalue(section_id);
			return (cfg != null && cfg !== '') ? cfg : this.default;
		}
		const hidden = node.querySelector('input[type="hidden"]');
		return hidden ? hidden.value : this.default;
	},

	validate: function(_section_id, _value) {
		return true;
	},

	renderWidget: function(section_id, _option_index, cfgvalue) {
		const daysMap = [
			{ key: 'mon', label: 'M', title: _('Monday') },
			{ key: 'tue', label: 'T', title: _('Tuesday') },
			{ key: 'wed', label: 'W', title: _('Wednesday') },
			{ key: 'thu', label: 'T', title: _('Thursday') },
			{ key: 'fri', label: 'F', title: _('Friday') },
			{ key: 'sat', label: 'S', title: _('Saturday') },
			{ key: 'sun', label: 'S', title: _('Sunday') }
		];

		const rawVal = cfgvalue || this.default;
		let selectedDays = [];
		if (rawVal === 'all') {
			selectedDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
		} else if (Array.isArray(rawVal)) {
			selectedDays = rawVal;
		} else if (typeof rawVal === 'string') {
			selectedDays = rawVal.split(/[,\s]+/).filter(Boolean);
		}

		const hiddenInput = E('input', {
			'type': 'hidden',
			'name': this.cbid(section_id),
			'value': rawVal
		});

		const container = E('div', {
			'id': this.cbid(section_id),
			'style': 'display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;'
		});
		container.appendChild(hiddenInput);

		const buttons = [];
		const updateHiddenValue = function() {
			if (selectedDays.length === 7 || selectedDays.length === 0) {
				hiddenInput.value = 'all';
			} else {
				hiddenInput.value = selectedDays.join(' ');
			}
		};

		daysMap.forEach(function(d) {
			let active = selectedDays.includes(d.key);
			const btn = E('button', {
				'type': 'button',
				'title': d.title,
				'style': 'min-width:32px;height:30px;padding:0 4px;font-size:12px;font-weight:700;'
			}, d.label);

			const updateDayStyle = function() {
				btn.className = active ? 'btn cbi-button cbi-button-action important' : 'btn cbi-button';
			};

			updateDayStyle();

			btn.addEventListener('click', function(ev) {
				ev.preventDefault();
				ev.stopPropagation();
				active = !active;
				if (active) {
					if (!selectedDays.includes(d.key)) selectedDays.push(d.key);
				} else {
					selectedDays = selectedDays.filter(k => k !== d.key);
				}
				updateDayStyle();
				updateHiddenValue();
			});

			buttons.push(btn);
			container.appendChild(btn);
		});

		return container;
	}
});

function wrapOperation(indicatorId, msg, fn) {
	ui.showModal(null, E('p', { 'class': 'spinning' }, [ msg ]));
	return fn().then(function(res) {
		ui.hideModal();
		window.location.reload();
		return res;
	}).catch(function(err) {
		ui.hideModal();
		ui.addNotification(null, E('p', [ _('Operation failed: ') + (err.message || err) ]));
		throw err;
	});
}

return view.extend({

	handleSaveApply: function(_ev, mode) {
		const isSaveOnly = (mode === 'save_only');
		const msg = isSaveOnly ? _('Saving Screen Time settings...') : _('Applying Screen Time settings...');
		return wrapOperation('save-op', msg, function() {
			const tasks = [];
			document.querySelectorAll('.cbi-map').forEach(function(mapNode) {
				const mapInst = dom.findClassInstance(mapNode);
				if (mapInst && typeof mapInst.save === 'function') {
					tasks.push(mapInst.save(null, true));
				}
			});
			return Promise.all(tasks)
				.then(function() {
					return callExec('/usr/bin/screentime', ['commit']);
				})
				.then(function() {
					if (!isSaveOnly) {
						return callExec('/usr/bin/screentime', ['sync']);
					}
					return true;
				})
				.then(function() {
					if (ui.changes && typeof ui.changes.setIndicator === 'function') {
						ui.changes.setIndicator(0);
					}
					document.dispatchEvent(new CustomEvent('uci-applied'));
					return true;
				});
		});
	},

	handleSave: function(ev) {
		return this.handleSaveApply(ev, 'save_only');
	},

	handleReset: function(_ev) {
		return wrapOperation('reset-op', _('Reverting changes...'), function() {
			return uci.unload('screentime')
				.then(function() {
					return uci.load('screentime');
				});
		});
	},

	load: function() {
		return Promise.all([
			uci.load('screentime'),
			uci.load('system'),
			callHostHints(),
			callSystemInfo(),
			callExec('/usr/bin/screentime', ['get-state'])
		]);
	},

	render: function(data) {
		const hostHints = data[2] || {};
		const sysInfo = data[3] || {};
		const stateRaw = (data[4] && data[4].stdout) ? data[4].stdout.trim() : 'downtime|none';

		const stateParts = stateRaw.split('|');
		const currentStatus = stateParts[0] || 'downtime';
		const overrideMode = stateParts[1] || 'none';

		const routerTzName = uci.get('system', '@system[0]', 'zonename') || 'UTC';
		const routerTimestamp = (sysInfo.localtime || Math.floor(Date.now() / 1000)) * 1000;
		const routerDate = new Date(routerTimestamp);
		const routerTimeStr = routerDate.toLocaleTimeString('en-US', {
			timeZone: 'UTC',
			hour: 'numeric',
			minute: '2-digit'
		});

		let m, s, o;

		m = new form.Map('screentime', _('Screen Time'),
			_('Automated curfew, bedtime scheduling, and parental controls for home network devices.'));

		// 1. Natural Header Control Bar: "Bypass Until Next Window" / "Resume Schedule"
		s = m.section(form.NamedSection, 'settings', 'settings');
		s.render = function() {
			const runAction = function(cmd, el) {
				el.disabled = true;
				wrapOperation('override-op', _('Updating...'), function() {
					return callExec('/usr/bin/screentime', [cmd]);
				}).catch(function() {
					el.disabled = false;
				});
			};

			// Status badge using LuCI's native ifacebadge and theme color variables
			const isBypassed = (overrideMode === 'ignore_downtime');
			const isForcedDowntime = (overrideMode === 'forced_downtime');
			const inDowntime = (currentStatus === 'downtime' && !isBypassed) || isForcedDowntime;

			let dotColor = 'var(--success-color-high)';
			let statusText = _('Downtime Active');

			if (isBypassed) {
				dotColor = 'var(--error-color-high)'; // Red when bypassed!
				statusText = _('Schedule Bypassed');
			} else if (inDowntime) {
				dotColor = 'var(--success-color-high)'; // Green when downtime curfew is active!
				statusText = _('Downtime Active');
			} else {
				dotColor = 'var(--success-color-high)'; // Green when normal schedule is running
				statusText = _('Schedule Active');
			}

			const statusBadge = E('span', {
				'class': 'ifacebadge',
				'style': 'display:inline-flex;align-items:center;padding:4px 10px;font-size:12px;font-weight:600;'
			}, [
				E('span', {
					'style': 'display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:' + dotColor
				}),
				statusText
			]);

			// Clean Router Clock using LuCI's native ifacebadge
			const clockBadge = E('span', {
				'class': 'ifacebadge',
				'style': 'display:inline-flex;align-items:center;padding:4px 10px;font-size:12px;opacity:0.85;'
			}, routerTimeStr + ' (' + routerTzName + ')');

			// Quick Action Button
			const actionBtn = E('button', {
				'type': 'button',
				'style': 'margin-right:8px;'
			});

			if (overrideMode !== 'none') {
				actionBtn.textContent = _('Resume Schedule');
				actionBtn.className = 'btn cbi-button cbi-button-action important';
				actionBtn.addEventListener('click', function() {
					runAction('clear-override', actionBtn);
				});
			} else if (currentStatus === 'downtime') {
				actionBtn.textContent = _('Ignore Downtime Until Next Window');
				actionBtn.className = 'btn cbi-button cbi-button-negative important';
				actionBtn.addEventListener('click', function() {
					runAction('ignore-downtime', actionBtn);
				});
			} else {
				actionBtn.textContent = _('Turn On Downtime Now');
				actionBtn.className = 'btn cbi-button cbi-button-negative important';
				actionBtn.addEventListener('click', function() {
					runAction('turn-on-downtime', actionBtn);
				});
			}

			return E('div', {
				'class': 'cbi-section',
				'style': 'margin-bottom:16px;padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;'
			}, [
				actionBtn,
				E('div', { 'style': 'display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;' }, [
					statusBadge,
					clockBadge
				])
			]);
		};

		// 2. Allowed Schedules Section (Model A: GridSection with responsive modal editing)
		s = m.section(form.GridSection, 'schedule', _('Allowed Schedules'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;
		s.modaltitle = _('Screen Time Schedule');

		// Enable Switch (visible in table and modal)
		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = o.enabled;
		o.editable = true;

		// Summary column for overview grid (desktop/mobile table)
		o = s.option(form.DummyValue, '_summary', _('Schedule Window'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			const name = uci.get('screentime', section_id, 'name');
			const start = uci.get('screentime', section_id, 'start_time') || '18:00:00';
			const dur = uci.get('screentime', section_id, 'duration') || '90';
			const days = uci.get('screentime', section_id, 'weekdays') || 'all';

			const startParts = parse24to12(start);
			const startStr = startParts.h + ':' + (startParts.m < 10 ? '0' : '') + startParts.m + ' ' + startParts.ampm;
			const endStr = calcCutoffLabel(start, dur);
			const daysStr = formatDaysLabel(days);

			const children = [];
			if (name) {
				children.push(E('strong', { 'style': 'display:block;margin-bottom:2px;' }, name));
			}
			children.push(E('span', { 'style': 'font-weight:600;' }, startStr + ' – ' + endStr));
			children.push(document.createTextNode(' '));
			children.push(E('span', { 'style': 'opacity:0.75;font-size:12px;' }, '(' + daysStr + ')'));

			return E('div', { 'style': 'line-height:1.4;' }, children);
		};

		// Dedicated Duration summary column on main grid
		o = s.option(form.DummyValue, '_duration_summary', _('Duration'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			const dur = uci.get('screentime', section_id, 'duration') || '90';
			return E('span', { 'style': 'font-weight:600;' }, formatDurationLabel(dur));
		};

		// Applies To summary for overview grid
		o = s.option(form.DummyValue, '_devices_summary', _('Applies To'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			const targetDevs = uci.get('screentime', section_id, 'devices');
			if (!targetDevs || targetDevs === 'all' || (Array.isArray(targetDevs) && targetDevs.includes('all'))) {
				return E('span', {
					'class': 'ifacebadge',
					'style': 'display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;'
				}, _('All Devices'));
			}
			const count = Array.isArray(targetDevs) ? targetDevs.length : 1;
			return E('span', {
				'class': 'ifacebadge ifacebadge-active',
				'style': 'display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;'
			}, (count === 1 ? _('1 Device') : _('%d Devices').format(count)));
		};
		// --- Modal-only detailed options ---
		o = s.option(form.Value, 'name', _('Schedule Name'));
		o.modalonly = true;
		o.placeholder = _('e.g. Evening Homework, Bedtime (Optional)');
		o.rmempty = true;

		o = s.option(CompactDayPicker, 'weekdays', _('Days of Week'));
		o.modalonly = true;
		o.default = 'all';

		o = s.option(TimePicker12h, 'start_time', _('Start Time'));
		o.modalonly = true;
		o.default = '18:00:00';

		const durations = [
			15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360
		];
		o = s.option(form.ListValue, 'duration', _('Duration'));
		o.modalonly = true;
		for (let i = 0; i < durations.length; i++) {
			o.value(String(durations[i]), formatDurationLabel(durations[i]));
		}
		o.default = '90';

		o = s.option(form.DummyValue, '_cutoff', _('End Time'));
		o.modalonly = true;
		o.rawhtml = true;
		o.cfgvalue = function(section_id) {
			const start = uci.get('screentime', section_id, 'start_time') || '18:00:00';
			const dur = uci.get('screentime', section_id, 'duration') || '90';
			const cutoffStr = calcCutoffLabel(start, dur);
			return '<strong>' + cutoffStr + '</strong>';
		};

		o = s.option(form.MultiValue, 'devices', _('Applies To (Target Devices)'));
		o.modalonly = true;
		o.default = 'all';
		o.rmempty = true;
		o.value('all', _('All Managed Devices (Default)'));

		const deviceSections = uci.sections('screentime', 'device') || [];
		for (let i = 0; i < deviceSections.length; i++) {
			const devSec = deviceSections[i];
			const mac = (devSec.mac || '').toLowerCase();
			if (mac) {
				const devLabel = devSec.name ? '%s (%s)'.format(devSec.name, mac) : mac;
				o.value(mac, devLabel);
			}
		}

		// 3. Managed Devices Section (Clean 3-column table: Enable, Name, MAC)
		s = m.section(form.TableSection, 'device', _('Managed Devices'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = o.enabled;
		o.editable = true;
		o.write = function(section_id, formvalue) {
			const macVal = uci.get('screentime', section_id, 'mac');
			if (!macVal || macVal === '' || macVal === 'XX:XX:XX:XX:XX:XX') {
				return true;
			}
			return uci.set('screentime', section_id, 'enabled', formvalue);
		};

		o = s.option(form.Value, 'name', _('Device Name'));
		o.placeholder = _('Optional (auto-detects hostname)');
		o.rmempty = true;
		o.write = function(section_id, formvalue) {
			const macVal = uci.get('screentime', section_id, 'mac');
			if (!macVal || macVal === '' || macVal === 'XX:XX:XX:XX:XX:XX') {
				return true;
			}
			let nameVal = formvalue;
			if (!nameVal) {
				const hint = hostHints[macVal.toLowerCase()] || hostHints[macVal.toUpperCase()] || {};
				nameVal = hint.name || '';
			}
			if (nameVal) {
				return uci.set('screentime', section_id, 'name', nameVal);
			}
			return uci.unset('screentime', section_id, 'name');
		};

		o = s.option(form.Value, 'mac', _('MAC Address'));
		o.placeholder = 'XX:XX:XX:XX:XX:XX';
		o.rmempty = true;
		o.validate = function(_section_id, value) {
			if (!value || value === '' || value === 'XX:XX:XX:XX:XX:XX') {
				return true;
			}
			if (!/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(value)) {
				return _('Expecting valid MAC address (e.g. 00:11:22:33:44:55)');
			}
			return true;
		};
		o.write = function(section_id, formvalue) {
			if (!formvalue || formvalue === '' || formvalue === 'XX:XX:XX:XX:XX:XX') {
				return uci.remove('screentime', section_id);
			}
			return uci.set('screentime', section_id, 'mac', formvalue.toLowerCase());
		};
		o.onchange = function(_ev, section_id, value) {
			if (!value) return;
			const nameInput = document.querySelector('[name="cbid.screentime.' + section_id + '.name"]');
			if (nameInput && !nameInput.value) {
				const val = value.toLowerCase();
				const hint = hostHints[val] || hostHints[val.toUpperCase()] || {};
				if (hint.name) {
					nameInput.value = hint.name;
					nameInput.dispatchEvent(new Event('change', { bubbles: true }));
				}
			}
		};

		// Populate dropdown with active/known network hosts from luci-rpc getHostHints
		const sortedMacs = Object.keys(hostHints).sort();
		for (let i = 0; i < sortedMacs.length; i++) {
			const mAddr = sortedMacs[i].toLowerCase();
			const info = hostHints[sortedMacs[i]] || {};
			const name = info.name || '';
			const ips = (info.ipaddrs && info.ipaddrs.length > 0) ? info.ipaddrs[0] : '';

			let label = mAddr;
			if (name && ips) {
				label = '%s — %s (%s)'.format(name, ips, mAddr);
			} else if (name) {
				label = '%s (%s)'.format(name, mAddr);
			} else if (ips) {
				label = '%s (%s)'.format(ips, mAddr);
			}
			o.value(mAddr, label);
		}

		return m.render();
	}
});
