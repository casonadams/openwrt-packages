'use strict';
'require baseclass';

const CERT_WARN_DAYS = 14;
const IDLE_POLL_MS = 30000;
const STAGE_ORDER = [ 'ddns', 'cert', 'dnsdist', 'firewall', 'lan' ];
const CLIENT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.duckdns\.org$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const LAN_IP_RE = new RegExp('^' + OCTET + '(?:\\.' + OCTET + '){3}(?:\\/(?:3[0-2]|[12]?\\d))?$');
const HOST_RE_SRC = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*';
const DOH_RE = new RegExp('^https://' + HOST_RE_SRC + '(?::(\\d{1,5}))?/\\S+$', 'i');
const DOT_RE = new RegExp('^tls://' + HOST_RE_SRC + '(?::(\\d{1,5}))?$', 'i');
const IPV4_RE = new RegExp('^' + OCTET + '(?:\\.' + OCTET + '){3}(?::(\\d{1,5}))?$');
const PROVIDER_LIST_URL = 'https://adguard-dns.io/kb/general/dns-providers/';
// Section names the UCI config already uses; a profile may not take them.
const RESERVED_PROFILE_IDS = [ 'settings' ];
// Path segments that name a generic DoH endpoint rather than a provider's filter.
const GENERIC_DOH_PATHS = [ 'dns-query', 'doh', 'dns', 'resolve', 'query' ];

