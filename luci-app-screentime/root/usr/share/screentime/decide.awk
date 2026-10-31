# Screen Time decision function: the single source of truth for "is this device allowed now?".
#
# stdin : `uci show screentime`
# vars  : fmt=lines|json  dow=mon..sun  sec=seconds since local midnight
#         epoch=now (unix)  ovr=none|ignore|forced  left=override seconds remaining
#
# lines output:
#   G|<enabled>|<in_window>|<secs to next global window change or -1>
#   D|<mac>|<allowed 0/1>|<reason>|<secs to next change or -1>|<name>
#
# A window belongs to its start day; windows crossing midnight spill into the next day.

function tomin(t,   p, h, m, pm, am) {
	t = tolower(t)
	gsub(/ /, "", t)
	pm = (t ~ /pm$/)
	am = (t ~ /am$/)
	sub(/[ap]m$/, "", t)
	split(t, p, ":")
	h = p[1] + 0
	m = p[2] + 0
	if (pm && h < 12) h += 12
	if (am && h == 12) h = 0
	return h * 60 + m
}

function has_token(list, want,   a, n, i) {
	n = split(tolower(list), a, " ")
	for (i = 1; i <= n; i++)
		if (a[i] == want) return 1
	return 0
}

function sched_hit(s, d, m) {
	if (DOK[s, d] && m >= START[s] && m < START[s] + DUR[s]) return 1
	return DOK[s, (d + 6) % 7] && m + 1440 < START[s] + DUR[s]
}

# mac == "" asks "is any window open", otherwise "is mac covered by an open window"
function open_at(mac, t,   abs, d, m, i, s) {
	abs = nowmin + t
	d = (nowday + int(abs / 1440)) % 7
	m = abs % 1440
	for (i = 1; i <= ns; i++) {
		s = SCHED[i]
		if (sched_hit(s, d, m) && (mac == "" || ALLDEV[s] || (s, mac) in DEVSET)) return 1
	}
	return 0
}

# The open/closed state only changes at a window start or end, so test just those minutes
# over the next 8 days instead of every minute.
function secs_to_change(mac,   cur, i, k, d, c, t, best) {
	cur = open_at(mac, 0)
	best = -1
	for (i = 1; i <= ns; i++)
		for (k = 0; k < 2; k++) {
			c = (START[SCHED[i]] + k * DUR[SCHED[i]]) % 1440
			for (d = 0; d <= 8; d++) {
				t = d * 1440 + c - nowmin
				if (t >= 1 && (best < 0 || t < best) && open_at(mac, t) != cur) best = t
			}
		}
	return best < 0 ? -1 : best * 60 - sec % 60
}

function jesc(s,   out, i, c) {
	for (i = 1; i <= length(s); i++) {
		c = substr(s, i, 1)
		out = out ((c == "\"" || c == "\\") ? "\\" c : c)
	}
	return out
}

function jtime(secs) {
	return secs < 0 ? "null" : epoch + secs
}

BEGIN {
	split("mon tue wed thu fri sat sun", names, " ")
	for (i = 1; i <= 7; i++) { DAY[i - 1] = names[i]; DAYIDX[names[i]] = i - 1 }
	nowday = DAYIDX[dow]
	nowmin = int(sec / 60)
}

{
	eq = index($0, "=")
	key = substr($0, 1, eq - 1)
	val = substr($0, eq + 1)
	gsub(/\047/, "", val)
	n = split(key, k, ".")
	if (n == 2) {
		if (val == "schedule") ALL[++na] = k[2]
		else if (val == "device") DEV[++nd] = k[2]
	} else {
		opt[k[2], k[3]] = val
	}
}

END {
	for (i = 1; i <= na; i++) {
		s = ALL[i]
		if (opt[s, "enabled"] == "0") continue
		SCHED[++ns] = s
		START[s] = tomin(opt[s, "start_time"] == "" ? "18:00" : opt[s, "start_time"])
		DUR[s] = (opt[s, "duration"] == "" ? 90 : opt[s, "duration"]) + 0
		days = opt[s, "weekdays"]
		for (d = 0; d < 7; d++) DOK[s, d] = (days == "" || has_token(days, "all") || has_token(days, DAY[d]))
		tg = opt[s, "devices"]
		ALLDEV[s] = (tg == "" || has_token(tg, "all"))
		nt = split(tolower(tg), tl, " ")
		for (j = 1; j <= nt; j++) DEVSET[s, tl[j]] = 1
	}

	enabled = (opt["settings", "enabled"] != "0")
	in_win = open_at("", 0)
	g_next = secs_to_change("")

	nout = 0
	for (i = 1; i <= nd; i++) {
		d = DEV[i]
		mac = tolower(opt[d, "mac"])
		if (opt[d, "enabled"] == "0" || mac !~ /^([0-9a-f][0-9a-f]:){5}[0-9a-f][0-9a-f]$/) continue
		if (!enabled)           { allowed = 1; reason = "disabled"; chg = -1 }
		else if (ovr == "ignore") { allowed = 1; reason = "override"; chg = left }
		else if (ovr == "forced") { allowed = 0; reason = "override"; chg = left }
		else { allowed = open_at(mac, 0); reason = "schedule"; chg = secs_to_change(mac) }
		nout++
		OMAC[nout] = mac; OALLOW[nout] = allowed; OREASON[nout] = reason
		OCHG[nout] = chg; ONAME[nout] = opt[d, "name"]
	}

	if (fmt == "json") {
		printf "{\"now\":%d,\"enabled\":%d,\"in_window\":%d,", epoch, enabled, in_win
		printf "\"override\":{\"mode\":\"%s\",\"seconds_left\":%d},", ovr, left
		printf "\"next_window_change_at\":%s,\"devices\":[", jtime(g_next)
		for (i = 1; i <= nout; i++)
			printf "%s{\"mac\":\"%s\",\"name\":\"%s\",\"allowed\":%s,\"reason\":\"%s\",\"change_at\":%s}", \
				(i > 1 ? "," : ""), OMAC[i], jesc(ONAME[i]), (OALLOW[i] ? "true" : "false"), OREASON[i], jtime(OCHG[i])
		print "]}"
	} else {
		printf "G|%d|%d|%d\n", enabled, in_win, g_next
		for (i = 1; i <= nout; i++)
			printf "D|%s|%d|%s|%d|%s\n", OMAC[i], OALLOW[i], OREASON[i], OCHG[i], ONAME[i]
	}
}
