# Screen Time decision function: the single source of truth for "is this device allowed now?".
#
# stdin : `uci show screentime`
# vars  : fmt=lines|json  dow=mon..sun  sec=seconds since local midnight
#         epoch=now (unix)  ovrfile=override file, lines of "<schedule> <ignore|forced> <until epoch>"
#
# lines output:
#   G|<enabled>
#   S|<schedule>|<open 0/1>|<override none|ignore|forced>|<secs to next change or -1>|<secs to next scheduled change or -1>|<name>
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

function sched_at(s, t,   abs) {
	abs = nowmin + t
	return sched_hit(s, (nowday + int(abs / 1440)) % 7, abs % 1440)
}

# An override replaces its schedule's state until it expires.
function sched_open(s, t) {
	if ((s in OVR) && t * 60 < OVRLEFT[s]) return OVR[s] == "ignore"
	return sched_at(s, t)
}

# kind: "sched"/"raw" = schedule key with/without its override,
#       "dev"/"devraw" = is mac key covered by an open schedule, with/without overrides
function state_at(kind, key, t,   i, s) {
	if (kind == "sched") return sched_open(key, t)
	if (kind == "raw") return sched_at(key, t)
	for (i = 1; i <= ns; i++) {
		s = SCHED[i]
		if ((ALLDEV[s] || (s, key) in DEVSET) && (kind == "dev" ? sched_open(s, t) : sched_at(s, t))) return 1
	}
	return 0
}

# State only changes at a window start or end or when an override expires, so test just
# those minutes over the next 8 days instead of every minute.
function secs_to_change(kind, key,   cur, i, k, d, c, t, best, s) {
	cur = state_at(kind, key, 0)
	best = -1
	for (i = 1; i <= ns; i++) {
		s = SCHED[i]
		if (kind != "raw" && (s in OVR)) {
			t = int((OVRLEFT[s] + 59) / 60)
			if (t >= 1 && (best < 0 || t < best) && state_at(kind, key, t) != cur) best = t
		}
		for (k = 0; k < 2; k++) {
			c = (START[s] + k * DUR[s]) % 1440
			for (d = 0; d <= 8; d++) {
				t = d * 1440 + c - nowmin
				if (t >= 1 && (best < 0 || t < best) && state_at(kind, key, t) != cur) best = t
			}
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

	while (ovrfile != "" && (getline line < ovrfile) > 0) {
		if (split(line, f, " ") != 3 || !(f[1] in START) || (f[2] != "ignore" && f[2] != "forced") || f[3] !~ /^[0-9]+$/) continue
		left = f[3] - (epoch - sec % 60)
		if (left > 0) { OVR[f[1]] = f[2]; OVRLEFT[f[1]] = left }
	}

	enabled = (opt["settings", "enabled"] != "0")

	for (i = 1; i <= ns; i++) {
		s = SCHED[i]
		SOPEN[i] = sched_open(s, 0)
		SOVR[i] = (s in OVR) ? OVR[s] : "none"
		SCHG[i] = secs_to_change("sched", s)
		SRAW[i] = secs_to_change("raw", s)
	}

	nout = 0
	for (i = 1; i <= nd; i++) {
		d = DEV[i]
		mac = tolower(opt[d, "mac"])
		if (opt[d, "enabled"] == "0" || mac !~ /^([0-9a-f][0-9a-f]:){5}[0-9a-f][0-9a-f]$/) continue
		if (!enabled) { allowed = 1; reason = "disabled"; chg = -1 }
		else {
			allowed = state_at("dev", mac, 0)
			reason = (allowed == state_at("devraw", mac, 0)) ? "schedule" : "override"
			chg = secs_to_change("dev", mac)
		}
		nout++
		OMAC[nout] = mac; OALLOW[nout] = allowed; OREASON[nout] = reason
		OCHG[nout] = chg; ONAME[nout] = opt[d, "name"]
	}

	if (fmt == "json") {
		printf "{\"now\":%d,\"enabled\":%d,\"schedules\":[", epoch, enabled
		for (i = 1; i <= ns; i++)
			printf "%s{\"id\":\"%s\",\"name\":\"%s\",\"open\":%s,\"override\":\"%s\",\"change_at\":%s}", \
				(i > 1 ? "," : ""), jesc(SCHED[i]), jesc(opt[SCHED[i], "name"]), (SOPEN[i] ? "true" : "false"), SOVR[i], jtime(SCHG[i])
		printf "],\"devices\":["
		for (i = 1; i <= nout; i++)
			printf "%s{\"mac\":\"%s\",\"name\":\"%s\",\"allowed\":%s,\"reason\":\"%s\",\"change_at\":%s}", \
				(i > 1 ? "," : ""), OMAC[i], jesc(ONAME[i]), (OALLOW[i] ? "true" : "false"), OREASON[i], jtime(OCHG[i])
		print "]}"
	} else {
		printf "G|%d\n", enabled
		for (i = 1; i <= ns; i++)
			printf "S|%s|%d|%s|%d|%d|%s\n", SCHED[i], SOPEN[i], SOVR[i], SCHG[i], SRAW[i], opt[SCHED[i], "name"]
		for (i = 1; i <= nout; i++)
			printf "D|%s|%d|%s|%d|%s\n", OMAC[i], OALLOW[i], OREASON[i], OCHG[i], ONAME[i]
	}
}