function hasOwn(obj, key) {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function stageLabel(name) {
	const labels = {
		ddns: _('DynDNS'), cert: _('Certificate'), dnsdist: _('Resolver'),
		firewall: _('Firewall'), lan: _('Network DNS')
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
		return { kind: 'off', text: _('Off') };
	if (lan.active)
		return { kind: 'ready', text: _('Active') };
	return { kind: 'warning', text: _('Waiting for the resolver - using router DNS') };
}

function lanDnsDescription() {
	return _('Every device on this network, including ones with hardcoded DNS servers, is sent through Family DNS.');
}

function problemFor(status, port) {
	const resolver = status.dnsdist || {};
	const cert = status.cert || {};
	if (!resolver.running)
		return { kind: 'error', text: _('Resolver is not running') };
	if (!resolver.dot_listening)
		return { kind: 'error', text: _('Resolver is not listening on DoT port') };
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

// The public address as DuckDNS knows it versus the WAN address the router actually has.
function describeAddress(status) {
	if (!status || !status.wan_ip)
		return { text: '–', ok: false, warn: false };
	if (status.ddns_ok)
		return { text: _('Up to date (%s)').format(status.wan_ip), ok: true, warn: false };
	if (status.ddns_ip)
		return { text: _('Out of date: router %s, DuckDNS %s').format(status.wan_ip, status.ddns_ip), ok: false, warn: true };
	return { text: _('Not published yet (%s)').format(status.wan_ip), ok: false, warn: true };
}

function validCount(n) {
	return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

function formatQueries(n) {
	return validCount(n) ? n.toLocaleString() : '–';
}

function blockedCountDescription() {
	return _('Answers saying the name does not exist. Most are the filter blocking a site; a mistyped name counts too. Counters restart whenever the resolver restarts.');
}

function queryCountDescription() {
	return _('Counts DNS queries since the resolver last started. Counters restart whenever the resolver restarts: on every configuration change, certificate renewal or restart.');
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

// A profile's UCI section name is derived from its display name. UCI names allow only
// letters, digits and underscores, so dashes become underscores; the result is made unique.
function profileId(name, taken) {
	const base = slugify(name).replace(/-/g, '_');
	if (!base)
		return '';
	const used = RESERVED_PROFILE_IDS.concat(taken || []);
	let id = base;
	for (let n = 2; used.indexOf(id) >= 0; n++)
		id = base + '_' + n;
	return id;
}

function randomHex(n) {
	const bytes = new Uint8Array(Math.ceil(n / 2));
	crypto.getRandomValues(bytes);
	return Array.from(bytes, function(b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, n);
}

// A device's DNS hostname label: a slug of its name plus a short random suffix, so the public
// address cannot be guessed from the name. `random(n)` returns n hex characters (injectable for tests).
function deviceId(name, taken, random) {
	const base = slugify(name).slice(0, 50).replace(/-+$/, '');
	if (!base)
		return '';
	const used = taken || [];
	let id;
	do {
		id = base + '-' + (random || randomHex)(4);
	} while (used.indexOf(id) >= 0);
	return id;
}

function countDevicesUsing(deviceProfiles, id) {
	return (deviceProfiles || []).filter(function(p) { return p === id; }).length;
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
	const m = typeof value === 'string' ? (DOH_RE.exec(value) || DOT_RE.exec(value) || IPV4_RE.exec(value)) : null;
	return !!m && (m[1] === undefined || validPort(m[1]));
}

function upstreamHint() {
	return _('Use https://host/path (DoH), tls://host (DoT) or a plain IPv4 address, optionally with :port. quic:// and sdns:// entries are not supported.');
}

function upstreamError() {
	return _('Expecting https://host/path, tls://host or an IPv4 address, optionally with :port. quic:// and sdns:// entries are not supported.');
}

// Short label for an upstream: the provider host, plus the filter name from a DoH path when
// there is one (https://doh.cleanbrowsing.org/doh/family-filter/ -> "doh.cleanbrowsing.org (family-filter)").
function upstreamName(value) {
	const text = String(value || '');
	const doh = /^https:\/\/([^\/:]+)(?::\d+)?\/(.*)$/i.exec(text);
	if (doh) {
		const label = doh[2].split('/').filter(function(part) {
			return part !== '' && GENERIC_DOH_PATHS.indexOf(part.toLowerCase()) < 0;
		}).pop();
		return label ? doh[1] + ' (' + label + ')' : doh[1];
	}
	const dot = /^tls:\/\/([^:\/]+)/i.exec(text);
	if (dot)
		return dot[1];
	const ip = /^(\d{1,3}(?:\.\d{1,3}){3})/.exec(text);
	return ip ? ip[1] : text;
}

function upstreamSummary(list) {
	const items = (Array.isArray(list) ? list : [ list ]).filter(function(v) {
		return String(v || '').trim() !== '';
	}).map(upstreamName);
	if (items.length === 0)
		return _('None set');
	return items.length === 1 ? items[0] : items[0] + ' ' + _('+%d more').format(items.length - 1);
}

function dotHostname(clientId, domain) {
	return clientId && domain ? clientId + '.' + domain : '';
}

function mobileconfigFilename(clientId) {
	return clientId + '.mobileconfig';
}

function profileArgs(clientId) {
	return [ 'profile', clientId ];
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

return baseclass.extend({
	PROVIDER_LIST_URL: PROVIDER_LIST_URL,
	STAGE_ORDER: STAGE_ORDER.slice(),
	describeState: describeState,
	describeCert: describeCert,
	describeAddress: describeAddress,
	formatQueries: formatQueries,
	queryCountDescription: queryCountDescription,
	blockedCountDescription: blockedCountDescription,
	describeLan: describeLan,
	lanDnsDescription: lanDnsDescription,
	orderStages: orderStages,
	isRunning: isRunning,
	validClientId: validClientId,
	slugify: slugify,
	profileId: profileId,
	deviceId: deviceId,
	countDevicesUsing: countDevicesUsing,
	checkOptional: checkOptional,
	validDomain: validDomain,
	validEmail: validEmail,
	validPort: validPort,
	validLanIp: validLanIp,
	validUpstream: validUpstream,
	upstreamHint: upstreamHint,
	upstreamError: upstreamError,
	upstreamName: upstreamName,
	upstreamSummary: upstreamSummary,
	dotHostname: dotHostname,
	mobileconfigFilename: mobileconfigFilename,
	profileArgs: profileArgs,
	hasPendingChanges: hasPendingChanges,
	canBootstrap: canBootstrap,
	shouldFetch: shouldFetch
});
