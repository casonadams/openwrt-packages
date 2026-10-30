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

// 12-Hour Dropdown Time Picker Component
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

		m = new form.Map('internet_schedule', _('Internet Access Schedule'),
			_('Automated daily internet curfew and access control for kids, smart TVs, and streaming devices.'));

		// 1. Hero Summary Header (Theme-adaptive with boundary protection)
		s = m.section(form.NamedSection, 'settings', 'settings', _('System & Timezone Alignment'));
		s.render = function() {
			const tzBannerClass = tzMatch ? 'alert-message notice success' : 'alert-message warning';
			const tzIcon = tzMatch ? '✓' : '⚠';
			const tzText = tzMatch
				? _('Router and browser timezones are aligned (%s). Scheduled times match your local wall-clock time.').format(routerTzName)
				: _('Timezone discrepancy detected! The router is operating on <b>%s</b>, but your browser is in <b>%s</b>. Scheduled hours are evaluated against the Router clock.').format(routerTzName, browserTz);

			const currentMode = uci.get('internet_schedule', 'settings', 'mode') || 'schedule';
			const isEnabled = uci.get('internet_schedule', 'settings', 'enabled') !== '0';

			let modeBadge;
			if (!isEnabled || currentMode === 'unlocked' || currentMode === 'disabled') {
				modeBadge = E('span', {
					'class': 'badge',
					'style': 'background-color:#28a745;color:#ffffff;padding:4px 8px;font-size:12px;font-weight:700;border-radius:4px;display:inline-block;white-space:normal;line-height:1.4;'
				}, _('UNLOCKED — Full Access'));
			} else if (currentMode === 'block') {
				modeBadge = E('span', {
					'class': 'badge',
					'style': 'background-color:#dc3545;color:#ffffff;padding:4px 8px;font-size:12px;font-weight:700;border-radius:4px;display:inline-block;white-space:normal;line-height:1.4;'
				}, _('LOCKED DOWN — Emergency Block'));
			} else {
				modeBadge = E('span', {
					'class': 'badge',
					'style': 'background-color:#007bff;color:#ffffff;padding:4px 8px;font-size:12px;font-weight:700;border-radius:4px;display:inline-block;white-space:normal;line-height:1.4;'
				}, _('SCHEDULE ACTIVE — Enforcing Curfew'));
			}

			return E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': tzBannerClass, 'style': 'margin-bottom:15px;' }, [
					E('p', {}, [
						E('strong', {}, tzIcon + ' ' + _('Timezone Verification') + ': '),
						E('span', {}, tzText)
					])
				]),
				E('div', {
					'class': 'cbi-section-node',
					'style': 'display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:15px;margin-bottom:15px;'
				}, [
					// Card 1: Router Clock
					E('div', { 'class': 'ifacebox', 'style': 'margin:0;display:flex;flex-direction:column;justify-content:space-between;' }, [
						E('div', { 'class': 'ifacebox-head', 'style': 'font-weight:bold;' }, _('Router System Clock')),
						E('div', { 'class': 'ifacebox-body', 'style': 'padding:12px;' }, [
							E('div', { 'style': 'font-size:15px;font-weight:bold;margin-bottom:4px;' }, routerDateStr),
							E('div', { 'style': 'opacity:0.8;font-size:12px;' }, routerTzName + ' (' + routerTz + ')')
						])
					]),
					// Card 2: Browser Clock
					E('div', { 'class': 'ifacebox', 'style': 'margin:0;display:flex;flex-direction:column;justify-content:space-between;' }, [
						E('div', { 'class': 'ifacebox-head', 'style': 'font-weight:bold;' }, _('Your Browser Clock')),
						E('div', { 'class': 'ifacebox-body', 'style': 'padding:12px;' }, [
							E('div', { 'style': 'font-size:15px;font-weight:bold;margin-bottom:4px;' }, browserDateStr),
							E('div', { 'style': 'opacity:0.8;font-size:12px;' }, browserTz)
						])
					]),
					// Card 3: Current Policy State
					E('div', { 'class': 'ifacebox', 'style': 'margin:0;display:flex;flex-direction:column;justify-content:space-between;' }, [
						E('div', { 'class': 'ifacebox-head', 'style': 'font-weight:bold;' }, _('Enforcement Status')),
						E('div', { 'class': 'ifacebox-body', 'style': 'padding:12px;' }, [
							E('div', { 'style': 'margin-top:2px;' }, modeBadge),
							E('div', { 'style': 'opacity:0.8;font-size:11px;margin-top:6px;' }, _('firewall4 nftables rules'))
						])
					])
				])
			]);
		};

		// 2. Master Policy & Override Controls
		s = m.section(form.NamedSection, 'settings', 'settings', _('Master Override Controls'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Master Schedule Switch'),
			_('Turn off to pause all schedules and give devices unrestricted internet access.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.ListValue, 'mode', _('Instant Override Mode'),
			_('Override scheduled times without deleting your configured schedules.'));
		o.value('schedule', _('Enforce Configured Schedules (Normal)'));
		o.value('unlocked', _('Unlock All (Unrestricted Internet)'));
		o.value('block', _('Emergency Lockdown (Block All Right Now)'));
		o.default = 'schedule';

		// 3. Multi-Schedule Builder (Schedule A, Schedule B, Schedule C...)
		s = m.section(form.TableSection, 'schedule', _('Configured Schedules (Schedule A, B, C...)'),
			_('Easily configure separate schedules for weekdays, weekends, or specific days with custom start times and durations. The cutoff time is calculated automatically, and streaming streams terminate immediately at cutoff.'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;

		// Friendly Schedule Name (Schedule A, B...)
		o = s.option(form.Value, 'name', _('Schedule Name'));
		o.placeholder = 'e.g. Schedule A (Weekdays)';
		o.default = 'Schedule A';
		o.rmempty = false;

		// Active Days
		o = s.option(form.MultiValue, 'weekdays', _('Active Days'));
		o.value('all', _('Everyday'));
		o.value('Mon', _('Mon'));
		o.value('Tue', _('Tue'));
		o.value('Wed', _('Wed'));
		o.value('Thu', _('Thu'));
		o.value('Fri', _('Fri'));
		o.value('Sat', _('Sat'));
		o.value('Sun', _('Sun'));
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

		// Calculated Cutoff Preview
		o = s.option(form.DummyValue, '_cutoff', _('Calculated Cutoff'));
		o.rawhtml = true;
		o.cfgvalue = function(section_id) {
			const start = uci.get('internet_schedule', section_id, 'start_time') || '18:00:00';
			const dur = uci.get('internet_schedule', section_id, 'duration') || '90';
			const cutoffStr = calcCutoffLabel(start, dur);
			return '<span style="font-weight:bold;color:#007bff;display:inline-block;padding:2px 0;">→ Ends at ' + cutoffStr + '</span>';
		};

		// Enabled Switch per schedule
		o = s.option(form.Flag, 'enabled', _('Active'));
		o.default = '1';
		o.rmempty = false;

		// 4. Target Devices Section (Table with Device Auto-Discovery)
		s = m.section(form.TableSection, 'device', _('Target Devices to Restrict'),
			_('Select the devices subject to these schedules (Rokus, Samsung TVs, tablets, gaming consoles). All unlisted household devices remain unrestricted.'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;

		o = s.option(form.Value, 'name', _('Device Friendly Name'));
		o.placeholder = 'e.g. Roku Streambar Living Room';
		o.rmempty = false;

		// MAC Address picker populated with discovered devices
		o = s.option(form.Value, 'mac', _('MAC Address'));
		o.placeholder = 'XX:XX:XX:XX:XX:XX';
		o.datatype = 'macaddr';
		o.rmempty = false;

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
