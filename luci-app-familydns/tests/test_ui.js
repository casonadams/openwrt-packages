'use strict';
// Unit tests for the pure formatting module used by the LuCI view.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

String.prototype.format = function() {
	let i = 0;
	const args = arguments;
	return this.replace(/%[sd]/g, function() { return args[i++]; });
};
const src = fs.readFileSync(path.join(__dirname, '..',
	'htdocs/luci-static/resources/familydns/format.js'), 'utf8');
const fmt = new Function('baseclass', '_', src)({ extend: function(o) { return o; } }, function(s) { return s; });

let passed = 0;
function check(desc, actual, expected) {
	assert.deepStrictEqual(actual, expected, desc);
	console.log('  ✓ ' + desc);
	passed++;
}

function status(overrides) {
	const base = {
		configured: true,
		domain: 'example.duckdns.org',
		wan_ip: '203.0.113.7',
		ddns_ip: '203.0.113.7',
		ddns_ok: true,
		cert: { present: true, not_after: '2027-01-29T18:47:40Z', days_left: 88, staging: false },
		dnsdist: { running: true, version: '1.9.0', dot_listening: true },
		firewall_open: true,
		progress: { running: false, state: 'idle', message: '', stages: [] },
		devices: []
	};
	return Object.assign(base, overrides || {});
}

function withProgress(progress) {
	return status({ progress: Object.assign({ running: false, state: 'idle', message: '', stages: [] }, progress) });
}

console.log('-> ad blocking');
check('presets include the default first', fmt.blocklistPresets()[0].id, 'hagezi');
check('every preset has a label and a name', fmt.blocklistPresets().every(function(p) { return p.label && p.name; }), true);
check('presets can be switched off', fmt.blocklistPresets().some(function(p) { return p.id === 'off'; }), true);
check('active list shows name and size', fmt.describeBlocklist({ preset: 'hagezi', active: true, domains: 175760, updated: 1 }),
	{ name: 'HaGeZi Multi Normal', detail: (175760).toLocaleString() + ' domains' });
check('a missing preset means the default', fmt.describeBlocklist({ preset: '', active: true, domains: 5 }).name, 'HaGeZi Multi Normal');
check('a list not downloaded yet says so', fmt.describeBlocklist({ preset: 'stevenblack', active: false, domains: null }),
	{ name: 'StevenBlack', detail: 'Not downloaded yet' });
check('off says so', fmt.describeBlocklist({ preset: 'off', active: false }), { name: 'Off', detail: 'Ad blocking is off' });
check('unknown status is an en dash', fmt.describeBlocklist(null).name, '–');
check('updated today', fmt.formatUpdated(1000, 1000 + 3600), 'Today');
check('updated yesterday', fmt.formatUpdated(1000, 1000 + 86400 + 5), 'Yesterday');
check('updated days ago', fmt.formatUpdated(1000, 1000 + 3 * 86400), '3 days ago');
check('unknown update time is an en dash', fmt.formatUpdated(null, 5), '–');
check('allowed domain accepts a name', fmt.validAllowedDomain('ads.example.com'), true);
check('allowed domain accepts a wildcard', fmt.validAllowedDomain('*.example.com'), true);
check('allowed domain rejects a single label', fmt.validAllowedDomain('localhost'), false);
check('allowed domain rejects a url', fmt.validAllowedDomain('https://example.com/'), false);
check('list url accepts https', fmt.validListUrl('https://example.com/list.txt'), true);
check('list url accepts http', fmt.validListUrl('http://10.0.0.5:8080/hosts'), true);
check('list url rejects other schemes', fmt.validListUrl('ftp://example.com/list.txt'), false);
check('list url needs a path', fmt.validListUrl('https://example.com'), false);

console.log('-> connection address');
check('address is up to date', fmt.describeAddress(status({ wan_ip: '203.0.113.7', ddns_ip: '203.0.113.7', ddns_ok: true })),
	{ text: 'Up to date (203.0.113.7)', ok: true, warn: false });
check('address mismatch names both', fmt.describeAddress(status({ wan_ip: '203.0.113.7', ddns_ip: '198.51.100.1', ddns_ok: false })).text,
	'Out of date: router 203.0.113.7, DuckDNS 198.51.100.1');
