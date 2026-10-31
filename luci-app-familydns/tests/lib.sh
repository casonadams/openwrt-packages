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

summary() {
	echo "=========================================="
	echo " Results: $PASSED passed, $FAILED failed"
	echo "=========================================="
	[ "$FAILED" -eq 0 ]
}
