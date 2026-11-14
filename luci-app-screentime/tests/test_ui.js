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
	'htdocs/luci-static/resources/screentime/format.js'), 'utf8');
const fmt = new Function('baseclass', '_', src)({ extend: function(o) { return o; } }, function(s) { return s; });

let passed = 0;
function check(desc, actual, expected) {
	assert.deepStrictEqual(actual, expected, desc);
	console.log('  ✓ ' + desc);
	passed++;
}

console.log('-> time conversion');
check('midnight is 12 AM', fmt.parse24to12('00:00:00'), { h: 12, m: 0, ampm: 'AM' });
check('noon is 12 PM', fmt.parse24to12('12:00:00'), { h: 12, m: 0, ampm: 'PM' });
check('18:30 is 6:30 PM', fmt.parse24to12('18:30:00'), { h: 6, m: 30, ampm: 'PM' });
check('12 AM converts to 00', fmt.parse12to24('12', '0', 'AM'), '00:00:00');
check('12 PM converts to 12', fmt.parse12to24('12', '15', 'PM'), '12:15:00');
check('6:05 PM converts to 18:05', fmt.parse12to24('6', '5', 'PM'), '18:05:00');
for (const t of ['00:00:00', '07:25:00', '12:00:00', '23:55:00']) {
	const p = fmt.parse24to12(t);
	check('round trip ' + t, fmt.parse12to24(p.h, p.m, p.ampm), t);
}

console.log('-> windows');
check('plain window', fmt.formatWindow('18:00:00', 90), '6:00 PM – 7:30 PM');
check('window crossing midnight is marked', fmt.formatWindow('23:00:00', 120), '11:00 PM – 1:00 AM (+1 day)');
check('window ending exactly at midnight is marked', fmt.formatWindow('22:00:00', 120), '10:00 PM – 12:00 AM (+1 day)');
check('duration labels', [fmt.formatDuration(15), fmt.formatDuration(60), fmt.formatDuration(150)], ['15m', '1h', '2h 30m']);

console.log('-> days');
check('all is Daily', fmt.formatDays('all'), 'Daily');
check('seven days is Daily', fmt.formatDays('mon tue wed thu fri sat sun'), 'Daily');
check('weekdays', fmt.formatDays('mon tue wed thu fri'), 'Weekdays');
check('weekends from list', fmt.formatDays(['sun', 'sat']), 'Weekends');
check('arbitrary days are ordered', fmt.formatDays('sat fri'), 'Fri, Sat');
check('legacy list form with all', fmt.normalizeDays(['all']).length, 7);

console.log('-> schedule rows');
const NOW = Date.UTC(2026, 9, 31, 16, 14, 58) / 1000; // Sat 10:14 in UTC-6
const OFFSET = -6 * 3600;
const OPENS = NOW + 7 * 3600 + 45 * 60 + 2;
const base = { now: NOW, enabled: 1, schedules: [], devices: [] };
const sched = function(fields) {
	return Object.assign({ id: 'sched_1', name: '', open: false, override: 'none', change_at: OPENS }, fields);
};
check('downtime offers to ignore it', fmt.describeSchedule(sched({}), base, OFFSET), {
	kind: 'blocked', text: 'Downtime until 6:00 PM',
	action: { label: 'Ignore Downtime', command: 'ignore-downtime', style: 'cbi-button-positive' }
});
check('open window offers to turn on downtime', fmt.describeSchedule(sched({ open: true, change_at: NOW + 3600 }), base, OFFSET), {
	kind: 'allowed', text: 'Open until 11:14 AM',
	action: { label: 'Turn On Downtime', command: 'turn-on-downtime', style: 'cbi-button-negative' }
});
check('ignored downtime is amber and offers to resume', fmt.describeSchedule(sched({ open: true, override: 'ignore' }), base, OFFSET), {
	kind: 'override', text: 'Open until 6:00 PM (override)',
	action: { label: 'Resume Schedule', command: 'clear-override', style: 'cbi-button-action' }
});
check('forced downtime offers to resume', fmt.describeSchedule(sched({ override: 'forced' }), base, OFFSET).action.command, 'clear-override');
check('schedule that never changes has no end time', fmt.describeSchedule(sched({ open: true, change_at: null }), base, OFFSET).text, 'Open');
check('change on another day names the weekday', fmt.formatChange(OPENS + 24 * 3600, NOW, OFFSET), 'Sun 6:00 PM');

console.log('-> device rows');
check('unknown device', fmt.describeDevice(undefined, base, OFFSET), { allowed: null, text: '–' });
check('allowed with end time', fmt.describeDevice({ allowed: true, reason: 'schedule', change_at: NOW + 3600 }, base, OFFSET),
	{ allowed: true, text: 'Allowed until 11:14 AM' });
check('override is annotated', fmt.describeDevice({ allowed: false, reason: 'override', change_at: NOW + 3600 }, base, OFFSET).text,
	'Blocked until 11:14 AM (override)');
check('no change scheduled', fmt.describeDevice({ allowed: false, reason: 'schedule', change_at: null }, base, OFFSET),
	{ allowed: false, text: 'Blocked' });


console.log('-> validators accept empty input');
const viewSource = fs.readFileSync(path.join(__dirname, '..',
	'htdocs/luci-static/resources/view/screentime/overview.js'), 'utf8');
const validators = viewSource.split(/\.validate = function/).slice(1);
check('the view defines validators', validators.length > 0, true);
validators.forEach(function(block, i) {
	check('validator #' + (i + 1) + ' accepts blank input', /!value|=== ''/.test(block.slice(0, 400)), true);
});
check('no option is marked required (blank rows and defaults must save)', /\.required = true/.test(viewSource), false);

console.log('==========================================');
console.log(' UI results: ' + passed + ' passed');
