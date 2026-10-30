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
	if (h > 0 && m > 0) return h + ' hr ' + m + ' min';
	if (h > 0) return h + (h === 1 ? ' hour' : ' hours');
	return m + ' min';
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
	const nextDay = (startTot + dur) >= 1440;

	const stopH = Math.floor(stopTot / 60);
	const stopM = stopTot % 60;
	const ampm = (stopH >= 12) ? 'PM' : 'AM';
	let h12 = stopH % 12;
	if (h12 === 0) h12 = 12;
	const mStr = (stopM < 10 ? '0' : '') + stopM;

	return h12 + ':' + mStr + ' ' + ampm + (nextDay ? ' (next day)' : '');
}

// Custom 12-Hour Dropdown Time Picker
const TimePicker12h = form.Value.extend({
	renderWidget: function(section_id, option_index, cfgvalue) {
		const parsed = parse24to12(cfgvalue);

		const hourSelect = E('select', {
			'class': 'cbi-input-select',
			'style': 'width:auto;display:inline-block;margin-right:4px;font-weight:600;'
		});
		for (let h = 1; h <= 12; h++) {
			hourSelect.appendChild(E('option', {
				'value': h,
				'selected': (h === parsed.h) ? '' : null
			}, String(h)));
		}

		const minSelect = E('select', {
			'class': 'cbi-input-select',
			'style': 'width:auto;display:inline-block;margin-right:4px;font-family:monospace;'
		});
		for (let m = 0; m < 60; m += 5) {
			const mStr = (m < 10 ? '0' : '') + m;
			minSelect.appendChild(E('option', {
				'value': m,
				'selected': (m === parsed.m) ? '' : null
			}, ':' + mStr));
		}

		const ampmSelect = E('select', {
			'class': 'cbi-input-select',
			'style': 'width:auto;display:inline-block;font-weight:700;'
		});
		ampmSelect.appendChild(E('option', {
			'value': 'AM',
			'selected': (parsed.ampm === 'AM') ? '' : null
		}, 'AM'));
		ampmSelect.appendChild(E('option', {
			'value': 'PM',
			'selected': (parsed.ampm === 'PM') ? '' : null
		}, 'PM'));

		const hiddenInput = E('input', {
			'type': 'hidden',
			'id': this.cbid(section_id),
			'name': this.cbid(section_id),
			'value': parse12to24(parsed.h, parsed.m, parsed.ampm)
		});

		const updateVal = function() {
			const val24 = parse12to24(hourSelect.value, minSelect.value, ampmSelect.value);
			hiddenInput.value = val24;
			dom.dispatch(hiddenInput, 'widget-change');
		};

		hourSelect.addEventListener('change', updateVal);
		minSelect.addEventListener('change', updateVal);
		ampmSelect.addEventListener('change', updateVal);

		return E('div', {
			'class': 'time-picker-12h',
			'style': 'display:inline-flex;align-items:center;padding:2px 0;'
		}, [
			hourSelect,
			minSelect,
			ampmSelect,
			hiddenInput
		]);
	}
});

// StatusFlag: Checkbox with live updating subtle green/red active/inactive pill
const StatusFlag = form.Flag.extend({
	renderWidget: function(section_id, option_index, cfgvalue) {
		const node = this.super('renderWidget', [section_id, option_index, cfgvalue]);
		const isChecked = (cfgvalue !== '0' && cfgvalue !== false);

		const pill = E('span', {
			'style': isChecked
				? 'background:rgba(40,167,69,0.15);color:#28a745;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;margin-left:6px;display:inline-block;'
				: 'background:rgba(220,53,69,0.15);color:#e05260;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;margin-left:6px;display:inline-block;'
		}, isChecked ? _('Active') : _('Inactive'));

		const input = node.querySelector('input[type="checkbox"]');
		if (input) {
			input.addEventListener('change', function() {
				if (this.checked) {
					pill.style.background = 'rgba(40,167,69,0.15)';
					pill.style.color = '#28a745';
					pill.textContent = _('Active');
				} else {
					pill.style.background = 'rgba(220,53,69,0.15)';
					pill.style.color = '#e05260';
					pill.textContent = _('Inactive');
				}
			});
		}

		return E('div', {
			'style': 'display:inline-flex;align-items:center;'
		}, [node, pill]);
	}
});

