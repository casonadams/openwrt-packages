'use strict';
'require baseclass';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

function pad2(n) {
	return (n < 10 ? '0' : '') + n;
}

function clock12(totalMinutes) {
	const h = Math.floor(totalMinutes / 60) % 24;
	const h12 = h % 12 === 0 ? 12 : h % 12;
	return h12 + ':' + pad2(totalMinutes % 60) + ' ' + (h >= 12 ? 'PM' : 'AM');
}

function toMinutes(timeStr) {
	const parts = String(timeStr || '18:00:00').split(':');
	const h = parseInt(parts[0], 10);
	const m = parseInt(parts[1], 10);
	return (isNaN(h) ? 18 : h) * 60 + (isNaN(m) ? 0 : m);
}

return baseclass.extend({
	DAY_KEYS: DAY_KEYS,

	parse24to12: function(timeStr) {
		const total = toMinutes(timeStr);
		const h = Math.floor(total / 60) % 24;
		return { h: h % 12 === 0 ? 12 : h % 12, m: total % 60, ampm: h >= 12 ? 'PM' : 'AM' };
	},

	parse12to24: function(h12, m, ampm) {
		let h = parseInt(h12, 10);
		if (isNaN(h)) h = 12;
		const min = parseInt(m, 10);
		if (ampm === 'PM' && h < 12) h += 12;
		else if (ampm === 'AM' && h === 12) h = 0;
		return pad2(h) + ':' + pad2(isNaN(min) ? 0 : min) + ':00';
	},

	formatDuration: function(mins) {
		const total = parseInt(mins, 10) || 0;
		const h = Math.floor(total / 60);
		const m = total % 60;
		if (h > 0 && m > 0) return h + 'h ' + m + 'm';
		return h > 0 ? h + 'h' : m + 'm';
	},

	// "6:00 PM – 7:30 PM", with a "(+1 day)" marker when the window crosses midnight
	formatWindow: function(start24, durationMins) {
		const start = toMinutes(start24);
		const end = start + (parseInt(durationMins, 10) || 90);
		return clock12(start) + ' – ' + clock12(end) + (end >= 1440 ? ' ' + _('(+1 day)') : '');
	},

	normalizeDays: function(raw) {
		let days = Array.isArray(raw) ? raw : String(raw || '').split(/[,\s]+/);
		days = days.map(function(d) { return String(d).toLowerCase(); }).filter(Boolean);
		if (days.length === 0 || days.indexOf('all') >= 0) return DAY_KEYS.slice();
		return DAY_KEYS.filter(function(d) { return days.indexOf(d) >= 0; });
	},

	formatDays: function(raw) {
		const days = this.normalizeDays(raw);
		const key = days.join(' ');
		if (days.length === 7) return _('Daily');
		if (key === 'mon tue wed thu fri') return _('Weekdays');
		if (key === 'sat sun') return _('Weekends');
		return days.map(function(d) { return DAY_LABELS[d]; }).join(', ');
	},

	// Epoch seconds -> "6:00 PM" (plus weekday when not today), in router local time.
	// localOffset = router local seconds - UTC epoch seconds.
	formatChange: function(epoch, now, localOffset) {
		const at = new Date((epoch + localOffset) * 1000);
		const today = new Date((now + localOffset) * 1000);
		const sameDay = at.getUTCFullYear() === today.getUTCFullYear() &&
			at.getUTCMonth() === today.getUTCMonth() && at.getUTCDate() === today.getUTCDate();
		const time = clock12(at.getUTCHours() * 60 + at.getUTCMinutes());
		return sameDay ? time : DAY_LABELS[DAY_KEYS[(at.getUTCDay() + 6) % 7]] + ' ' + time;
	},

	// Row model for one `status --json` schedule: status text and the one action that applies.
	describeSchedule: function(schedule, state, localOffset) {
		const overridden = schedule.override !== 'none';
		let text = schedule.open ? _('Open') : _('Downtime');
		if (schedule.change_at != null)
			text = _('%s until %s').format(text, this.formatChange(schedule.change_at, state.now, localOffset));
		if (overridden)
			text += ' ' + _('(override)');

		let action;
		if (overridden)
			action = { label: _('Resume Schedule'), command: 'clear-override', style: 'cbi-button-action' };
		else if (schedule.open)
			action = { label: _('Turn On Downtime'), command: 'turn-on-downtime', style: 'cbi-button-negative' };
		else
			action = { label: _('Ignore Downtime'), command: 'ignore-downtime', style: 'cbi-button-positive' };

		return { kind: overridden ? 'override' : (schedule.open ? 'allowed' : 'blocked'), text: text, action: action };
	},

	// Per-device row text: "Allowed until 8:30 PM" / "Blocked until Sat 6:00 PM (override)"
	describeDevice: function(device, state, localOffset) {
		if (!device) return { allowed: null, text: '–' };
		const verb = device.allowed ? _('Allowed') : _('Blocked');
		if (device.change_at == null) return { allowed: device.allowed, text: verb };
		const text = _('%s until %s').format(verb, this.formatChange(device.change_at, state.now, localOffset));
		return { allowed: device.allowed, text: device.reason === 'override' ? text + ' ' + _('(override)') : text };
	}
});
