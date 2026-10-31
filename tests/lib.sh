# Shared helpers for the shell test suites (sourced, not executed).
FAILED=0
PASSED=0

assert_eq() {
	desc="$1"
	expected="$2"
	actual="$3"
	if [ "$expected" = "$actual" ]; then
		printf "  ✓ %s\n" "$desc"
		PASSED=$((PASSED + 1))
	else
		printf "  ✗ %s (expected: '%s', got: '%s')\n" "$desc" "$expected" "$actual"
		FAILED=$((FAILED + 1))
	fi
}

# at <dow> <HH> <MM>: fake clock; epoch grows with the time of day (always past MIN_EPOCH)
at() {
	secs=$(($2 * 3600 + $3 * 60))
	SCREENTIME_CLOCK="$1 $secs $((1800000000 + secs))"
	export SCREENTIME_CLOCK
}

# state <mac>: allowed|blocked at the current fake clock
state() {
	load_state
	decide lines | awk -F'|' -v m="$1" '$1 == "D" && $2 == m {print ($3 == 1 ? "allowed" : "blocked")}'
}

summary() {
	echo "=========================================="
	echo " Results: $PASSED passed, $FAILED failed"
	echo "=========================================="
	[ "$FAILED" -eq 0 ]
}