check('address mismatch warns', fmt.describeAddress(status({ wan_ip: '203.0.113.7', ddns_ip: '198.51.100.1', ddns_ok: false })).warn, true);
check('address not yet published', fmt.describeAddress(status({ wan_ip: '203.0.113.7', ddns_ip: null, ddns_ok: false })).text,
	'Not published yet (203.0.113.7)');
check('address without a WAN IP is an en dash', fmt.describeAddress(status({ wan_ip: null })).text, '–');
check('address without status is an en dash', fmt.describeAddress(null).text, '–');

console.log('-> client ids');
check('slug from device name', fmt.slugify('Kid 1 iPhone'), 'kid-1-iphone');
check('slug trims punctuation', fmt.slugify('  --Mum’s phone!! '), 'mum-s-phone');
check('slug of symbols is empty', fmt.slugify('!!!'), '');
check('slug truncates to 63 without trailing dash', fmt.slugify(new Array(40).join('ab-') + 'x').length <= 63, true);
check('slug never ends with a dash', /-$/.test(fmt.slugify(new Array(20).join('abcd ') + 'ab cd')), false);
check('plain id is valid', fmt.validClientId('kid1'), true);
check('single character id is valid', fmt.validClientId('a'), true);
check('inner dash is valid', fmt.validClientId('kid-1'), true);
check('63 characters is valid', fmt.validClientId(new Array(64).join('a')), true);
check('64 characters is invalid', fmt.validClientId(new Array(65).join('a')), false);
check('leading dash is invalid', fmt.validClientId('-kid'), false);
check('trailing dash is invalid', fmt.validClientId('kid-'), false);
check('uppercase is invalid', fmt.validClientId('Kid1'), false);
check('underscore is invalid', fmt.validClientId('kid_1'), false);
check('space is invalid', fmt.validClientId('kid 1'), false);
check('dot is invalid', fmt.validClientId('kid.1'), false);
check('empty is invalid', fmt.validClientId(''), false);
check('undefined is invalid', fmt.validClientId(undefined), false);
const seq = function(list) { let i = 0; return function() { return list[i++]; }; };
check('device id is the name slug plus a short suffix', fmt.deviceId('Landon\'s iPad', [], seq(['1a2b'])), 'landon-s-ipad-1a2b');
check('device id is a valid client id', fmt.validClientId(fmt.deviceId('Kid 1 iPhone', [])), true);
check('device id suffix is random hex by default', /^kid-[0-9a-f]{4}$/.test(fmt.deviceId('Kid', [])), true);
check('device id retries when the suffix is taken', fmt.deviceId('Kid', [ 'kid-aaaa' ], seq(['aaaa', 'bbbb'])), 'kid-bbbb');
check('device id of symbols is empty', fmt.deviceId('!!!', []), '');
check('device id stays within a DNS label', fmt.deviceId(new Array(40).join('abc-'), [], seq(['ffff'])).length <= 63, true);
check('device id never has a double dash', /--/.test(fmt.deviceId('a---b', [], seq(['0000']))), false);

console.log('-> profile section ids');
check('profile id from name', fmt.profileId('Adults'), 'adults');
check('profile id uses underscores (UCI names)', fmt.profileId('Kids Filter!'), 'kids_filter');
check('profile id is unique', fmt.profileId('Adults', [ 'adults' ]), 'adults_2');
check('profile id skips taken ids in order', fmt.profileId('Adults', [ 'adults', 'adults_2' ]), 'adults_3');
check('profile id may not be the settings section', fmt.profileId('settings'), 'settings_2');
check('profile id of symbols is empty', fmt.profileId('!!!'), '');
check('devices using a profile are counted', fmt.countDevicesUsing([ 'adult', 'kid', 'adult' ], 'adult'), 2);
check('no devices use an unused profile', fmt.countDevicesUsing([ 'adult' ], 'kid'), 0);
check('no device list counts zero', fmt.countDevicesUsing(undefined, 'kid'), 0);

