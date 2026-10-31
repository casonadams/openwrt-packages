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
		agh: { running: true, version: '0.107.79', dot_listening: true, admin_url: 'http://192.168.1.1:3001' },
		firewall_open: true,
		progress: { running: false, state: 'idle', message: '', stages: [] },
		devices: []
	};
	return Object.assign(base, overrides || {});
}

function withProgress(progress) {
	return status({ progress: Object.assign({ running: false, state: 'idle', message: '', stages: [] }, progress) });
}

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
check('duplicate id is detected', fmt.isDuplicate('kid1', ['adult', 'kid1']), true);
check('unique id is accepted', fmt.isDuplicate('kid2', ['adult', 'kid1']), false);
check('no others means unique', fmt.isDuplicate('kid1', []), false);

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
	stages: [ { name: 'agh', state: 'pending', message: '' } ] }), '853').stages,
	[ { name: 'agh', label: 'AdGuard Home', state: 'pending', message: '' } ]);
check('stage error names the stage and message', fmt.describeState(withProgress({ state: 'error', message: 'boom',
	stages: [ { name: 'cert', state: 'error', message: 'rate limited' } ] }), '853').text,
	'Setup failed at Certificate: rate limited');
check('progress error without stage detail', fmt.describeState(withProgress({ state: 'error', message: 'lock held' }), '853').text,
	'Setup failed: lock held');
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
check('agh not running is an error', fmt.describeState(status({ agh: { running: false, dot_listening: false, version: null, admin_url: '' } }), '853').text,
	'AdGuard Home is not running');
check('agh not listening on DoT is an error', fmt.describeState(status({ agh: { running: true, dot_listening: false, version: null, admin_url: '' } }), '853').text,
	'AdGuard Home is not listening for DoT');
check('closed firewall names the port', fmt.describeState(status({ firewall_open: false }), '8853').text, 'WAN port 8853 is closed');

console.log('-> certificate text');
check('no certificate', fmt.describeCert({ present: false }), 'No certificate');
check('days left', fmt.describeCert({ present: true, days_left: 88, staging: false }), '88 days left');
check('one day is singular', fmt.describeCert({ present: true, days_left: 1, staging: false }), '1 day left');
check('expired', fmt.describeCert({ present: true, days_left: 0, staging: false }), 'Expired');
check('staging is tagged', fmt.describeCert({ present: true, days_left: 80, staging: true }), '80 days left (staging)');

console.log('-> device rows');
check('device not in status yet', fmt.describeDevice(undefined), { active: false, text: 'Not applied yet' });
check('device active in AdGuard Home', fmt.describeDevice({ client_id: 'kid1', in_agh: true }),
	{ active: true, text: 'Active in AdGuard Home' });
check('device waiting for sync', fmt.describeDevice({ client_id: 'kid1', in_agh: false }),
	{ active: false, text: 'Waiting for sync to AdGuard Home' });

console.log('-> hostnames and profile commands');
check('dot hostname', fmt.dotHostname('kid1', 'example.duckdns.org'), 'kid1.example.duckdns.org');
check('no dot hostname without client id', fmt.dotHostname('', 'example.duckdns.org'), '');
check('no dot hostname without domain', fmt.dotHostname('kid1', ''), '');
check('mobileconfig filename', fmt.mobileconfigFilename('kid1'), 'kid1.mobileconfig');
check('plain profile command', fmt.profileArgs('kid1', false), ['profile', 'kid1']);
check('locked profile command', fmt.profileArgs('kid1', true), ['profile', 'kid1', '--lock']);

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

console.log('-> blocked services');
check('known service label', fmt.serviceLabel('tiktok'), 'TikTok');
check('unknown service keeps its id', fmt.serviceLabel('mastodon'), 'mastodon');
check('prototype key is not a service label', fmt.serviceLabel('constructor'), 'constructor');
check('built-in list has 14 services', fmt.serviceOptions([]).length, 14);
check('stored unknown service is kept', fmt.serviceOptions([ 'mastodon', 'tiktok', 'mastodon' ]).slice(-1),
	[ { id: 'mastodon', label: 'mastodon' } ]);

console.log('-> network DNS (lan)');
check('lan off when disabled', fmt.describeLan({ enabled: false, active: false, profile: 'adult', retired: [] }),
	{ kind: 'off', text: 'Network DNS: off' });
check('lan off when missing', fmt.describeLan(undefined), { kind: 'off', text: 'Network DNS: off' });
check('lan active', fmt.describeLan({ enabled: true, active: true, profile: 'adult', retired: [] }),
	{ kind: 'ready', text: 'Network DNS: via AdGuard Home' });
check('lan enabled but inactive falls back to router DNS', fmt.describeLan({ enabled: true, active: false, profile: 'adult', retired: [] }),
	{ kind: 'warning', text: 'Network DNS: waiting for AdGuard Home - using router DNS' });
check('two retired services are named', fmt.retiredNote({ enabled: true, active: true, retired: [ 'adblock', 'https-dns-proxy' ] }),
	'adblock and https-dns-proxy are paused while this is on');
