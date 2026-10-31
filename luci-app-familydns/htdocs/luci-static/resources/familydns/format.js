'use strict';
'require baseclass';

const CERT_WARN_DAYS = 14;
const IDLE_POLL_MS = 30000;
const CLIENT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.duckdns\.org$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
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
		firewall: _('Firewall'), clients: _('Devices')
	};
	return hasOwn(labels, name) ? labels[name] : name;
}

function isRunning(status) {
	return !!(status && status.progress && status.progress.running);
}

function stageView(stage) {
	return { name: stage.name, label: stageLabel(stage.name), state: stage.state, message: stage.message || '' };
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
	const stages = (progress.stages || []).map(stageView);
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
	return ['profile', clientId].concat(locked ? ['--lock'] : []);
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
	describeState: describeState,
	describeCert: describeCert,
	describeDevice: describeDevice,
	isRunning: isRunning,
	validClientId: validClientId,
	slugify: slugify,
	validDomain: validDomain,
	validEmail: validEmail,
	validPort: validPort,
	isDuplicate: isDuplicate,
	dotHostname: dotHostname,
	mobileconfigFilename: mobileconfigFilename,
	profileArgs: profileArgs,
	hasPendingChanges: hasPendingChanges,
	canBootstrap: canBootstrap,
	shouldFetch: shouldFetch,
	serviceLabel: serviceLabel,
	serviceOptions: serviceOptions
});