console.log('-> domain, email, port');
check('duckdns domain is valid', fmt.validDomain('example.duckdns.org'), true);
check('domain case is ignored', fmt.validDomain('Example.DuckDNS.org'), true);
check('bare duckdns.org is invalid', fmt.validDomain('duckdns.org'), false);
check('other domain is invalid', fmt.validDomain('example.com'), false);
check('suffix spoof is invalid', fmt.validDomain('example.duckdns.org.evil.com'), false);
check('empty domain is invalid', fmt.validDomain(''), false);
check('email is valid', fmt.validEmail('owner@example.com'), true);
check('email without @ is invalid', fmt.validEmail('owner.example.com'), false);
check('email with space is invalid', fmt.validEmail('owner @example.com'), false);
check('port 853 is valid', fmt.validPort('853'), true);
check('port 0 is invalid', fmt.validPort('0'), false);
check('port 65536 is invalid', fmt.validPort('65536'), false);
check('non-numeric port is invalid', fmt.validPort('8s53'), false);

console.log('-> engine state banner');
check('null status reports the read failure', fmt.describeState(null, '853').kind, 'error');
check('unconfigured is not set up', fmt.describeState(status({ configured: false }), '853').text, 'Not set up');
check('healthy is ready with port', fmt.describeState(status(), '853'),
	{ kind: 'ready', text: 'Ready - DoT on example.duckdns.org:853', stages: [] });
check('custom port is shown', fmt.describeState(status(), '8853').text, 'Ready - DoT on example.duckdns.org:8853');
check('running names the current stage', fmt.describeState(withProgress({ running: true, state: 'running',
	stages: [ { name: 'ddns', state: 'ok', message: '' }, { name: 'cert', state: 'running', message: '' } ] }), '853').text,
	'Setting up... Certificate');
check('running shows stage list', fmt.describeState(withProgress({ running: true, state: 'running',
	stages: [ { name: 'dnsdist', state: 'pending', message: '' } ] }), '853').stages,
	[ { name: 'dnsdist', label: 'Resolver', state: 'pending', message: '' } ]);
check('stage error names the stage and message', fmt.describeState(withProgress({ state: 'error', message: 'boom',
	stages: [ { name: 'cert', state: 'error', message: 'rate limited' } ] }), '853').text,
	'Setup failed at Certificate: rate limited');
check('progress error without stage detail', fmt.describeState(withProgress({ state: 'error', message: 'busy' }), '853').text,
	'Setup failed: busy');
check('stage error beats not-configured', fmt.describeState(status({ configured: false,
	progress: { running: false, state: 'error', message: '', stages: [ { name: 'ddns', state: 'error', message: 'token' } ] } }), '853').kind,
	'error');
check('ddns mismatch warns', fmt.describeState(status({ ddns_ok: false, ddns_ip: '198.51.100.1' }), '853').kind, 'warning');
check('missing certificate warns', fmt.describeState(status({ cert: { present: false, not_after: null, days_left: null, staging: false } }), '853').text,
	'No TLS certificate yet');
check('expiring certificate names the days', fmt.describeState(status({ cert: { present: true, not_after: null, days_left: 5, staging: false } }), '853').text,
	'TLS certificate expires in 5 days');
check('certificate at 14 days is still fine', fmt.describeState(status({ cert: { present: true, not_after: null, days_left: 14, staging: false } }), '853').kind,
	'ready');
check('expired certificate is reported', fmt.describeState(status({ cert: { present: true, not_after: null, days_left: 0, staging: false } }), '853').text,
	'TLS certificate has expired');
check('staging certificate warns', fmt.describeState(status({ cert: { present: true, not_after: null, days_left: 80, staging: true } }), '853').text,
	'Staging certificate: devices will not trust it');
check('resolver not running is an error', fmt.describeState(status({ dnsdist: { running: false, dot_listening: false, version: null } }), '853').text,
	'Resolver is not running');
check('resolver not listening on DoT is an error', fmt.describeState(status({ dnsdist: { running: true, dot_listening: false, version: null } }), '853').text,
	'Resolver is not listening on DoT port');
check('closed firewall names the port', fmt.describeState(status({ firewall_open: false }), '8853').text, 'WAN port 8853 is closed');

