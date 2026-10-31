'use strict';
'require baseclass';

const CERT_WARN_DAYS = 14;
const IDLE_POLL_MS = 30000;
const STAGE_ORDER = [ 'ddns', 'cert', 'agh', 'firewall', 'clients', 'lan' ];
const CLIENT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.duckdns\.org$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const LAN_IP_RE = new RegExp('^' + OCTET + '(?:\\.' + OCTET + '){3}(?:\\/(?:3[0-2]|[12]?\\d))?$');
const SERVICES = {
	tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook',
	snapchat: 'Snapchat', twitter: 'Twitter / X', discord: 'Discord', roblox: 'Roblox',
	fortnite: 'Fortnite', steam: 'Steam', netflix: 'Netflix', reddit: 'Reddit',
	whatsapp: 'WhatsApp', telegram: 'Telegram'
};

function hasOwn(obj, key) {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function stageLabel(name) {
	const labels = {
		ddns: _('DynDNS'), cert: _('Certificate'), agh: _('AdGuard Home'),
		firewall: _('Firewall'), clients: _('Devices'), lan: _('Network DNS')
	};
	return hasOwn(labels, name) ? labels[name] : name;
}

function stageRank(name) {
	const i = STAGE_ORDER.indexOf(name);
	return i < 0 ? STAGE_ORDER.length : i;
}

function orderStages(stages) {
	return stages.slice().sort(function(a, b) { return stageRank(a.name) - stageRank(b.name); });
}

function isRunning(status) {
	return !!(status && status.progress && status.progress.running);
}

function stageView(stage) {
	return { name: stage.name, label: stageLabel(stage.name), state: stage.state, message: stage.message || '' };
}

function describeLan(lan) {
	if (!lan || !lan.enabled)
		return { kind: 'off', text: _('Network DNS: off') };
	if (lan.active)
		return { kind: 'ready', text: _('Network DNS: via AdGuard Home') };
	return { kind: 'warning', text: _('Network DNS: waiting for AdGuard Home - using router DNS') };
}

function joinNames(names) {
	if (names.length <= 1)
		return names.join('');
	return names.slice(0, -1).join(', ') + ' ' + _('and') + ' ' + names[names.length - 1];
}

function retiredNote(lan) {
	if (!lan || !lan.enabled || !lan.retired || lan.retired.length === 0)
		return '';
	const names = joinNames(lan.retired);
	return lan.retired.length === 1
		? _('%s is paused while this is on').format(names)
		: _('%s are paused while this is on').format(names);
}

function lanDnsDescription() {
	return _('All LAN DNS, including devices with hardcoded DNS servers, is redirected to AdGuard Home. adblock and https-dns-proxy are paused while this is on.');
}

function problemFor(status, port) {
	const agh = status.agh || {};
	const cert = status.cert || {};
	if (!agh.running)
		return { kind: 'error', text: _('AdGuard Home is not running') };
	if (!agh.dot_listening)
		return { kind: 'error', text: _('AdGuard Home is not listening for DoT') };
	if (!status.ddns_ok)
		return { kind: 'warning', text: _('DynDNS record does not match the WAN IP') };
	if (!cert.present)
		return { kind: 'warning', text: _('No TLS certificate yet') };
	if (cert.days_left != null && cert.days_left <= 0)
		return { kind: 'warning', text: _('TLS certificate has expired') };
	if (cert.days_left != null && cert.days_left < CERT_WARN_DAYS)
		return { kind: 'warning', text: _('TLS certificate expires in %d days').format(cert.days_left) };
	if (cert.staging)
		return { kind: 'warning', text: _('Staging certificate: devices will not trust it') };
	if (!status.firewall_open)
		return { kind: 'warning', text: _('WAN port %s is closed').format(port) };
	return null;
}

function describeState(status, port) {
	if (!status)
		return { kind: 'error', text: _('Could not read the Family DNS status from the router.'), stages: [] };
	const progress = status.progress || {};
	const stages = orderStages((progress.stages || []).map(stageView));
	if (progress.running) {
		const current = stages.find(function(s) { return s.state === 'running'; });
		return {
			kind: 'running',
			text: _('Setting up... %s').format(current ? current.label : (progress.message || '')),
			stages: stages
		};
	}
	const failed = stages.find(function(s) { return s.state === 'error'; });
	if (failed)
		return {
			kind: 'error',
			text: _('Setup failed at %s: %s').format(failed.label, failed.message || progress.message || ''),
			stages: stages
		};
	if (progress.state === 'error')
		return { kind: 'error', text: _('Setup failed: %s').format(progress.message || ''), stages: stages };
	if (!status.configured)
		return { kind: 'off', text: _('Not set up'), stages: stages };
	const problem = problemFor(status, port || '853');
	if (problem)
		return { kind: problem.kind, text: problem.text, stages: stages };
	return { kind: 'ready', text: _('Ready - DoT on %s:%s').format(status.domain, port || '853'), stages: stages };
}

function describeCert(cert) {
	if (!cert || !cert.present)
		return _('No certificate');
	let text;
	if (cert.days_left == null)
		text = _('Valid');
	else if (cert.days_left <= 0)
		text = _('Expired');
	else if (cert.days_left === 1)
		text = _('1 day left');
	else
		text = _('%d days left').format(cert.days_left);
	return cert.staging ? text + ' ' + _('(staging)') : text;
}

function describeDevice(device) {
	if (!device)
		return { active: false, text: _('Not applied yet') };
	return device.in_agh
		? { active: true, text: _('Active in AdGuard Home') }
		: { active: false, text: _('Waiting for sync to AdGuard Home') };
}

function validClientId(id) {
	return CLIENT_ID_RE.test(String(id || ''));
}

function slugify(name) {
	return String(name || '').toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 63)
		.replace(/-+$/, '');
}

