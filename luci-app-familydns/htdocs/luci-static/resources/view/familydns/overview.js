'use strict';
'require view';
'require dom';
'require ui';
'require uci';
'require rpc';
'require poll';
'require form';
'require familydns.format as fmt';

const ENGINE = '/usr/bin/familydns';
const TICK_SECONDS = 5;
const DEFAULT_PORT = '853';
const DEFAULT_SEC = 'everyone';
const LAN_COLORS = { ready: 'var(--success-color-high)', warning: 'var(--warning-color-high)' };
const MUTED = 'font-size:12px;opacity:0.75;';
// Tables must fit a 390px phone: tighter cell padding, actions stacked.
const PHONE_CSS = '.familydns-actions{display:flex;gap:4px;justify-content:flex-end}.familydns-actions>*{flex:0 0 auto}' +
	'@media (max-width:480px){.familydns-actions{flex-wrap:wrap}.cbi-section-table .td,.cbi-section-table .th{padding-left:3px;padding-right:3px}}';

const callExec = rpc.declare({
	object: 'file',
	method: 'exec',
	params: [ 'command', 'params' ],
	expect: { '': {} }
});

function fetchStatus() {
	return callExec(ENGINE, [ 'status', '--json' ]).then(function(res) {
		try {
			return JSON.parse(res.stdout);
		} catch (e) {
			return null;
		}
	}).catch(function() { return null; });
}

function notifyError(err) {
	ui.addNotification(null, E('p', _('Operation failed: %s').format(err.message || err)));
}

function commandError(res) {
	return new Error(((res.stderr || res.stdout || '') + '').trim() || _('command failed'));
}

function downloadProfile(clientId) {
	return callExec(ENGINE, fmt.profileArgs(clientId)).then(function(res) {
		if (res.code !== 0)
			throw commandError(res);
		const url = URL.createObjectURL(new Blob([ res.stdout ], { type: 'application/x-apple-aspen-config' }));
		const link = E('a', { 'href': url, 'download': fmt.mobileconfigFilename(clientId) });
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
	});
}