// Compact Day Picker Component (M T W T F S S pill buttons)
const CompactDayPicker = form.Value.extend({
	renderWidget: function(section_id, option_index, cfgvalue) {
		let selectedDays = [];
		if (Array.isArray(cfgvalue)) {
			selectedDays = cfgvalue.slice();
		} else if (typeof cfgvalue === 'string' && cfgvalue.trim() !== '') {
			selectedDays = cfgvalue.trim().split(/\s+/);
		}
		if (selectedDays.length === 0 || selectedDays.indexOf('all') !== -1) {
			selectedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
		}

		const days = [
			{ id: 'Mon', label: 'M', title: _('Monday') },
			{ id: 'Tue', label: 'T', title: _('Tuesday') },
			{ id: 'Wed', label: 'W', title: _('Wednesday') },
			{ id: 'Thu', label: 'T', title: _('Thursday') },
			{ id: 'Fri', label: 'F', title: _('Friday') },
			{ id: 'Sat', label: 'S', title: _('Saturday') },
			{ id: 'Sun', label: 'S', title: _('Sunday') }
		];

		const hiddenInput = E('input', {
			'type': 'hidden',
			'id': this.cbid(section_id),
			'name': this.cbid(section_id),
			'value': (selectedDays.length === 7) ? 'all' : selectedDays.join(' ')
		});

		const container = E('div', {
			'class': 'compact-day-picker',
			'style': 'display:inline-flex;gap:3px;align-items:center;min-width:180px;'
		});

		days.forEach(function(d) {
			let active = (selectedDays.indexOf(d.id) !== -1);
			const btn = E('button', {
				'type': 'button',
				'title': d.title,
				'class': 'cbi-button',
				'style': active
					? 'min-width:22px;height:24px;padding:0 3px;font-size:11px;font-weight:700;line-height:22px;border-radius:3px;background:#007bff;color:#fff;border:1px solid transparent;cursor:pointer;'
					: 'min-width:22px;height:24px;padding:0 3px;font-size:11px;font-weight:600;line-height:22px;border-radius:3px;background:transparent;opacity:0.45;border:1px solid rgba(127,127,127,0.4);cursor:pointer;'
			}, d.label);

			btn.addEventListener('click', function(ev) {
				ev.preventDefault();
				active = !active;
				const idx = selectedDays.indexOf(d.id);
				if (active && idx === -1) {
					selectedDays.push(d.id);
				} else if (!active && idx !== -1) {
					selectedDays.splice(idx, 1);
				}

				if (active) {
					btn.style.background = '#007bff';
					btn.style.color = '#fff';
					btn.style.opacity = '1';
					btn.style.borderColor = 'transparent';
				} else {
					btn.style.background = 'transparent';
					btn.style.color = 'inherit';
					btn.style.opacity = '0.45';
					btn.style.borderColor = 'rgba(127,127,127,0.4)';
				}

				hiddenInput.value = (selectedDays.length === 7) ? 'all' : selectedDays.join(' ');
				dom.dispatch(hiddenInput, 'widget-change');
			});

			container.appendChild(btn);
		});

		container.appendChild(hiddenInput);
		return container;
	}
});

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('internet_schedule'),
			uci.load('system'),
			callHostHints(),
			callSystemInfo()
		]);
	},

	render: function(data) {
		const hostHints = data[2] || {};
		const sysInfo = data[3] || {};

		const routerTzName = uci.get('system', '@system[0]', 'zonename') || 'UTC';
		const routerTz = uci.get('system', '@system[0]', 'timezone') || 'GMT0';
		const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';

		const tzMatch = (routerTzName === browserTz || (routerTzName.indexOf(browserTz) !== -1));

		const routerTimestamp = (sysInfo.localtime || Math.floor(Date.now() / 1000)) * 1000;
		const routerDate = new Date(routerTimestamp);
		const routerDateStr = routerDate.toLocaleString('en-US', {
			timeZone: 'UTC',
			hour12: true,
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			second: '2-digit'
		});
		const browserDateStr = new Date().toLocaleString('en-US', {
			hour12: true,
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			second: '2-digit'
		});

		let m, s, o;

		m = new form.Map('internet_schedule', _('Internet Schedule'),
			_('Curfew and screen time access control for kids, smart TVs, and streaming devices.'));

		// 1. Unified Control Bar: Timezone badge & Instant Override Buttons
		s = m.section(form.NamedSection, 'settings', 'settings');
		s.render = function() {
			const currentMode = uci.get('internet_schedule', 'settings', 'mode') || 'schedule';
			const isEnabled = uci.get('internet_schedule', 'settings', 'enabled') !== '0';

			const runAction = function(modeVal, btnEl) {
				btnEl.disabled = true;
				ui.showIndicator('override-op', _('Applying override...'));
				uci.set('internet_schedule', 'settings', 'enabled', '1');
				uci.set('internet_schedule', 'settings', 'mode', modeVal);
				uci.save()
					.then(function() { return uci.apply(); })
					.then(function() { return callExec('/usr/bin/internet-schedule', ['sync']); })
					.then(function() {
						ui.hideIndicator('override-op');
						window.location.reload();
					})
					.catch(function(err) {
						ui.hideIndicator('override-op');
						btnEl.disabled = false;
						ui.addNotification(null, E('p', {}, err.message || err));
					});
			};

			const runBonus = function(minutes, btnEl) {
				btnEl.disabled = true;
				ui.showIndicator('override-op', _('Granting bonus time...'));
				callExec('/usr/bin/internet-schedule', ['allow-now', String(minutes)])
					.then(function() {
						ui.hideIndicator('override-op');
						window.location.reload();
					})
					.catch(function(err) {
						ui.hideIndicator('override-op');
						btnEl.disabled = false;
						ui.addNotification(null, E('p', {}, err.message || err));
					});
			};

			// Status indicator pill
			let statusPill;
			if (!isEnabled || currentMode === 'unlocked' || currentMode === 'disabled') {
				statusPill = E('span', {
					'style': 'background:#28a745;color:#fff;font-size:12px;font-weight:700;padding:4px 10px;border-radius:15px;display:inline-flex;align-items:center;'
				}, [
					E('span', { 'style': 'display:inline-block;width:7px;height:7px;border-radius:50%;background:#fff;margin-right:6px;' }),
					_('UNLOCKED')
				]);
			} else if (currentMode === 'block') {
				statusPill = E('span', {
					'style': 'background:#dc3545;color:#fff;font-size:12px;font-weight:700;padding:4px 10px;border-radius:15px;display:inline-flex;align-items:center;'
				}, [
					E('span', { 'style': 'display:inline-block;width:7px;height:7px;border-radius:50%;background:#fff;margin-right:6px;' }),
					_('LOCKED DOWN')
				]);
			} else {
				statusPill = E('span', {
					'style': 'background:#007bff;color:#fff;font-size:12px;font-weight:700;padding:4px 10px;border-radius:15px;display:inline-flex;align-items:center;'
				}, [
					E('span', { 'style': 'display:inline-block;width:7px;height:7px;border-radius:50%;background:#fff;margin-right:6px;' }),
					_('SCHEDULE ENFORCED')
				]);
			}

			// Timezone / clock pill
			const tzPill = E('span', {
				'title': tzMatch ? _('Router timezone matches your local time') : _('Warning: Router is in %s while browser is in %s').format(routerTzName, browserTz),
				'style': tzMatch
					? 'background:rgba(127,127,127,0.12);color:inherit;font-size:12px;font-weight:500;padding:4px 10px;border-radius:15px;display:inline-flex;align-items:center;'
					: 'background:rgba(255,193,7,0.2);color:#856404;font-size:12px;font-weight:600;padding:4px 10px;border-radius:15px;display:inline-flex;align-items:center;'
			}, [
				E('span', { 'style': 'margin-right:5px;' }, tzMatch ? '🕒' : '⚠️'),
				routerDateStr.split(',')[1] ? routerDateStr.split(',')[1].trim() : routerDateStr,
				E('span', { 'style': 'opacity:0.6;margin-left:4px;' }, '(' + routerTzName + ')')
			]);

			// Button: Normal Schedule
			const isScheduleActive = (isEnabled && currentMode === 'schedule');
			const btnSchedule = E('button', {
				'type': 'button',
				'class': 'cbi-button',
				'style': isScheduleActive
					? 'padding:7px 14px;font-size:12px;font-weight:700;border-radius:4px;background:#007bff;color:#fff;border:1px solid #007bff;cursor:default;'
					: 'padding:7px 14px;font-size:12px;font-weight:600;border-radius:4px;cursor:pointer;'
			}, [
				E('span', { 'style': 'margin-right:4px;' }, isScheduleActive ? '✓' : '⏰'),
				_('Enforce Schedule')
			]);
			if (!isScheduleActive) {
				btnSchedule.addEventListener('click', function() { runAction('schedule', btnSchedule); });
			}

			// Button: Unlock All
			const isUnlocked = (!isEnabled || currentMode === 'unlocked' || currentMode === 'disabled');
			const btnUnlock = E('button', {
				'type': 'button',
				'class': 'cbi-button',
				'style': isUnlocked
					? 'padding:7px 14px;font-size:12px;font-weight:700;border-radius:4px;background:#28a745;color:#fff;border:1px solid #28a745;cursor:default;'
					: 'padding:7px 14px;font-size:12px;font-weight:600;border-radius:4px;cursor:pointer;'
			}, [
				E('span', { 'style': 'margin-right:4px;' }, isUnlocked ? '✓' : '🔓'),
				_('Unlock All')
			]);
			if (!isUnlocked) {
				btnUnlock.addEventListener('click', function() { runAction('unlocked', btnUnlock); });
			}

			// Button: Emergency Lockdown
			const isBlocked = (isEnabled && currentMode === 'block');
			const btnBlock = E('button', {
				'type': 'button',
				'class': 'cbi-button',
				'style': isBlocked
					? 'padding:7px 14px;font-size:12px;font-weight:700;border-radius:4px;background:#dc3545;color:#fff;border:1px solid #dc3545;cursor:default;'
					: 'padding:7px 14px;font-size:12px;font-weight:600;border-radius:4px;cursor:pointer;'
			}, [
				E('span', { 'style': 'margin-right:4px;' }, isBlocked ? '✓' : '🛑'),
				_('Lockdown')
			]);
			if (!isBlocked) {
				btnBlock.addEventListener('click', function() { runAction('block', btnBlock); });
			}

			// Button: +30 Min Bonus
			const btnBonus30 = E('button', {
				'type': 'button',
				'class': 'cbi-button',
				'style': 'padding:7px 14px;font-size:12px;font-weight:600;border-radius:4px;cursor:pointer;'
			}, [
				E('span', { 'style': 'margin-right:4px;' }, '⏳'),
				_('+30 Min')
			]);
			btnBonus30.addEventListener('click', function() { runBonus(30, btnBonus30); });

			return E('div', {
				'class': 'cbi-section',
				'style': 'margin-bottom:15px;padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;'
			}, [
				E('div', { 'style': 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;' }, [
					statusPill,
					tzPill
				]),
				E('div', { 'style': 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' }, [
					btnSchedule,
					btnUnlock,
					btnBlock,
					btnBonus30
				])
			]);
		};

		// 2. Schedules Section
		s = m.section(form.TableSection, 'schedule', _('Schedules'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;

		// Active Switch (first column)
		o = s.option(StatusFlag, 'enabled', _('Active'));
		o.default = '1';
		o.rmempty = false;

		// Compact Day Picker (M T W T F S S)
		o = s.option(CompactDayPicker, 'weekdays', _('Days'));
		o.default = 'all';

		// Start Time (12-Hour Dropdowns)
		o = s.option(TimePicker12h, 'start_time', _('Start Time'));
		o.default = '18:00:00';

		// Duration Dropdown
		o = s.option(form.ListValue, 'duration', _('Duration'));
		const durations = [
			15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360
		];
		for (let i = 0; i < durations.length; i++) {
			o.value(String(durations[i]), formatDurationLabel(durations[i]));
		}
		o.default = '90';

		// Calculated End Time Preview
		o = s.option(form.DummyValue, '_cutoff', _('End Time'));
		o.rawhtml = true;
		o.cfgvalue = function(section_id) {
			const start = uci.get('internet_schedule', section_id, 'start_time') || '18:00:00';
			const dur = uci.get('internet_schedule', section_id, 'duration') || '90';
			const cutoffStr = calcCutoffLabel(start, dur);
			return '<span style="font-weight:600;display:inline-block;padding:2px 0;">' + cutoffStr + '</span>';
		};

		// 4. Devices Section
		s = m.section(form.TableSection, 'device', _('Devices'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;

		o = s.option(StatusFlag, 'enabled', _('Active'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'name', _('Device Friendly Name'));
		o.placeholder = 'e.g. Roku Streambar Living Room';
		o.rmempty = false;

		// MAC Address picker populated with discovered devices (standardized width)
		o = s.option(form.Value, 'mac', _('MAC Address'));
		o.placeholder = 'XX:XX:XX:XX:XX:XX';
		o.datatype = 'macaddr';
		o.rmempty = false;

		const originalRenderWidget = o.renderWidget;
		o.renderWidget = function(section_id, option_index, cfgvalue) {
			const node = originalRenderWidget.apply(this, [section_id, option_index, cfgvalue]);
			if (node) {
				node.style.width = '100%';
				node.style.maxWidth = '360px';
				const inputOrSelect = node.querySelector('input, select');
				if (inputOrSelect) {
					inputOrSelect.style.width = '100%';
					inputOrSelect.style.maxWidth = '360px';
				}
			}
			return node;
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