console.log('-> certificate text');
check('no certificate', fmt.describeCert({ present: false }), 'No certificate');
check('days left', fmt.describeCert({ present: true, days_left: 88, staging: false }), '88 days left');
check('one day is singular', fmt.describeCert({ present: true, days_left: 1, staging: false }), '1 day left');
check('expired', fmt.describeCert({ present: true, days_left: 0, staging: false }), 'Expired');
check('staging is tagged', fmt.describeCert({ present: true, days_left: 80, staging: true }), '80 days left (staging)');

console.log('-> query counts');
check('integer query count is shown', fmt.formatQueries(1234), (1234).toLocaleString());
check('zero query count is shown', fmt.formatQueries(0), '0');
check('large query count is grouped', fmt.formatQueries(1234567), (1234567).toLocaleString());
check('null query count is an en dash', fmt.formatQueries(null), '–');
check('undefined query count is an en dash', fmt.formatQueries(undefined), '–');
check('negative query count is an en dash', fmt.formatQueries(-1), '–');
check('NaN query count is an en dash', fmt.formatQueries(NaN), '–');
check('fractional query count is an en dash', fmt.formatQueries(1.5), '–');
check('query count note explains restarts', /restarts?/.test(fmt.queryCountDescription()), true);

console.log('-> hostnames and profile commands');
check('dot hostname', fmt.dotHostname('kid1', 'example.duckdns.org'), 'kid1.example.duckdns.org');
check('no dot hostname without client id', fmt.dotHostname('', 'example.duckdns.org'), '');
check('no dot hostname without domain', fmt.dotHostname('kid1', ''), '');
check('mobileconfig filename', fmt.mobileconfigFilename('kid1'), 'kid1.mobileconfig');
check('profile command', fmt.profileArgs('kid1'), ['profile', 'kid1']);

console.log('-> setup gating and polling');
check('pending changes are detected', fmt.hasPendingChanges({ familydns: [ [ 'set' ] ] }), true);
check('no pending changes', fmt.hasPendingChanges({ network: [ [ 'set' ] ] }), false);
check('no changes object', fmt.hasPendingChanges(null), false);
check('setup allowed when saved and idle', fmt.canBootstrap(status(), false), true);
check('setup blocked with unsaved changes', fmt.canBootstrap(status(), true), false);
check('setup blocked while running', fmt.canBootstrap(withProgress({ running: true, state: 'running' }), false), false);
check('running polls every tick', fmt.shouldFetch(true, 0), true);
check('idle waits 30 seconds', fmt.shouldFetch(false, 10000), false);
check('idle fetches after 30 seconds', fmt.shouldFetch(false, 30000), true);
check('isRunning on null', fmt.isRunning(null), false);

console.log('-> network default (lan)');
check('lan off when disabled', fmt.describeLan({ enabled: false, active: false, profile: 'adult' }),
	{ kind: 'off', text: 'Off' });
check('lan off when missing', fmt.describeLan(undefined), { kind: 'off', text: 'Off' });
check('lan active', fmt.describeLan({ enabled: true, active: true, profile: 'adult' }),
	{ kind: 'ready', text: 'Active' });
check('lan enabled but inactive falls back to router DNS', fmt.describeLan({ enabled: true, active: false, profile: 'adult' }),
	{ kind: 'warning', text: 'Waiting for the resolver - using router DNS' });
check('lan description names devices',
	fmt.lanDnsDescription(),
	'Every device on this network, including ones with hardcoded DNS servers, is sent through Family DNS.');

console.log('-> stage order and labels');
check('stage order lists lan last', fmt.STAGE_ORDER, [ 'ddns', 'cert', 'dnsdist', 'firewall', 'lan' ]);
check('lan stage label', fmt.describeState(withProgress({ running: true, state: 'running',
	stages: [ { name: 'lan', state: 'running', message: '' } ] }), '853').text, 'Setting up... Network DNS');