function badge(text, kind) {
	const colors = {
		ready: 'var(--success-color-high)',
		running: 'var(--info-color-high, #0a84ff)',
		warning: 'var(--warning-color-high)',
		error: 'var(--error-color-high)',
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

// Appends help text (optionally with a link) under a widget. LuCI only renders string
// descriptions for plain options, so help that needs a link is attached to the widget itself.
function withHelp(option, nodes) {
	const base = option.renderWidget;
	option.renderWidget = function() {
		const widget = base.apply(this, arguments);
		return E('div', {}, [ widget, E('div', { 'class': 'cbi-value-description' }, nodes) ]);
	};
}

function providerHelp(text) {
	return [
		text + ' ',
		E('a', { 'href': fmt.PROVIDER_LIST_URL, 'target': '_blank', 'rel': 'noopener noreferrer' },
			_('Find provider addresses'))
	];
}

// A one-field prompt: name something, then continue.
function askName(title, help, placeholder, onSubmit) {
	const input = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': placeholder, 'style': 'width:100%;' });
	const submit = function() {
		const value = input.value.trim();
		if (!value)
			return input.focus();
		onSubmit(value);
	};
	input.addEventListener('keydown', function(ev) {
		if (ev.key === 'Enter') {
			ev.preventDefault();
			submit();
		}
	});
	ui.showModal(title, [
		E('p', {}, help),
		input,
		E('div', { 'class': 'right', 'style': 'margin-top:12px;' }, [
			E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Cancel')),
			' ',
			E('button', { 'class': 'btn cbi-button cbi-button-action important', 'click': submit }, _('Continue'))
		])
	]);
	input.focus();
}

function showInstallModal(view, clientId) {
	if (!clientId)
		return notifyError(new Error(_('Save the device before installing its profile.')));
	ui.showModal(_('Install profile'), [
		E('p', {}, _('Download %s and open it on the iPhone: AirDrop the file to it, or open this page in Safari there.')
			.format(fmt.mobileconfigFilename(clientId))),
		E('ol', {}, [
			E('li', {}, _('Tap the downloaded file, then go to Settings > General > VPN & Device Management and choose Install.')),
			E('li', {}, _('Go to Settings > General > VPN & Device Management > DNS and select this profile. Unmanaged iPhones must enable it; managed iPhones switch it on automatically.'))
		]),
		E('p', { 'class': 'cbi-section-descr' },
			_('To remove later: Settings > General > VPN & Device Management > the profile > Remove Profile.')),
		E('div', { 'class': 'right' }, [
			E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Close')),
			' ',
			E('button', {
				'class': 'btn cbi-button cbi-button-action important',
				'click': ui.createHandlerFn(view, function() { return downloadProfile(clientId).catch(notifyError); })
			}, _('Download profile'))
		])
	]);
}

return view.extend({
	// Stock handleSave stages the changes; only flag blank-row pruning for this save, because
	// the table's Add button also saves the map and must not discard the new blank row.
	handleSave: function(ev) {
		this.pruneBlank = true;
		return view.prototype.handleSave.call(this, ev).finally(function() { this.pruneBlank = false; }.bind(this));
	},

	load: function() {
		return Promise.all([
			uci.load('familydns'),
			fetchStatus()
		]);
	},

	render: function(data) {
		const self = this;
		let state = data[1];
		let lastFetch = Date.now();
		const port = function() { return uci.get('familydns', 'settings', 'dot_port') || DEFAULT_PORT; };
		const domain = function() { return uci.get('familydns', 'settings', 'domain') || ''; };
		const profiles = (uci.sections('familydns', 'profile') || []).map(function(p) {
			return { id: p['.name'], label: p.name || p['.name'] };
		});
		const profileIds = profiles.map(function(p) { return p.id; });
		const profileLabel = function(id) {
			const p = profiles.find(function(x) { return x.id === id; });
			return p ? p.label : (id || '–');
		};
		const deviceProfiles = (uci.sections('familydns', 'device') || []).map(function(d) { return d.profile; });
		const hasDevices = (uci.sections('familydns', 'device') || []).some(function(d) { return d['.name'] !== DEFAULT_SEC; });

		const header = E('div', {
			'class': 'cbi-section',
			'style': 'margin-bottom:16px;padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;'
		});
		const paintHeader = function() {
			const desc = fmt.describeState(state, port());
			const children = [ badge(desc.text, desc.kind) ];
			if (fmt.isRunning(state) && desc.stages.length) {
				children.push(E('ul', { 'style': 'flex-basis:100%;margin:0;font-size:12px;' }, desc.stages.map(function(s) {
					return E('li', {}, s.label + ': ' + s.state + (s.message ? ' – ' + s.message : ''));
				})));
			}
			dom.content(header, children);
		};

		// A device's row is found by its client id; the default row uses the id "default".
		const countFor = function(id, field) {
			if (id === 'default')
				return state && state.queries ? state.queries[field === 'blocked' ? 'default_blocked' : 'default'] : undefined;
			const dev = ((state && state.devices) || []).find(function(d) { return d.client_id === id; });
			return dev ? dev[field] : undefined;
		};

		const paintCount = function(el) {
			const field = el.hasAttribute('data-familydns-blocked') ? 'blocked' : 'queries';
			el.textContent = fmt.formatQueries(countFor(el.getAttribute('data-familydns-' + field), field));
		};

		const paintDefaultState = function(el) {
			const desc = fmt.describeLan(state && state.lan);
			el.textContent = desc.text;
			el.style.color = LAN_COLORS[desc.kind] || '';
		};

		const paintRows = function() {
			document.querySelectorAll('[data-familydns-queries],[data-familydns-blocked]').forEach(paintCount);
			document.querySelectorAll('[data-familydns-default]').forEach(paintDefaultState);
			document.querySelectorAll('[data-familydns-setup]').forEach(paintConnection);
		};

		let setupBtn = null;

		const paintSetup = function() {
			if (!setupBtn) return Promise.resolve();
			setupBtn.textContent = state && state.configured ? _('Repair') : _('Set up');
			return uci.changes().then(function(changes) {
				const dirty = fmt.hasPendingChanges(changes);
				setupBtn.disabled = !fmt.canBootstrap(state, dirty);
				setupBtn.title = dirty ? _('Save & Apply your changes first.') : '';
			});
		};

		const paintConnection = function(el) {
			const which = el.getAttribute('data-familydns-setup');
			if (which === 'cert') {
				el.textContent = state ? fmt.describeCert(state.cert) : '–';
				return;
			}
			const addr = fmt.describeAddress(state);
			el.textContent = addr.text;
			el.style.color = addr.ok ? LAN_COLORS.ready : (addr.warn ? LAN_COLORS.warning : '');
		};

		const refresh = function() {
			return fetchStatus().then(function(next) {
				state = next;
				lastFetch = Date.now();
				paintHeader();
				paintRows();
				return paintSetup();
			});
		};

		const tick = function() {
			if (!fmt.shouldFetch(fmt.isRunning(state), Date.now() - lastFetch))
				return paintSetup();
			return refresh();
		};

		const startSetup = function() {
			return callExec(ENGINE, [ 'bootstrap', '--background' ]).then(function(res) {
				if (res.code !== 0)
					throw commandError(res);
				return refresh();
			});
		};

		let m, s, o;

		function buildSetup() {
			s = m.section(form.GridSection, 'settings', _('Connection'),
				state && state.configured
					? _('How phones reach this router from anywhere. Use Repair if something stopped working, after Save & Apply.')
					: _('Start here: Edit to enter your DuckDNS details, Save & Apply, then Set up. Setup gets the DuckDNS address and certificate, configures the resolver and opens the WAN DoT port.'));
			s.anonymous = true;
			s.addremove = false;
			s.modaltitle = _('Connection');
			s.tab('basic', _('Connection'));
			s.tab('advanced', _('Advanced'));

			// Set up / Repair sits next to Edit; it is disabled while changes are unsaved.
			s.renderRowActions = function(section_id) {
				const td = form.GridSection.prototype.renderRowActions.call(this, section_id);
				const box = td.querySelector('div') || td;
				box.className = 'familydns-actions';
				setupBtn = E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-action important' }, _('Set up'));
				setupBtn.addEventListener('click', ui.createHandlerFn(self, function() {
					return startSetup().catch(notifyError);
				}));
				box.insertBefore(setupBtn, box.firstChild);
				paintSetup();
				return td;
			};

			o = s.option(form.DummyValue, '_domain', _('Address'));
			o.modalonly = false;
			o.textvalue = function() {
				return E('div', {}, [
					E('strong', {}, domain() || _('Not set')),
					E('div', { 'style': MUTED }, _('Port %s').format(port()))
				]);
			};

			o = s.option(form.DummyValue, '_ddns', _('DuckDNS'));
			o.modalonly = false;
			o.textvalue = function() {
				const el = E('span', { 'data-familydns-setup': 'ddns' });
				paintConnection(el);
				return el;
			};

			o = s.option(form.DummyValue, '_cert', _('Certificate'));
			o.modalonly = false;
			o.textvalue = function() {
				const el = E('span', { 'data-familydns-setup': 'cert' });
				paintConnection(el);
				return el;
			};

			o = s.taboption('basic', form.Flag, 'enabled', _('Enable Family DNS'));
			o.rmempty = false;

			o = s.taboption('basic', form.Value, 'domain', _('DuckDNS domain'));
			o.placeholder = 'example.duckdns.org';
			o.description = _('Your free DuckDNS name. Devices connect to names under it, e.g. kid1.example.duckdns.org.');
			o.rmempty = true;
			o.validate = function(_section_id, value) {
				return fmt.checkOptional(value, fmt.validDomain, _('Must be a name ending in .duckdns.org'));
			};

			o = s.taboption('basic', form.Value, 'duckdns_token', _('DuckDNS token'));
			o.password = true;
			o.rmempty = true;
			o.description = _('From duckdns.org. Stored only on this router.');

			o = s.taboption('basic', form.Value, 'email', _('Email for the certificate'));
			o.rmempty = true;
			o.description = _('Let\'s Encrypt sends certificate notices to this address.');
			o.validate = function(_section_id, value) {
				return fmt.checkOptional(value, fmt.validEmail, _('Expecting an email address'));
			};

			o = s.taboption('advanced', form.Flag, 'staging', _('Staging certificate'));
			o.description = _('Use Let\'s Encrypt test certificates. Devices do not trust them.');

			o = s.taboption('advanced', form.Value, 'dot_port', _('WAN DoT port'));
			o.placeholder = DEFAULT_PORT;
			o.default = DEFAULT_PORT;
			o.description = _('The port phones connect to from outside the home.');
			o.validate = function(_section_id, value) {
				return fmt.checkOptional(value, fmt.validPort, _('Expecting a port between 1 and 65535'));
			};

			o = s.taboption('advanced', form.Value, 'ratelimit', _('Queries per second per device'));
			o.placeholder = '500';
			o.rmempty = true;
			o.description = _('The resolver drops queries above this rate from one address. Every device is counted on its own. 0 turns the limit off.');
			o.validate = function(_section_id, value) {
				return fmt.checkOptional(value, function(v) { return /^\d+$/.test(v); }, _('Expecting a whole number'));
			};

			o = s.taboption('advanced', form.Flag, 'allow_failover', _('Let iPhones fall back to the network DNS'));
			o.default = '1';
			o.rmempty = false;
			o.description = _('Generated profiles set AllowFailover (iOS 26 and later): if this router is unreachable the iPhone uses the network\'s own DNS instead of losing name resolution. That fallback is the network\'s own resolver, not Family DNS.');

			o = s.taboption('advanced', form.DynamicList, 'fallback', _('Fallback DNS servers'));
			o.rmempty = true;
			o.placeholder = 'https://doh.cleanbrowsing.org/doh/family-filter/';
			withHelp(o, providerHelp(_('Used only when every upstream of a profile is down, so devices still get DNS from these servers. %s').format(fmt.upstreamHint())));
			o.validate = function(_section_id, value) {
				return fmt.checkOptional(value, fmt.validUpstream, fmt.upstreamError());
			};
			modalOnlyOptions(s);
		}

		const onlyDevices = function(section_id) { return section_id !== DEFAULT_SEC; };
		// Everything except the underscore-named status columns is edited in the modal only.
		const modalOnlyOptions = function(section) {
			section.children.forEach(function(c) { if (c.option.charAt(0) !== '_') c.modalonly = true; });
		};

		function buildDevices() {
			s = m.section(form.GridSection, 'device', _('Devices'),
				hasDevices
					? _('Each device uses the profile you pick for it. "Everyone else" covers every device not listed here.')
					: _('Add a device to give a phone or tablet its own profile. "Everyone else" covers every device not listed here.'));
			s.anonymous = true;
			s.addremove = true;
			s.addbtntitle = _('Add device');
			s.modaltitle = _('Device');

			// Rows added with "Add" but left blank are dropped on a user-initiated Save.
			s.parse = function() {
				const nameField = this.children.find(function(c) { return c.option === 'name'; });
				const tasks = [];
				this.cfgsections().forEach(function(sid) {
					if (sid !== DEFAULT_SEC && !nameField.formvalue(sid)) {
						if (self.pruneBlank) this.map.data.remove('familydns', sid);
						return;
					}
					this.children.forEach(function(c) { tasks.push(c.parse(sid)); });
				}, this);
				return Promise.all(tasks);
			};

			// Install profile sits next to the row's Edit and Delete buttons.
			s.renderRowActions = function(section_id) {
				const td = form.GridSection.prototype.renderRowActions.call(this, section_id);
				const clientId = uci.get('familydns', section_id, 'client_id') || '';
				const box = td.querySelector('div') || td;
				box.className = 'familydns-actions';
				if (section_id === DEFAULT_SEC) {
					const remove = box.querySelector('.cbi-button-remove');
					if (remove)
						remove.remove();
					return td;
				}
				box.insertBefore(E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-action',
					'click': ui.createHandlerFn(self, function() { showInstallModal(self, clientId); })
				}, _('Install profile')), box.firstChild);
				return td;
			};

			o = s.option(form.DummyValue, '_device', _('Device'));
			o.modalonly = false;
			o.textvalue = function(section_id) {
				if (section_id === DEFAULT_SEC) {
					const stateLine = E('div', { 'style': MUTED + 'font-weight:600;', 'data-familydns-default': '' });
					paintDefaultState(stateLine);
					return E('div', {}, [ E('strong', {}, uci.get('familydns', section_id, 'name') || _('Everyone else')), stateLine ]);
				}
				const clientId = uci.get('familydns', section_id, 'client_id') || '';
				const name = uci.get('familydns', section_id, 'name') || clientId || _('Unnamed device');
				return E('div', {}, [
					E('strong', {}, name),
					E('div', { 'style': MUTED + 'word-break:break-all;' }, fmt.dotHostname(clientId, domain()) || _('Not saved yet'))
				]);
			};

			o = s.option(form.DummyValue, '_profile', _('Profile'));
			o.modalonly = false;
			o.textvalue = function(section_id) {
				return E('span', {}, profileLabel(uci.get('familydns', section_id, 'profile')));
			};

			o = s.option(form.DummyValue, '_queries', _('Queries'));
			o.modalonly = false;
			o.textvalue = function(section_id) {
				const el = E('span', {
					'data-familydns-queries': section_id === DEFAULT_SEC ? 'default' : (uci.get('familydns', section_id, 'client_id') || ''),
					'title': fmt.queryCountDescription()
				});
				paintCount(el);
				return el;
			};

			o = s.option(form.DummyValue, '_blocked', _('Blocked'));
			o.modalonly = false;
			o.textvalue = function(section_id) {
				const el = E('span', {
					'data-familydns-blocked': section_id === DEFAULT_SEC ? 'default' : (uci.get('familydns', section_id, 'client_id') || ''),
					'title': fmt.blockedCountDescription()
				});
				paintCount(el);
				return el;
			};

			// One field names the device. Its DNS address is generated from the name once, when the
			// device is first saved, and never changes after that, so renaming keeps the phone working.
			o = s.option(form.Value, 'name', _('Name'));
			o.modalonly = true;
			o.checkDepends = onlyDevices;
			o.placeholder = _('Kid\'s iPad');
			o.rmempty = true;
			o.description = _('What you call this device. Renaming it later does not change how it connects.');
			o.validate = function(_section_id, value) {
				return fmt.checkOptional(value, function(v) { return fmt.slugify(v) !== ''; }, _('Use at least one letter or digit'));
			};
			o.write = function(section_id, value) {
				uci.set('familydns', section_id, 'name', value);
				if (uci.get('familydns', section_id, 'client_id'))
					return;
				const taken = (uci.sections('familydns', 'device') || []).map(function(d) { return d.client_id; }).filter(Boolean);
				const id = fmt.deviceId(value, taken);
				if (id)
					uci.set('familydns', section_id, 'client_id', id);
			};

			o = s.option(form.ListValue, 'profile', _('Profile'));
			o.modalonly = true;
			o.default = profileIds[0] || '';
			profiles.forEach(function(p) { o.value(p.id, p.label); });
			o.validate = function(_section_id, value) {
				return fmt.checkOptional(value, function(v) { return profileIds.indexOf(v) >= 0; }, _('Choose an existing profile'));
			};

			o = s.option(form.DummyValue, '_host', _('Connects as'));
			o.modalonly = true;
			o.checkDepends = onlyDevices;
			o.renderWidget = function(section_id) {
				const clientId = uci.get('familydns', section_id, 'client_id');
				return E('code', {}, clientId ? fmt.dotHostname(clientId, domain()) : _('Assigned when you save'));
			};

			o = s.option(form.Value, 'lan_ip', _('Home Wi-Fi address (optional)'));
			o.modalonly = true;
			o.checkDepends = onlyDevices;
			o.placeholder = '192.168.1.50/32';
			o.rmempty = true;
			o.description = _('Lets plain DNS from this address use the profile too. Leave empty unless the device has a fixed address.');
			o.validate = function(_section_id, value) {
				if (!value) return true;
				return fmt.validLanIp(value) ? true : _('Expecting an IPv4 address, optionally with /0-32 (e.g. 192.168.1.50/32)');
			};

			// "Everyone else" is the one row that cannot be removed; it can be switched off.
			o = s.option(form.Flag, 'enabled', _('Filter this network'));
			o.modalonly = true;
			o.default = '0';
			o.checkDepends = function(section_id) { return section_id === DEFAULT_SEC; };
			o.description = fmt.lanDnsDescription();
		}

		function buildProfiles() {
			s = m.section(form.GridSection, 'profile', _('Profiles'),
				profiles.length
					? _('A profile is a list of upstream DNS servers. Devices use the profile you pick for them.')
					: _('No profiles yet. Add one, then choose it for a device.'));
			s.anonymous = true;
			s.addremove = true;
			s.addbtntitle = _('Add profile');
			s.modaltitle = _('Profile');

			// Ask for a name first; the UCI section name (what devices refer to) is derived from it.
			s.handleAdd = function(ev) {
				const section = this;
				askName(_('New profile'), _('What should this profile be called?'), _('Kids tablets'), function(display) {
					const sid = fmt.profileId(display, profileIds);
					if (!sid)
						return;
					ui.hideModal();
					const result = form.GridSection.prototype.handleAdd.call(section, ev, sid);
					section.map.data.set('familydns', sid, 'name', display);
					return result;
				});
			};

			o = s.option(form.DummyValue, '_name', _('Name'));
			o.modalonly = false;
			o.textvalue = function(section_id) {
				return E('strong', {}, uci.get('familydns', section_id, 'name') || section_id);
			};

			o = s.option(form.DummyValue, '_upstream', _('Upstream servers'));
			o.modalonly = false;
			o.textvalue = function(section_id) {
				return E('span', {}, fmt.upstreamSummary(uci.get('familydns', section_id, 'upstream')));
			};

			o = s.option(form.DummyValue, '_devices', _('Devices'));
			o.modalonly = false;
			o.textvalue = function(section_id) {
				return E('span', {}, String(fmt.countDevicesUsing(deviceProfiles, section_id)));
			};

			o = s.option(form.Value, 'name', _('Name'));
			o.modalonly = true;
			o.rmempty = true;

			o = s.option(form.DynamicList, 'upstream', _('Upstream DNS servers'));
			o.modalonly = true;
			o.rmempty = true;
			o.placeholder = 'https://doh.cleanbrowsing.org/doh/family-filter/';
			withHelp(o, providerHelp(fmt.upstreamHint()));
			o.validate = function(_section_id, value) {
				return fmt.checkOptional(value, fmt.validUpstream, fmt.upstreamError());
			};
		}

		m = new form.Map('familydns', _('Family DNS'),
			_('Give each family device its own profile over DNS-over-TLS, reachable from anywhere.'));

		s = m.section(form.NamedSection, 'settings', 'settings');
		s.render = function() {
			paintHeader();
			poll.add(tick, TICK_SECONDS);
			return E('div', {}, [ E('style', {}, PHONE_CSS), header ]);
		};

		// Until setup has run, setup comes first and prominent; afterwards the day-to-day
		// sections lead and setup moves to the end.
		const setupFirst = !(state && state.configured);
		const builders = setupFirst
			? [ buildSetup, buildDevices, buildProfiles ]
			: [ buildDevices, buildProfiles, buildSetup ];
		builders.forEach(function(build) { build(); });

		return m.render();
	}
});