check('one retired service is singular', fmt.retiredNote({ enabled: true, active: true, retired: [ 'adblock' ] }),
	'adblock is paused while this is on');
check('three retired services use commas', fmt.retiredNote({ enabled: true, active: true, retired: [ 'a', 'b', 'c' ] }),
	'a, b and c are paused while this is on');
check('no retired note while lan is off', fmt.retiredNote({ enabled: false, active: false, retired: [ 'adblock' ] }), '');
check('no retired note without services', fmt.retiredNote({ enabled: true, active: true, retired: [] }), '');
check('lan description names devices and paused services',
	fmt.lanDnsDescription(),
	'All LAN DNS, including devices with hardcoded DNS servers, is redirected to AdGuard Home. adblock and https-dns-proxy are paused while this is on.');

console.log('-> stage order and labels');
check('stage order lists lan last', fmt.STAGE_ORDER, [ 'ddns', 'cert', 'agh', 'firewall', 'clients', 'lan' ]);
check('lan stage label', fmt.describeState(withProgress({ running: true, state: 'running',
	stages: [ { name: 'lan', state: 'running', message: '' } ] }), '853').text, 'Setting up... Network DNS');
check('stages are ordered regardless of input order', fmt.orderStages([
	{ name: 'lan' }, { name: 'agh' }, { name: 'ddns' }, { name: 'clients' }, { name: 'cert' }, { name: 'firewall' }
]).map(function(s) { return s.name; }), [ 'ddns', 'cert', 'agh', 'firewall', 'clients', 'lan' ]);
check('unknown stage sorts last', fmt.orderStages([ { name: 'zzz' }, { name: 'ddns' } ]).map(function(s) { return s.name; }),
	[ 'ddns', 'zzz' ]);
check('describeState orders stages', fmt.describeState(withProgress({ running: true, state: 'running',
	stages: [ { name: 'lan', state: 'pending', message: '' }, { name: 'ddns', state: 'running', message: '' } ] }), '853').stages
	.map(function(s) { return s.name; }), [ 'ddns', 'lan' ]);
check('lan stage message is shown as label', fmt.describeState(withProgress({ state: 'error',
	stages: [ { name: 'lan', state: 'error', message: 'redirect failed' } ] }), '853').text,
	'Setup failed at Network DNS: redirect failed');

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
check('tls upstream is valid', fmt.validUpstream('tls://one.one.one.one'), true);
check('upstream with space is invalid', fmt.validUpstream('https://a.example/dns query'), false);
check('empty upstream is invalid', fmt.validUpstream(''), false);
check('upstream with tab is invalid', fmt.validUpstream('tls://a\tb'), false);

console.log('-> admin credentials');
check('admin JSON parses',
	fmt.parseAdminJson('{"url":"http://192.168.1.1:3001","username":"admin","password":"s3cret"}'),
	{ url: 'http://192.168.1.1:3001', username: 'admin', password: 's3cret' });
check('admin JSON ignores extra fields',
	fmt.parseAdminJson('{"url":"http://192.168.1.1:3001","username":"admin","password":"p","x":1}').username, 'admin');
check('admin JSON rejects garbage', fmt.parseAdminJson('not json'), null);
check('admin JSON rejects null', fmt.parseAdminJson('null'), null);
check('admin JSON rejects missing password', fmt.parseAdminJson('{"url":"http://a:3001","username":"admin"}'), null);
check('admin JSON rejects empty password', fmt.parseAdminJson('{"url":"http://a:3001","username":"admin","password":""}'), null);
check('admin JSON rejects non-string username', fmt.parseAdminJson('{"url":"http://a:3001","username":1,"password":"p"}'), null);


console.log('-> validators accept empty input');
const viewSource = fs.readFileSync(path.join(__dirname, '..',
	'htdocs/luci-static/resources/view/familydns/overview.js'), 'utf8');
const validators = viewSource.split(/\.validate = function/).slice(1);
check('the view defines validators', validators.length > 0, true);
validators.forEach(function(block, i) {
	const body = block.slice(0, 600);
	check('validator #' + (i + 1) + ' accepts blank input', /checkOptional\(|!value|!fmt\.|=== ''/.test(body), true);
});
check('no option is marked required (blank rows and defaults must save)', /\.required = true/.test(viewSource), false);

check('checkOptional accepts an empty string', fmt.checkOptional('', function() { return false; }, 'bad'), true);
check('checkOptional accepts whitespace only', fmt.checkOptional('  ', function() { return false; }, 'bad'), true);
check('checkOptional accepts an empty list', fmt.checkOptional([], function() { return false; }, 'bad'), true);
check('checkOptional accepts null', fmt.checkOptional(null, function() { return false; }, 'bad'), true);
check('checkOptional rejects a bad value', fmt.checkOptional('a b', fmt.validUpstream, 'bad'), 'bad');
check('checkOptional accepts a good value', fmt.checkOptional('tls://one.one.one.one', fmt.validUpstream, 'bad'), true);

console.log('==========================================');
console.log(' UI results: ' + passed + ' passed');
