'use strict';
'require view';
'require dom';
'require ui';
'require uci';
'require rpc';
'require poll';
'require form';
'require screentime.format as fmt';

const ENGINE = '/usr/bin/screentime';
const POLL_SECONDS = 30;
const NO_MAC = 'XX:XX:XX:XX:XX:XX';

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

function fetchState() {
	return callExec(ENGINE, ['status', '--json']).then(function(res) {
		try {
			return JSON.parse(res.stdout);
		} catch (e) {
			return null;
		}
	});
}

// Custom widgets are plain DOM: read them from the node, or fall back to the stored value
// when the node is not rendered (e.g. rows that were never opened).
function widgetValue(option, section_id, read) {
	const node = option.map.findElement('id', option.cbid(section_id));
	if (node) return read(node);
	const cfg = option.cfgvalue(section_id);
	return (cfg != null && cfg !== '') ? cfg : option.default;
}

const TimePicker12h = form.Value.extend({
	default: '18:00:00',

	formvalue: function(section_id) {
		return widgetValue(this, section_id, function(node) {
			return fmt.parse12to24(
				node.querySelector('.tp-hour').value,
				node.querySelector('.tp-minute').value,
				node.querySelector('.tp-ampm').value);
		});
	},

	renderWidget: function(section_id, _option_index, cfgvalue) {
		const parsed = fmt.parse24to12(cfgvalue || this.default);
		const select = function(cls, width, options, current) {
			return E('select', {
				'class': 'cbi-input-select ' + cls,
				'style': 'width:' + width + 'px;flex:0 0 ' + width + 'px;height:32px;'
			}, options.map(function(o) {
				return E('option', { 'value': o.value, 'selected': o.value === current ? '' : null }, o.label);
			}));
		};

		const hours = [];
		for (let h = 1; h <= 12; h++) hours.push({ value: String(h), label: (h < 10 ? '0' : '') + h });
		const minutes = [];
		for (let m = 0; m < 60; m += 5) minutes.push({ value: String(m), label: (m < 10 ? '0' : '') + m });
		if (parsed.m % 5 !== 0) minutes.push({ value: String(parsed.m), label: (parsed.m < 10 ? '0' : '') + parsed.m });
		minutes.sort(function(a, b) { return a.value - b.value; });

		return E('div', {
			'id': this.cbid(section_id),
			'style': 'display:inline-flex;align-items:center;gap:6px;'
		}, [
			select('tp-hour', 68, hours, String(parsed.h)),
			E('span', { 'style': 'font-weight:700;' }, ':'),
			select('tp-minute', 68, minutes, String(parsed.m)),
			select('tp-ampm', 76, [
				{ value: 'AM', label: 'AM' },
				{ value: 'PM', label: 'PM' }
			], parsed.ampm)
		]);
	}
});