// LuCI validates blank optional fields, blank list entries and freshly added table rows, so a
// validator must accept empty input; required-ness is enforced by the engine and the Set up button.
function checkOptional(value, isValid, message) {
	const text = Array.isArray(value) ? value.join('') : String(value == null ? '' : value);
	return text.trim() === '' || isValid(text) ? true : message;
}

function validDomain(domain) {
	return DOMAIN_RE.test(String(domain || ''));
}

function validEmail(email) {
	return EMAIL_RE.test(String(email || ''));
}

function validPort(port) {
	const s = String(port || '');
	return /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 65535;
}

function validLanIp(value) {
	return LAN_IP_RE.test(String(value || ''));
}

function validUpstream(value) {
	return typeof value === 'string' && /^\S+$/.test(value);
}

function isDuplicate(id, others) {
	return (others || []).indexOf(id) >= 0;
}

function dotHostname(clientId, domain) {
	return clientId && domain ? clientId + '.' + domain : '';
}

function mobileconfigFilename(clientId) {
	return clientId + '.mobileconfig';
}

function profileArgs(clientId, locked) {
	return [ 'profile', clientId ].concat(locked ? [ '--lock' ] : []);
}

function parseAdminJson(text) {
	let doc;
	try {
		doc = JSON.parse(text);
	} catch (e) {
		return null;
	}
	if (!doc || typeof doc !== 'object')
		return null;
	const ok = function(v) { return typeof v === 'string' && v.length > 0; };
	if (!ok(doc.url) || !ok(doc.username) || !ok(doc.password))
		return null;
	return { url: doc.url, username: doc.username, password: doc.password };
}

function hasPendingChanges(changes) {
	return !!(changes && changes.familydns && changes.familydns.length);
}

function canBootstrap(status, dirty) {
	return !dirty && !isRunning(status);
}

function shouldFetch(running, elapsedMs) {
	return running || elapsedMs >= IDLE_POLL_MS;
}

function serviceLabel(id) {
	return hasOwn(SERVICES, id) ? SERVICES[id] : id;
}

function serviceOptions(extra) {
	const out = Object.keys(SERVICES).map(function(id) { return { id: id, label: SERVICES[id] }; });
	[].concat(extra || []).forEach(function(id) {
		if (id && !hasOwn(SERVICES, id) && !out.some(function(o) { return o.id === id; }))
			out.push({ id: id, label: id });
	});
	return out;
}

return baseclass.extend({
	STAGE_ORDER: STAGE_ORDER.slice(),
	describeState: describeState,
	describeCert: describeCert,
	describeDevice: describeDevice,
	describeLan: describeLan,
	retiredNote: retiredNote,
	lanDnsDescription: lanDnsDescription,
	orderStages: orderStages,
	isRunning: isRunning,
	validClientId: validClientId,
	slugify: slugify,
	checkOptional: checkOptional,
	validDomain: validDomain,
	validEmail: validEmail,
	validPort: validPort,
	validLanIp: validLanIp,
	validUpstream: validUpstream,
	isDuplicate: isDuplicate,
	dotHostname: dotHostname,
	mobileconfigFilename: mobileconfigFilename,
	profileArgs: profileArgs,
	parseAdminJson: parseAdminJson,
	hasPendingChanges: hasPendingChanges,
	canBootstrap: canBootstrap,
	shouldFetch: shouldFetch,
	serviceLabel: serviceLabel,
	serviceOptions: serviceOptions
});