check('stages are ordered regardless of input order', fmt.orderStages([
	{ name: 'lan' }, { name: 'dnsdist' }, { name: 'ddns' }, { name: 'cert' }, { name: 'firewall' }
]).map(function(s) { return s.name; }), [ 'ddns', 'cert', 'dnsdist', 'firewall', 'lan' ]);
check('unknown stage sorts last', fmt.orderStages([ { name: 'zzz' }, { name: 'ddns' } ]).map(function(s) { return s.name; }),
	[ 'ddns', 'zzz' ]);
check('describeState orders stages', fmt.describeState(withProgress({ running: true, state: 'running',
	stages: [ { name: 'lan', state: 'pending', message: '' }, { name: 'ddns', state: 'running', message: '' } ] }), '853').stages
	.map(function(s) { return s.name; }), [ 'ddns', 'lan' ]);
check('lan stage message is shown as label', fmt.describeState(withProgress({ state: 'error',
	stages: [ { name: 'lan', state: 'error', message: 'redirect failed' } ] }), '853').text,
	'Setup failed at Network DNS: redirect failed');

console.log('-> profile upstream summaries');
check('provider host and DoH filter name', fmt.upstreamName('https://doh.cleanbrowsing.org/doh/family-filter/'),
	'doh.cleanbrowsing.org (family-filter)');
check('generic DoH path shows only the host', fmt.upstreamName('https://dns10.quad9.net/dns-query'), 'dns10.quad9.net');
check('https port is dropped from the label', fmt.upstreamName('https://dns.example.com:8443/dns-query'), 'dns.example.com');
check('tls upstream shows its host', fmt.upstreamName('tls://one.one.one.one:853'), 'one.one.one.one');
check('IPv4 upstream shows the address', fmt.upstreamName('1.1.1.1:53'), '1.1.1.1');
check('summary of one upstream', fmt.upstreamSummary([ 'https://dns10.quad9.net/dns-query' ]), 'dns10.quad9.net');
check('summary counts the rest', fmt.upstreamSummary([ 'https://doh.cleanbrowsing.org/doh/family-filter/', 'tls://one.one.one.one', '1.1.1.1' ]),
	'doh.cleanbrowsing.org (family-filter) +2 more');
check('summary of a single string value', fmt.upstreamSummary('tls://one.one.one.one'), 'one.one.one.one');
check('summary ignores blank entries', fmt.upstreamSummary([ '', '  ', '1.1.1.1' ]), '1.1.1.1');
check('summary with no upstreams', fmt.upstreamSummary(undefined), 'None set');

console.log('-> provider guidance');
check('provider list link is the AdGuard DNS providers page', fmt.PROVIDER_LIST_URL,
	'https://adguard-dns.io/kb/general/dns-providers/');
check('hint says quic and sdns are not supported', /quic:\/\/ and sdns:\/\/ entries are not supported/.test(fmt.upstreamHint()), true);
check('error says quic and sdns are not supported', /quic:\/\/ and sdns:\/\/ entries are not supported/.test(fmt.upstreamError()), true);
check('error names the accepted forms', /https:\/\/host\/path, tls:\/\/host or an IPv4 address/.test(fmt.upstreamError()), true);

console.log('-> LAN addresses');
check('plain IPv4 is valid', fmt.validLanIp('192.168.1.50'), true);
check('IPv4 with /32 is valid', fmt.validLanIp('192.168.1.50/32'), true);
check('IPv4 with /0 is valid', fmt.validLanIp('0.0.0.0/0'), true);
check('IPv4 with /24 is valid', fmt.validLanIp('10.0.0.0/24'), true);
check('prefix 33 is invalid', fmt.validLanIp('10.0.0.1/33'), false);
check('prefix with no digits is invalid', fmt.validLanIp('10.0.0.1/'), false);
check('octet 256 is invalid', fmt.validLanIp('192.168.1.256'), false);
check('three octets is invalid', fmt.validLanIp('192.168.1'), false);
check('five octets is invalid', fmt.validLanIp('1.2.3.4.5'), false);
check('leading zero octet is invalid', fmt.validLanIp('192.168.01.5'), false);
check('letters are invalid', fmt.validLanIp('lan.local'), false);
check('IPv6 is invalid', fmt.validLanIp('fd00::1'), false);
check('empty is invalid (caller skips optional)', fmt.validLanIp(''), false);