const CompactDayPicker = form.Value.extend({
	default: 'all',

	formvalue: function(section_id) {
		return widgetValue(this, section_id, function(node) {
			return node.querySelector('input[type="hidden"]').value;
		});
	},

	// Custom widgets have no ui element, so validate on parse.
	parse: function(section_id) {
		if (this.formvalue(section_id) === '')
			return Promise.reject(new TypeError(_('Select at least one day of the week.')));
		return form.Value.prototype.parse.apply(this, arguments);
	},

	renderWidget: function(section_id, _option_index, cfgvalue) {
		const labels = { mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S' };
		const titles = {
			mon: _('Monday'), tue: _('Tuesday'), wed: _('Wednesday'), thu: _('Thursday'),
			fri: _('Friday'), sat: _('Saturday'), sun: _('Sunday')
		};
		let selected = fmt.normalizeDays(cfgvalue || this.default);
		const hidden = E('input', { 'type': 'hidden', 'name': this.cbid(section_id) });
		const container = E('div', {
			'id': this.cbid(section_id),
			'style': 'display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;'
		}, [ hidden ]);

		const sync = function() {
			hidden.value = selected.length === 7 ? 'all' : selected.join(' ');
		};
		sync();

		fmt.DAY_KEYS.forEach(function(key) {
			const btn = E('button', {
				'type': 'button',
				'title': titles[key],
				'style': 'min-width:32px;height:30px;padding:0 4px;font-size:12px;font-weight:700;'
			}, labels[key]);
			const paint = function() {
				btn.className = selected.indexOf(key) >= 0 ? 'btn cbi-button cbi-button-action important' : 'btn cbi-button';
			};
			paint();
			btn.addEventListener('click', function(ev) {
				ev.preventDefault();
				ev.stopPropagation();
				selected = selected.indexOf(key) >= 0
					? selected.filter(function(d) { return d !== key; })
					: fmt.DAY_KEYS.filter(function(d) { return d === key || selected.indexOf(d) >= 0; });
				paint();
				sync();
			});
			container.appendChild(btn);
		});

		return container;
	}
});

const DeviceTargets = form.MultiValue.extend({
	parse: function(section_id) {
		const chosen = [].concat(this.formvalue(section_id) || []);
		if (chosen.indexOf('all') >= 0 && chosen.length > 1)
			return Promise.reject(new TypeError(_('Choose either "All Managed Devices" or specific devices, not both.')));
		return form.MultiValue.prototype.parse.apply(this, arguments);
	}
});

function badge(text, kind) {
	const colors = {
		allowed: 'var(--success-color-high)',
		blocked: 'var(--error-color-high)',
		override: 'var(--warning-color-high)',
		off: 'var(--border-color-medium)'
	};
	return E('span', {
		'class': 'ifacebadge',
		'style': 'display:inline-flex;align-items:center;padding:4px 10px;font-size:12px;font-weight:600;'
	}, [
		E('span', {
			'style': 'display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:' + colors[kind]
		}),
		text
	]);
}

return view.extend({
	// Stock handleSave stages the changes; only flag blank-row pruning for this save.
	handleSave: function(ev) {
		this.pruneBlank = true;
		return view.prototype.handleSave.call(this, ev).finally(function() { this.pruneBlank = false; }.bind(this));
	},

	load: function() {
		return Promise.all([
			uci.load('screentime'),
			uci.load('system'),
			callHostHints(),
			callSystemInfo(),
			fetchState()
		]);
	},

	render: function(data) {
		const self = this;
		const hostHints = data[2] || {};
		const localtime = (data[3] || {}).localtime;
		const tzName = uci.get('system', '@system[0]', 'zonename') || 'UTC';
		let state = data[4];
		let localOffset = (localtime && state) ? localtime - state.now : 0;

		const header = E('div', {
			'class': 'cbi-section',
			'style': 'margin-bottom:16px;padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;'
		});

		const runAction = function(cmd, btn) {
			btn.disabled = true;
			return callExec(ENGINE, [cmd]).then(refresh).catch(function(err) {
				ui.addNotification(null, E('p', _('Operation failed: %s').format(err.message || err)));
				btn.disabled = false;
			});
		};

		const actionButton = function() {
			if (state.override.mode !== 'none')
				return [ _('Resume Schedule'), 'clear-override', 'cbi-button-action' ];
			if (state.in_window)
				return [ _('Turn On Downtime Now'), 'turn-on-downtime', 'cbi-button-negative' ];
			return [ _('Ignore Downtime Until Next Window'), 'ignore-downtime', 'cbi-button-negative' ];
		};

		const paintHeader = function() {
			if (!state) {
				dom.content(header, E('em', _('Could not read the Screen Time status from the router.')));
				return;
			}
			const desc = fmt.describeState(state, localOffset);
			const act = actionButton();
			const btn = E('button', { 'type': 'button', 'class': 'btn cbi-button important ' + act[2] }, act[0]);
			btn.addEventListener('click', function() { runAction(act[1], btn); });
			const clock = new Date((state.now + localOffset) * 1000).toLocaleTimeString('en-US', {
				timeZone: 'UTC', hour: 'numeric', minute: '2-digit'
			});
			dom.content(header, [
				btn,
				E('div', { 'style': 'display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;' }, [
					badge(desc.text, desc.kind),
					E('span', { 'class': 'ifacebadge', 'style': 'padding:4px 10px;font-size:12px;opacity:0.85;' },
						clock + ' (' + tzName + ')')
				])
			]);
		};

		const paintDevice = function(el) {
			const mac = el.getAttribute('data-screentime-mac');
			const dev = state && state.devices.find(function(d) { return d.mac === mac; });
			const desc = fmt.describeDevice(dev, state, localOffset);
			el.style.color = desc.allowed == null ? '' : (desc.allowed ? 'var(--success-color-high)' : 'var(--error-color-high)');
			el.textContent = desc.text;
		};

		const paintDevices = function() {
			document.querySelectorAll('[data-screentime-mac]').forEach(paintDevice);
		};

		const refresh = function() {
			return fetchState().then(function(next) {
				state = next;
				paintHeader();
				paintDevices();
			});
		};

		let m, s, o;

		m = new form.Map('screentime', _('Screen Time'),
			_('Devices listed under Managed Devices have network access only during the scheduled windows below.'));

		// 1. State banner and override button
		s = m.section(form.NamedSection, 'settings', 'settings');
		s.render = function() {
			paintHeader();
			poll.add(refresh, POLL_SECONDS);
			return header;
		};

		// 2. Allowed schedules (GridSection with modal editing)
		s = m.section(form.GridSection, 'schedule', _('Allowed Schedules'),
			_('Outside these windows managed devices are blocked. Save & Apply to enforce changes.'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;
		s.modaltitle = _('Screen Time Schedule');

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = o.enabled;
		o.editable = true;

		o = s.option(form.DummyValue, '_summary', _('Schedule Window'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			const get = function(k, d) { return uci.get('screentime', section_id, k) || d; };
			const name = get('name', '');
			const children = [];
			if (name) children.push(E('strong', { 'style': 'display:block;margin-bottom:2px;' }, name));
			children.push(E('span', { 'style': 'font-weight:600;' },
				fmt.formatWindow(get('start_time', '18:00:00'), get('duration', '90'))));
			children.push(' ');
			children.push(E('span', { 'style': 'opacity:0.75;font-size:12px;' },
				'(' + fmt.formatDays(get('weekdays', 'all')) + ')'));
			return E('div', { 'style': 'line-height:1.4;' }, children);
		};

		o = s.option(form.DummyValue, '_devices_summary', _('Applies To'));
		o.modalonly = false;
		o.textvalue = function(section_id) {
			const targets = [].concat(uci.get('screentime', section_id, 'devices') || 'all');
			const all = targets.indexOf('all') >= 0;
			const count = targets.length;
			return E('span', {
				'class': 'ifacebadge' + (all ? '' : ' ifacebadge-active'),
				'style': 'display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;'
			}, all ? _('All Devices') : (count === 1 ? _('1 Device') : _('%d Devices').format(count)));
		};

		o = s.option(form.Value, 'name', _('Schedule Name'));
		o.modalonly = true;
		o.placeholder = _('e.g. Evening Homework, Bedtime (Optional)');
		o.rmempty = true;

		o = s.option(CompactDayPicker, 'weekdays', _('Days of Week'));
		o.modalonly = true;

		o = s.option(TimePicker12h, 'start_time', _('Start Time'));
		o.modalonly = true;

		o = s.option(form.ListValue, 'duration', _('Duration'));
		o.modalonly = true;
		[15, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 480, 600, 720].forEach(function(mins) {
			o.value(String(mins), fmt.formatDuration(mins));
		});
		o.default = '90';

		o = s.option(DeviceTargets, 'devices', _('Applies To (Target Devices)'));
		o.modalonly = true;
		o.default = 'all';
		o.rmempty = true;
		o.description = _('Devices added below show up here after you click Save.');
		o.value('all', _('All Managed Devices (Default)'));
		(uci.sections('screentime', 'device') || []).forEach(function(dev) {
			const mac = (dev.mac || '').toLowerCase();
			if (mac) o.value(mac, dev.name ? '%s (%s)'.format(dev.name, mac) : mac);
		});

		// 3. Managed devices
		s = m.section(form.TableSection, 'device', _('Managed Devices'),
			_('Only these devices are restricted; everything else on the network is untouched.'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;

		// Rows added with "Add" but left without a MAC are dropped on a user-initiated Save.
		s.parse = function() {
			const macOpt = this.children.find(function(c) { return c.option === 'mac'; });
			const tasks = [];
			this.cfgsections().forEach(function(sid) {
				const mac = macOpt.formvalue(sid);
				if (!mac || mac === NO_MAC) {
					if (self.pruneBlank) this.map.data.remove('screentime', sid);
					return;
				}
				this.children.forEach(function(c) { tasks.push(c.parse(sid)); });
			}, this);
			return Promise.all(tasks);
		};

		o = s.option(form.Flag, 'enabled', _('Enable'));
		o.default = o.enabled;
		o.editable = true;

		o = s.option(form.Value, 'name', _('Device Name'));
		o.placeholder = _('Optional (auto-detects hostname)');
		o.rmempty = true;
		o.write = function(section_id, formvalue) {
			let nameVal = formvalue;
			if (!nameVal) {
				const macOpt = this.section.children.find(function(c) { return c.option === 'mac'; });
				const mac = (macOpt.formvalue(section_id) || '').toLowerCase();
				nameVal = (hostHints[mac] || {}).name || '';
			}
			return nameVal ? uci.set('screentime', section_id, 'name', nameVal)
				: uci.unset('screentime', section_id, 'name');
		};

		o = s.option(form.Value, 'mac', _('MAC Address'));
		o.placeholder = NO_MAC;
		o.rmempty = true;
		o.validate = function(_section_id, value) {
			if (!value || value === NO_MAC) return true;
			if (!/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(value))
				return _('Expecting valid MAC address (e.g. 00:11:22:33:44:55)');
			return true;
		};
		o.write = function(section_id, formvalue) {
			return uci.set('screentime', section_id, 'mac', formvalue.toLowerCase());
		};
		o.onchange = function(_ev, section_id, value) {
			if (!value) return;
			const nameInput = document.querySelector('[name="cbid.screentime.' + section_id + '.name"]');
			if (nameInput && !nameInput.value) {
				const hint = hostHints[value.toLowerCase()] || hostHints[value.toUpperCase()] || {};
				if (hint.name) {
					nameInput.value = hint.name;
					nameInput.dispatchEvent(new Event('change', { bubbles: true }));
				}
			}
		};
		Object.keys(hostHints).sort().forEach(function(key) {
			const info = hostHints[key] || {};
			const ip = (info.ipaddrs && info.ipaddrs.length > 0) ? info.ipaddrs[0] : '';
			const mac = key.toLowerCase();
			let label = mac;
			if (info.name && ip) label = '%s — %s (%s)'.format(info.name, ip, mac);
			else if (info.name) label = '%s (%s)'.format(info.name, mac);
			else if (ip) label = '%s (%s)'.format(ip, mac);
			o.value(mac, label);
		});

		// TableSection renders cells through renderWidget (textvalue is only used by GridSection).
		o = s.option(form.DummyValue, '_status', _('Status'));
		o.renderWidget = function(section_id) {
			const mac = (uci.get('screentime', section_id, 'mac') || '').toLowerCase();
			const el = E('span', { 'data-screentime-mac': mac, 'style': 'font-weight:600;' });
			paintDevice(el);
			return el;
		};

		return m.render();
	}
});
