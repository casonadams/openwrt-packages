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

		const routerDate = new Date((sysInfo.localtime || Math.floor(Date.now() / 1000)) * 1000);
		const routerDateStr = routerDate.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
		const browserDateStr = new Date().toLocaleString('en-US', { hour12: false });

		let m, s, o;

		m = new form.Map('internet_schedule', _('Internet Access Schedule'),
			_('Automated daily internet curfew and access control for kids, smart TVs, and streaming devices.'));

		// Custom Header: Live Clock & Timezone Comparison Box
		s = m.section(form.NamedSection, 'settings', 'settings', _('Status & Timezone Alignment'));
		s.render = function() {
			const tzBannerClass = tzMatch ? 'alert-message success' : 'alert-message warning';
			const tzIcon = tzMatch ? '✓' : '⚠';
			const tzText = tzMatch
				? _('Router and browser timezones are aligned (%s). Scheduled times will trigger at your local time.').format(routerTzName)
				: _('Timezone difference detected! The router is configured for <b>%s</b>, while your browser is in <b>%s</b>. Scheduled hours are evaluated against the Router clock.').format(routerTzName, browserTz);

			const currentMode = uci.get('internet_schedule', 'settings', 'mode') || 'schedule';
			const isEnabled = uci.get('internet_schedule', 'settings', 'enabled') !== '0';

			let modeBadge = '';
			if (!isEnabled || currentMode === 'unlocked' || currentMode === 'disabled') {
				modeBadge = '<span class="badge" style="background:#28a745;color:#fff;padding:4px 8px;border-radius:4px;font-weight:bold;">UNLOCKED (Unrestricted Internet)</span>';
			} else if (currentMode === 'block') {
				modeBadge = '<span class="badge" style="background:#dc3545;color:#fff;padding:4px 8px;border-radius:4px;font-weight:bold;">LOCKED DOWN (Emergency Block)</span>';
			} else {
				modeBadge = '<span class="badge" style="background:#007bff;color:#fff;padding:4px 8px;border-radius:4px;font-weight:bold;">SCHEDULE ACTIVE (Enforcing Hours)</span>';
			}

			return E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': tzBannerClass, 'style': 'margin-bottom:15px;' }, [
					E('p', {}, [
						E('strong', {}, tzIcon + ' Timezone Status: '),
						E('span', {}, tzText)
					])
				]),
				E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:15px;margin-bottom:20px;' }, [
					E('div', { 'style': 'flex:1;min-width:240px;background:#f8f9fa;padding:12px;border:1px solid #ddd;border-radius:4px;' }, [
						E('div', { 'style': 'font-size:11px;text-transform:uppercase;color:#666;font-weight:bold;' }, _('Router Clock')),
						E('div', { 'style': 'font-size:15px;font-weight:bold;margin-top:4px;' }, routerDateStr),
						E('div', { 'style': 'font-size:12px;color:#555;' }, routerTzName + ' (' + routerTz + ')')
					]),
					E('div', { 'style': 'flex:1;min-width:240px;background:#f8f9fa;padding:12px;border:1px solid #ddd;border-radius:4px;' }, [
						E('div', { 'style': 'font-size:11px;text-transform:uppercase;color:#666;font-weight:bold;' }, _('Your Browser Clock')),
						E('div', { 'style': 'font-size:15px;font-weight:bold;margin-top:4px;' }, browserDateStr),
						E('div', { 'style': 'font-size:12px;color:#555;' }, browserTz)
					]),
					E('div', { 'style': 'flex:1;min-width:240px;background:#f8f9fa;padding:12px;border:1px solid #ddd;border-radius:4px;' }, [
						E('div', { 'style': 'font-size:11px;text-transform:uppercase;color:#666;font-weight:bold;' }, _('Current Enforcement')),
						E('div', { 'style': 'margin-top:6px;' }, modeBadge)
					])
				])
			]);
		};

		// Schedule Controls Section
		s = m.section(form.NamedSection, 'settings', 'settings', _('Schedule Configuration'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable Schedule'),
			_('When disabled, all rules are turned off and devices have unrestricted internet access.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.ListValue, 'mode', _('Operating Mode'),
			_('Quick override without deleting your schedule.'));
		o.value('schedule', _('Enforce Daily Schedule'));
		o.value('unlocked', _('Unlock All (Unrestricted Access)'));
		o.value('block', _('Emergency Lockdown (Block All Right Now)'));
		o.default = 'schedule';

		o = s.option(form.Value, 'start_time', _('Daily Allowed Start Time'),
			_('Time of day when internet access is opened (e.g. 18:00 or 18:00:00).'));
		o.placeholder = '18:00:00';
		o.datatype = 'time';
		o.default = '18:00:00';

		o = s.option(form.Value, 'stop_time', _('Daily Allowed Cutoff Time'),
			_('Time of day when internet access is closed and active video streams are terminated (e.g. 19:30 or 19:30:00).'));
		o.placeholder = '19:30:00';
		o.datatype = 'time';
		o.default = '19:30:00';

		o = s.option(form.MultiValue, 'weekdays', _('Active Days of Week'),
			_('Days of the week this schedule is enforced.'));
		o.value('all', _('All Days (Mon-Sun)'));
		o.value('Mon', _('Monday'));
		o.value('Tue', _('Tuesday'));
		o.value('Wed', _('Wednesday'));
		o.value('Thu', _('Thursday'));
		o.value('Fri', _('Friday'));
		o.value('Sat', _('Saturday'));
		o.value('Sun', _('Sunday'));
		o.default = 'all';

		// Managed Devices Section (Table with Device Auto-Discovery)
		s = m.section(form.TableSection, 'device', _('Target Devices to Restrict'),
			_('Add the devices you want subject to the schedule (Rokus, Samsung TVs, tablets, gaming consoles). All unlisted household devices remain unrestricted.'));
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