console.log('-> upstream servers');
check('https upstream is valid', fmt.validUpstream('https://dns10.quad9.net/dns-query'), true);
check('https upstream with port is valid', fmt.validUpstream('https://dns.example.com:8443/dns-query'), true);
check('tls upstream is valid', fmt.validUpstream('tls://one.one.one.one'), true);
check('tls upstream with port is valid', fmt.validUpstream('tls://one.one.one.one:853'), true);
check('plain IPv4 upstream is valid', fmt.validUpstream('192.168.1.1'), true);
check('plain IPv4 upstream with port is valid', fmt.validUpstream('1.1.1.1:53'), true);
check('upstream with space is invalid', fmt.validUpstream('https://a.example/dns query'), false);
check('empty upstream is invalid', fmt.validUpstream(''), false);
check('upstream with tab is invalid', fmt.validUpstream('tls://a\tb'), false);
check('https upstream without path is invalid', fmt.validUpstream('https://dns.example.com'), false);
check('tls upstream with path is invalid', fmt.validUpstream('tls://dns.example.com/dns-query'), false);
check('bare hostname is invalid', fmt.validUpstream('dns.example.com'), false);
check('http upstream is invalid', fmt.validUpstream('http://dns.example.com/dns-query'), false);
check('quic upstream is invalid', fmt.validUpstream('quic://dns.example.net'), false);
check('quic upstream from the provider list is invalid', fmt.validUpstream('quic://dns.adguard-dns.com'), false);
check('sdns stamp from the provider list is invalid', fmt.validUpstream('sdns://AQMAAAAAAAAAAAAOZG5zLmFkZ3VhcmQuY29t'), false);
check('IPv4 octet 256 is invalid', fmt.validUpstream('256.1.1.1'), false);
check('upstream port 0 is invalid', fmt.validUpstream('tls://dns.example.com:0'), false);
check('upstream port 65536 is invalid', fmt.validUpstream('1.1.1.1:65536'), false);

console.log('-> validators accept empty input');
const viewSource = fs.readFileSync(path.join(__dirname, '..',
	'htdocs/luci-static/resources/view/familydns/overview.js'), 'utf8');
const validators = viewSource.split(/\.validate = function/).slice(1);
check('the view defines validators', validators.length > 0, true);
validators.forEach(function(block, i) {
	const body = block.slice(0, 600);
	check('validator #' + (i + 1) + ' accepts blank input', /checkOptional\(|!value|!fmt\.|=== ''/.test(body), true);
});
check('clipboard use has an insecure-context fallback', !/navigator\.clipboard/.test(viewSource) || /execCommand/.test(viewSource), true);
check('no option is marked required (blank rows and defaults must save)', /\.required = true/.test(viewSource), false);

console.log('-> view wiring');
check('provider links open in a new tab without opener access',
	/'target': '_blank', 'rel': 'noopener noreferrer'/.test(viewSource), true);
check('provider link uses the named constant', /fmt\.PROVIDER_LIST_URL/.test(viewSource), true);
check('help text is not built as HTML (client id placeholder is plain text)',
	!/<client-id>|<domain>/.test(viewSource), true);
check('the settings upstream option is gone (the engine ignores it)',
	!/Leave empty to keep the current upstreams/.test(viewSource), true);

console.log('-> validator helpers');
check('checkOptional accepts an empty string', fmt.checkOptional('', function() { return false; }, 'bad'), true);
check('checkOptional accepts whitespace only', fmt.checkOptional('  ', function() { return false; }, 'bad'), true);
check('checkOptional accepts an empty list', fmt.checkOptional([], function() { return false; }, 'bad'), true);
check('checkOptional accepts null', fmt.checkOptional(null, function() { return false; }, 'bad'), true);
check('checkOptional rejects a bad value', fmt.checkOptional('a b', fmt.validUpstream, 'bad'), 'bad');
check('checkOptional accepts a good value', fmt.checkOptional('tls://one.one.one.one', fmt.validUpstream, 'bad'), true);

console.log('==========================================');
console.log(' UI results: ' + passed + ' passed');
