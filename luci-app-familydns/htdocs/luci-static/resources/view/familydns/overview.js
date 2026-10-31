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

function fetchAdmin() {
	return callExec(ENGINE, [ 'admin' ]).then(function(res) {
		if (res.code !== 0)
			throw commandError(res);
		const creds = fmt.parseAdminJson(res.stdout);
		if (!creds)
			throw new Error(_('Unexpected response from the router'));
		return creds;
	});
}

function notifyError(err) {
	ui.addNotification(null, E('p', _('Operation failed: %s').format(err.message || err)));
}

function commandError(res) {
	return new Error(((res.stderr || res.stdout || '') + '').trim() || _('command failed'));
}

function downloadProfile(clientId, locked) {
	return callExec(ENGINE, fmt.profileArgs(clientId, locked)).then(function(res) {
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

function confirmLocked(clientId) {
	ui.showModal(_('Locked profile'), [
		E('p', {}, _('A locked profile cannot be removed on the iPhone. It only takes effect on supervised iPhones (Apple Configurator or MDM); other devices install it as a normal profile.')),
		E('div', { 'class': 'right' }, [
			E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Cancel')),
			' ',
			E('button', {
				'class': 'btn cbi-button cbi-button-negative',
				'click': function() {
					ui.hideModal();
					downloadProfile(clientId, true).catch(notifyError);
				}
			}, _('Download locked profile'))
		])
	]);
}

// LuCI is usually served over plain HTTP, where navigator.clipboard does not exist.
function copyText(text) {
	if (navigator.clipboard && window.isSecureContext)
		return navigator.clipboard.writeText(text);
	return new Promise(function(resolve, reject) {
		const area = E('textarea', { 'readonly': '', 'style': 'position:fixed;top:0;left:0;opacity:0;' });
		area.value = text;
		document.body.appendChild(area);
		area.select();
		area.setSelectionRange(0, text.length);
		let ok = false;
		try {
			ok = document.execCommand('copy');
		} catch (e) {
			ok = false;
		}
		document.body.removeChild(area);
		if (ok) resolve();
		else reject(new Error(_('The browser blocked copying. Show the password and copy it by hand.')));
	});
}

function copyPassword(password) {
	return copyText(password).then(function() {
		ui.addNotification(null, E('p', _('Password copied to the clipboard.')), 'info');
	}, notifyError);
}

// Credentials live only in this DOM subtree; they are never logged or stored.
function renderLogin(creds, onClose) {
	const masked = '••••••••';
	let shown = false;
	const pw = E('code', {}, masked);
	const reveal = E('button', { 'type': 'button', 'class': 'btn cbi-button' }, _('Show password'));
	reveal.addEventListener('click', function() {
		shown = !shown;
		pw.textContent = shown ? creds.password : masked;
		reveal.textContent = shown ? _('Hide password') : _('Show password');
	});
	const copy = E('button', { 'type': 'button', 'class': 'btn cbi-button' }, _('Copy password'));
	copy.addEventListener('click', function() { copyPassword(creds.password); });
	const close = E('button', { 'type': 'button', 'class': 'btn cbi-button' }, _('Hide login'));
	close.addEventListener('click', onClose);
	return [
		E('div', {}, [ _('Username: '), E('code', {}, creds.username) ]),
		E('div', { 'style': 'margin-top:4px;' }, [ _('Password: '), pw, ' ', reveal, ' ', copy ]),
		E('div', { 'style': 'margin-top:6px;' }, [ close ])
	];
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

		const header = E('div', {
			'class': 'cbi-section',
			'style': 'margin-bottom:16px;padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;'
		});
		const loginBox = E('div', {
			'class': 'cbi-section',
			'style': 'margin-bottom:16px;padding:12px 16px;display:none;'
		});

		const hideLogin = function() {
			dom.content(loginBox, []);
			loginBox.style.display = 'none';
		};

		const showLogin = function() {
			return fetchAdmin().then(function(creds) {
				dom.content(loginBox, [ E('strong', {}, _('AdGuard Home login')) ].concat(renderLogin(creds, hideLogin)));
				loginBox.style.display = '';
			}).catch(notifyError);
		};

		const openAdGuard = function() {
			const win = window.open('', '_blank');
			return fetchAdmin().then(function(creds) {
				return copyText(creds.password).then(function() {
					ui.addNotification(null, E('p', _('Password copied. Sign in as %s and paste it.').format(creds.username)), 'info');
				}, function() {
					ui.addNotification(null, E('p', _('Could not copy the password. Use Show login to copy it by hand.')));
				}).then(function() {
					if (win) win.location.href = creds.url;
					else showLogin();
				});
			}).catch(function(err) {
				if (win) win.close();
				notifyError(err);
			});
		};

		const adminButtons = function() {
			const open = E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-action important' }, _('Open AdGuard Home'));
			open.addEventListener('click', ui.createHandlerFn(self, openAdGuard));
			const login = E('button', { 'type': 'button', 'class': 'btn cbi-button' }, _('Show login'));
			login.addEventListener('click', ui.createHandlerFn(self, showLogin));
			return E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:6px;' }, [ open, login ]);
		};

		const paintHeader = function() {
			const desc = fmt.describeState(state, port());
			const lan = fmt.describeLan(state && state.lan);
			const children = [ badge(desc.text, desc.kind), badge(lan.text, lan.kind) ];
			if (fmt.isRunning(state) && desc.stages.length) {
				children.push(E('ul', { 'style': 'flex-basis:100%;margin:0;font-size:12px;' }, desc.stages.map(function(s) {
					return E('li', {}, s.label + ': ' + s.state + (s.message ? ' – ' + s.message : ''));
				})));
			}
			if (state) {
				children.push(E('span', { 'style': 'opacity:0.75;font-size:12px;' },
					'WAN ' + (state.wan_ip || '–') + ' · DynDNS ' + (state.ddns_ip || '–') + ' · ' +
					_('Certificate') + ': ' + fmt.describeCert(state.cert)));
			}
			const retired = fmt.retiredNote(state && state.lan);
			if (retired)
				children.push(E('span', { 'style': 'opacity:0.75;font-size:12px;' }, retired));
			if (state && state.agh && state.agh.running)
				children.push(adminButtons());
			else
				hideLogin();
			dom.content(header, children);
		};

		const paintDevice = function(el) {
			const id = el.getAttribute('data-familydns-client');
			const devices = (state && state.devices) || [];
			const dev = devices.find(function(d) { return d.client_id === id; });
			const desc = fmt.describeDevice(dev);
			el.style.color = desc.active ? 'var(--success-color-high)' : (dev ? 'var(--warning-color-high)' : '');
			el.textContent = desc.text;
		};

		const paintDevices = function() {
			document.querySelectorAll('[data-familydns-client]').forEach(function(el) { paintDevice(el); });
		};

		let setupBtn = null;
		let setupHint = null;

		const paintSetup = function() {
			if (!setupBtn) return Promise.resolve();
			setupBtn.textContent = state && state.configured ? _('Repair') : _('Set up');
			return uci.changes().then(function(changes) {
				const dirty = fmt.hasPendingChanges(changes);
				setupBtn.disabled = !fmt.canBootstrap(state, dirty);
				setupHint.style.display = dirty ? '' : 'none';
			});
		};

		const refresh = function() {
			return fetchStatus().then(function(next) {
				state = next;
				lastFetch = Date.now();
				paintHeader();
				paintDevices();
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
		let clientOpt = null;
		let nameOpt = null;

		m = new form.Map('familydns', _('Family DNS'),
			_('Give each family device its own AdGuard Home profile over DNS-over-TLS, reachable from anywhere.'));

		s = m.section(form.NamedSection, 'settings', 'settings');
		s.render = function() {
			paintHeader();
			poll.add(tick, TICK_SECONDS);
			return E('div', {}, [ header, loginBox ]);
		};

		s = m.section(form.NamedSection, 'settings', 'settings', _('Setup'),
			_('Save & Apply before running setup. Setup obtains the DuckDNS address and TLS certificate, configures AdGuard Home and opens the WAN DoT port.'));

		o = s.option(form.Flag, 'enabled', _('Enable Family DNS'));
		o.rmempty = false;

		o = s.option(form.Value, 'domain', _('DuckDNS domain'));
		o.placeholder = 'example.duckdns.org';
		o.rmempty = true;
		o.validate = function(_section_id, value) {
			return fmt.checkOptional(value, fmt.validDomain, _('Must be a name ending in .duckdns.org'));
		};

		o = s.option(form.Value, 'duckdns_token', _('DuckDNS token'));
		o.password = true;
		o.rmempty = true;

		o = s.option(form.Value, 'email', _('Email (TLS account)'));
		o.rmempty = true;
		o.validate = function(_section_id, value) {
			return fmt.checkOptional(value, fmt.validEmail, _('Expecting an email address'));
		};

		o = s.option(form.Flag, 'staging', _('Staging certificate'));
		o.description = _('Use Let\'s Encrypt staging certificates for testing. Devices do not trust them.');

		o = s.option(form.Value, 'dot_port', _('WAN DoT port'));
		o.placeholder = DEFAULT_PORT;
		o.default = DEFAULT_PORT;
		o.validate = function(_section_id, value) {
			return fmt.checkOptional(value, fmt.validPort, _('Expecting a port between 1 and 65535'));
		};

		o = s.option(form.Flag, 'lan_dns', _('Use AdGuard Home for this network\'s DNS'));
		o.description = fmt.lanDnsDescription();
		o.default = '0';

		o = s.option(form.ListValue, 'lan_profile', _('Network profile'));
		o.description = _('Profile whose filters apply to every LAN device while the option above is on.');
		o.default = 'adult';
		profiles.forEach(function(p) { o.value(p.id, p.label); });

		o = s.option(form.DynamicList, 'upstream', _('Upstream DNS servers (optional)'));
		o.description = _('Examples: https://dns10.quad9.net/dns-query or tls://one.one.one.one. Leave empty to keep the current AdGuard Home upstreams.');
		o.placeholder = 'https://dns10.quad9.net/dns-query';
		o.rmempty = true;
		o.validate = function(_section_id, value) {
			return fmt.checkOptional(value, fmt.validUpstream, _('Enter one server per entry, without spaces'));
		};

		o = s.option(form.DynamicList, 'fallback', _('Fallback DNS servers (optional)'));
		o.rmempty = true;
		o.placeholder = 'https://doh.cleanbrowsing.org/doh/family-filter/';
		o.description = _('Used only when every upstream of a query fails, so devices still get (filtered) DNS if their profile servers are down.');
		o.validate = function(_section_id, value) {
			return fmt.checkOptional(value, fmt.validUpstream, _('Enter one server per entry, without spaces'));
		};

		o = s.option(form.DummyValue, '_setup', _('Setup'));
		o.renderWidget = function() {
			setupBtn = E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-action important' }, _('Set up'));
			setupHint = E('div', { 'style': 'margin-top:6px;font-size:12px;opacity:0.8;display:none;' },
				_('Unsaved changes: Save & Apply before running setup.'));
			setupBtn.addEventListener('click', ui.createHandlerFn(self, function() {
				return startSetup().catch(notifyError);
			}));
			paintSetup();
			return E('div', {}, [ setupBtn, setupHint ]);
		};

		s = m.section(form.GridSection, 'profile', _('Profiles'),
			_('Each profile sets the filters applied to the devices that use it.'));
		s.anonymous = false;
		s.addremove = true;
		s.modaltitle = _('Family DNS Profile');

		o = s.option(form.Value, 'name', _('Name'));
		o.rmempty = true;

		o = s.option(form.Flag, 'filtering', _('Ad blocking'));
		o.default = '1';
		o.editable = true;

		o = s.option(form.Flag, 'safe_search', _('Safe search'));
		o.default = '0';
		o.editable = true;

		o = s.option(form.Flag, 'parental', _('Parental control'));
		o.default = '0';
		o.editable = true;

		o = s.option(form.Flag, 'safebrowsing', _('Safe browsing'));
		o.default = '0';
		o.editable = true;

		o = s.option(form.MultiValue, 'blocked_services', _('Blocked services'));
		o.modalonly = true;
		const storedServices = [];
		(uci.sections('familydns', 'profile') || []).forEach(function(p) {
			[].concat(p.blocked_services || []).forEach(function(id) { storedServices.push(id); });
		});
		fmt.serviceOptions(storedServices).forEach(function(svc) { o.value(svc.id, svc.label); });

		o = s.option(form.DynamicList, 'upstream', _('DNS servers (optional)'));
		o.modalonly = true;
		o.rmempty = true;
		o.placeholder = 'https://doh.cleanbrowsing.org/doh/family-filter/';
		o.description = _('Devices using this profile resolve through these upstreams (DoH, DoT, DoQ or plain IP), one per entry. Leave empty to use the AdGuard Home defaults.');
		o.validate = function(_section_id, value) {
			return fmt.checkOptional(value, fmt.validUpstream, _('Enter one server per entry, without spaces'));
		};

		s = m.section(form.TableSection, 'device', _('Devices'),
			_('Only listed devices get their own profile; all other traffic is untouched.'));
		s.anonymous = true;
		s.addremove = true;

		// Rows added with "Add" but left blank are dropped on a user-initiated Save.
		s.parse = function() {
			const nameField = this.children.find(function(c) { return c.option === 'name'; });
			const idField = this.children.find(function(c) { return c.option === 'client_id'; });
			const tasks = [];
			this.cfgsections().forEach(function(sid) {
				if (!nameField.formvalue(sid) && !idField.formvalue(sid)) {
					if (self.pruneBlank) this.map.data.remove('familydns', sid);
					return;
				}
				this.children.forEach(function(c) { tasks.push(c.parse(sid)); });
			}, this);
			return Promise.all(tasks);
		};

		const otherClientIds = function(section_id) {
			return clientOpt.section.cfgsections()
				.filter(function(sid) { return sid !== section_id; })
				.map(function(sid) { return clientOpt.formvalue(sid); });
		};

		o = s.option(form.Value, 'name', _('Device name'));
		o.placeholder = _('Kid 1 iPhone');
		o.rmempty = true;
		nameOpt = o;
		o.onchange = function(_ev, section_id, value) {
			const node = clientOpt ? o.map.findElement('id', clientOpt.cbid(section_id)) : null;
			if (node && !node.value) {
				node.value = fmt.slugify(value);
				node.dispatchEvent(new Event('change', { bubbles: true }));
			}
		};

		clientOpt = s.option(form.Value, 'client_id', _('Client ID'));
		clientOpt.placeholder = 'kid1';
		clientOpt.rmempty = false;
		clientOpt.write = function(section_id, value) {
			return uci.set('familydns', section_id, 'client_id', value || fmt.slugify(nameOpt.formvalue(section_id)));
		};
		clientOpt.validate = function(section_id, value) {
			const problem = fmt.checkOptional(value, fmt.validClientId, _('Use 1-63 lowercase letters, digits or dashes; no leading or trailing dash'));
			if (problem !== true)
				return problem;
			if (value && fmt.isDuplicate(value, otherClientIds(section_id).filter(Boolean)))
				return _('Another device already uses this client ID');
			return true;
		};

		o = s.option(form.ListValue, 'profile', _('Profile'));
		o.default = profileIds[0] || '';
		profiles.forEach(function(p) { o.value(p.id, p.label); });
		o.validate = function(_section_id, value) {
			return fmt.checkOptional(value, function(v) { return profileIds.indexOf(v) >= 0; }, _('Choose an existing profile'));
		};

		o = s.option(form.Value, 'lan_ip', _('LAN address'));
		o.placeholder = '192.168.1.50/32';
		o.rmempty = true;
		o.validate = function(_section_id, value) {
			if (!value) return true;
			return fmt.validLanIp(value) ? true : _('Expecting an IPv4 address, optionally with /0-32 (e.g. 192.168.1.50/32)');
		};

		o = s.option(form.DummyValue, '_status', _('Status'));
		o.renderWidget = function(section_id) {
			const el = E('span', {
				'data-familydns-client': uci.get('familydns', section_id, 'client_id') || '',
				'style': 'font-weight:600;'
			});
			paintDevice(el);
			return el;
		};

		o = s.option(form.DummyValue, '_dot', _('DoT hostname'));
		o.renderWidget = function(section_id) {
			return E('code', {}, fmt.dotHostname(uci.get('familydns', section_id, 'client_id'), domain()) || '–');
		};

		o = s.option(form.DummyValue, '_actions', _('Profile file'));
		o.renderWidget = function(section_id) {
			const clientId = uci.get('familydns', section_id, 'client_id') || '';
			const profileButton = function(label, locked, cls) {
				const btn = E('button', { 'type': 'button', 'class': 'btn cbi-button ' + cls }, label);
				btn.addEventListener('click', ui.createHandlerFn(self, function() {
					if (!clientId)
						return notifyError(new Error(_('Save the device before installing its profile.')));
					if (locked)
						return confirmLocked(clientId);
					return downloadProfile(clientId, false).catch(notifyError);
				}));
				return btn;
			};
			return E('div', { 'style': 'display:flex;flex-wrap:wrap;gap:6px;' }, [
				profileButton(_('Install profile'), false, 'cbi-button-action'),
				profileButton(_('Locked profile'), true, 'cbi-button-negative')
			]);
		};

		s = m.section(form.NamedSection, 'settings', 'settings');
		s.render = function() {
			return E('div', { 'class': 'cbi-section-descr' }, [
				E('p', {}, _('Each device resolves DNS over TLS at <client-id>.<domain>:<port> (shown in the table above). Save & Apply your changes before downloading a profile.')),
				E('p', {}, _('iPhone setup:')),
				E('ol', {}, [
					E('li', {}, _('Click Install profile (this downloads <client-id>.mobileconfig) and AirDrop the file to the iPhone, or open this page in Safari on the iPhone and tap Install profile.')),
					E('li', {}, _('Tap the downloaded file, then go to Settings > General > VPN & Device Management, tap the profile and choose Install (enter the passcode).')),
					E('li', {}, _('Important: go to Settings > General > VPN & Device Management > DNS and select this profile. Unsupervised iPhones must enable it; supervised iPhones activate it automatically.')),
					E('li', {}, _('To remove: Settings > General > VPN & Device Management > the profile > Remove Profile. A Locked profile cannot be removed on a supervised iPhone.'))
				])
			]);
		};

		return m.render();
	}
});
