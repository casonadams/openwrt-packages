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
	const nextDay = (startTot + dur) >= 1440;

	const stopH = Math.floor(stopTot / 60);
	const stopM = stopTot % 60;
	const ampm = (stopH >= 12) ? 'PM' : 'AM';
	let h12 = stopH % 12;
	if (h12 === 0) h12 = 12;
	const mStr = (stopM < 10 ? '0' : '') + stopM;

	return h12 + ':' + mStr + ' ' + ampm + (nextDay ? ' (+1d)' : '');
}

// 12-Hour Dropdown Time Picker
const TimePicker12h = form.Value.extend({
	renderWidget: function(section_id, option_index, cfgvalue) {
		const parsed = parse24to12(cfgvalue);

		const hourSelect = E('select', {
			'class': 'cbi-input-select',
			'style': 'width:auto;display:inline-block;margin-right:2px;font-weight:600;padding:2px 4px;'
		});
		for (let h = 1; h <= 12; h++) {
			hourSelect.appendChild(E('option', {
				'value': h,
				'selected': (h === parsed.h) ? '' : null
			}, String(h)));
		}

		const minSelect = E('select', {
			'class': 'cbi-input-select',
			'style': 'width:auto;display:inline-block;margin-right:2px;font-family:monospace;padding:2px 4px;'
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
			'style': 'width:auto;display:inline-block;font-weight:700;padding:2px 4px;'
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

// Interactive Pill Button (Enabled/Disabled)
const StatusFlag = form.Value.extend({
	renderWidget: function(section_id, option_index, cfgvalue) {
		let isEnabled = (cfgvalue !== '0' && cfgvalue !== false && cfgvalue !== '');

		const hiddenInput = E('input', {
			'type': 'hidden',
			'id': this.cbid(section_id),
			'name': this.cbid(section_id),
			'value': isEnabled ? '1' : '0'
		});

		const btn = E('button', {
			'type': 'button',
			'class': 'cbi-button',
			'style': isEnabled
				? 'padding:3px 8px;font-size:11px;font-weight:700;border-radius:4px;background:#28a745;color:#fff;border:1px solid transparent;cursor:pointer;min-width:62px;text-align:center;'
				: 'padding:3px 8px;font-size:11px;font-weight:600;border-radius:4px;background:transparent;color:inherit;opacity:0.5;border:1px solid rgba(127,127,127,0.4);cursor:pointer;min-width:62px;text-align:center;'
		}, isEnabled ? _('Enabled') : _('Disabled'));

		btn.addEventListener('click', function(ev) {
			ev.preventDefault();
			isEnabled = !isEnabled;
			hiddenInput.value = isEnabled ? '1' : '0';

			if (isEnabled) {
				btn.style.background = '#28a745';
				btn.style.color = '#fff';
				btn.style.opacity = '1';
				btn.style.borderColor = 'transparent';
				btn.style.fontWeight = '700';
				btn.textContent = _('Enabled');
			} else {
				btn.style.background = 'transparent';
				btn.style.color = 'inherit';
				btn.style.opacity = '0.5';
				btn.style.borderColor = 'rgba(127,127,127,0.4)';
				btn.style.fontWeight = '600';
				btn.textContent = _('Disabled');
			}

			dom.dispatch(hiddenInput, 'widget-change');
		});

		return E('div', {
			'style': 'display:inline-flex;align-items:center;'
		}, [btn, hiddenInput]);
	}
});

// Compact Day Picker Component (M T W T F S S)
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
			'style': 'display:inline-flex;gap:2px;align-items:center;'
		});

		days.forEach(function(d) {
			let active = (selectedDays.indexOf(d.id) !== -1);
			const btn = E('button', {
				'type': 'button',
				'title': d.title,
				'class': 'cbi-button',
				'style': active
					? 'min-width:20px;height:22px;padding:0 2px;font-size:11px;font-weight:700;line-height:20px;border-radius:3px;background:#007bff;color:#fff;border:1px solid transparent;cursor:pointer;'
					: 'min-width:20px;height:22px;padding:0 2px;font-size:11px;font-weight:600;line-height:20px;border-radius:3px;background:transparent;opacity:0.45;border:1px solid rgba(127,127,127,0.4);cursor:pointer;'
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
			callSystemInfo(),
			callExec('/usr/bin/internet-schedule', ['get-bonus'])
		]);
	},

	render: function(data) {
		const hostHints = data[2] || {};
		const sysInfo = data[3] || {};
		const bonusRaw = (data[4] && data[4].stdout) ? data[4].stdout.trim() : 'inactive|0|';

		const bonusParts = bonusRaw.split('|');
		const isBonusActive = (bonusParts[0] === 'active');
		const bonusRemMins = parseInt(bonusParts[1], 10) || 0;
		const bonusEndTime = bonusParts[2] || '';

		const routerTzName = uci.get('system', '@system[0]', 'zonename') || 'UTC';
		const routerTimestamp = (sysInfo.localtime || Math.floor(Date.now() / 1000)) * 1000;
		const routerDate = new Date(routerTimestamp);
		const routerTimeStr = routerDate.toLocaleTimeString('en-US', {
			timeZone: 'UTC',
			hour: 'numeric',
			minute: '2-digit'
		});

		let m, s, o;

		m = new form.Map('internet_schedule', _('Internet Schedule'),
			_('Curfew and screen time access control for kids, smart TVs, and streaming devices.'));

		// 1. Mobile-First Pill Bar: Status + Clock + Touch-Friendly Bonus Pills
		s = m.section(form.NamedSection, 'settings', 'settings');
		s.render = function() {
			const runBonusAdd = function(mins, el) {
				el.disabled = true;
				ui.showIndicator('bonus-op', _('Adding bonus time...'));
				callExec('/usr/bin/internet-schedule', ['bonus-add', String(mins)])
					.then(function() {
						ui.hideIndicator('bonus-op');
						window.location.reload();
					})
					.catch(function(err) {
						ui.hideIndicator('bonus-op');
						el.disabled = false;
						ui.addNotification(null, E('p', {}, err.message || err));
					});
			};

			const runBonusClear = function(el) {
				el.disabled = true;
				ui.showIndicator('bonus-op', _('Ending bonus time...'));
				callExec('/usr/bin/internet-schedule', ['bonus-clear'])
					.then(function() {
						ui.hideIndicator('bonus-op');
						window.location.reload();
					})
					.catch(function(err) {
						ui.hideIndicator('bonus-op');
						el.disabled = false;
						ui.addNotification(null, E('p', {}, err.message || err));
					});
			};

			// Status badge
			let statusBadge;
			if (isBonusActive) {
				statusBadge = E('div', {
					'style': 'display:inline-flex;align-items:center;background:rgba(40,167,69,0.15);color:#28a745;padding:4px 10px;border-radius:15px;font-size:12px;font-weight:700;'
				}, [
					E('span', { 'style': 'display:inline-block;width:7px;height:7px;border-radius:50%;background:#28a745;margin-right:6px;' }),
					_('Bonus Active (%sm left · Ends %s)').format(bonusRemMins, bonusEndTime)
				]);
			} else {
				statusBadge = E('div', {
					'style': 'display:inline-flex;align-items:center;background:rgba(0,123,255,0.12);color:#007bff;padding:4px 10px;border-radius:15px;font-size:12px;font-weight:700;'
				}, [
					E('span', { 'style': 'display:inline-block;width:7px;height:7px;border-radius:50%;background:#007bff;margin-right:6px;' }),
					_('Schedule Active')
				]);
			}

			// Clean Router Wall-Clock
			const clockBadge = E('div', {
				'style': 'font-size:12px;opacity:0.75;font-weight:500;'
			}, routerTimeStr + ' (' + routerTzName + ')');

			// Quick Bonus Action Pills (Touch-Friendly)
			const bonusControls = E('div', {
				'style': 'display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;'
			});

			const makePillBtn = function(label, mins, isDanger) {
				const btn = E('button', {
					'type': 'button',
					'class': 'cbi-button',
					'style': isDanger
						? 'padding:3px 10px;font-size:11px;font-weight:700;border-radius:12px;background:#dc3545;color:#fff;border:1px solid transparent;cursor:pointer;'
						: 'padding:3px 10px;font-size:11px;font-weight:600;border-radius:12px;background:rgba(127,127,127,0.12);color:inherit;border:1px solid rgba(127,127,127,0.3);cursor:pointer;'
				}, label);

				if (isDanger) {
					btn.addEventListener('click', function() { runBonusClear(btn); });
				} else {
					btn.addEventListener('click', function() { runBonusAdd(mins, btn); });
				}
				return btn;
			};

			if (isBonusActive) {
				bonusControls.appendChild(makePillBtn(_('End Bonus'), 0, true));
			}

			bonusControls.appendChild(makePillBtn('+15m', 15, false));
			bonusControls.appendChild(makePillBtn('+30m', 30, false));
			bonusControls.appendChild(makePillBtn('+1h', 60, false));

			return E('div', {
				'class': 'cbi-section',
				'style': 'margin-bottom:12px;padding:8px 12px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;'
			}, [
				bonusControls,
				E('div', { 'style': 'display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;' }, [
					statusBadge,
					clockBadge
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

		// 3. Devices Section
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
