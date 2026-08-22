#!/usr/bin/env bash
# validate-exit.sh — Run 2: wiring and privacy
#
# Checks run 2's entry and exit criteria. Exits 0 only if every check passed.
# Run from the repo root (work/):
#
#   ./docs/FEEDBACK-GUARDRAIL/run-2-wiring-and-privacy/validate-exit.sh
#   ./docs/FEEDBACK-GUARDRAIL/run-2-wiring-and-privacy/validate-exit.sh --entry
#
# --entry checks only the entry criteria, for use at the start of the run.
#
# Two inherited bugs this template exists to avoid:
#   1. ((PASS++)) evaluates to 0 on the first increment, which `set -e` treats
#      as failure and aborts on. Always use PASS=$((PASS+1)).
#   2. eval'ing a criterion string with a substring match passes on noise and
#      hangs forever on a stalled command. Use exit status and a timeout.

set -uo pipefail

PASS=0
FAIL=0
TIMEOUT="${CHECK_TIMEOUT:-900}"
ENTRY_ONLY=0
[[ "${1:-}" == "--entry" ]] && ENTRY_ONLY=1

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE="src/lib/feedback-moderation.ts"
POLICY="src/lib/privacy/policy.ts"
NOTICE="src/app/(site)/privacy/page.tsx"

if command -v timeout >/dev/null 2>&1; then
  RUN_TIMEOUT=(timeout "$TIMEOUT")
elif command -v gtimeout >/dev/null 2>&1; then
  RUN_TIMEOUT=(gtimeout "$TIMEOUT")
else
  RUN_TIMEOUT=(env)
fi

# check <description> <command> [args...] — passes when the command exits 0.
check() {
  local desc="$1"; shift
  local output status
  if output=$("${RUN_TIMEOUT[@]}" "$@" 2>&1); then
    echo "PASS: $desc"
    PASS=$((PASS + 1))
  else
    status=$?
    if [[ $status -eq 124 ]]; then
      echo "FAIL: $desc (timed out after ${TIMEOUT}s)"
    else
      echo "FAIL: $desc (exit $status)"
      [[ -n "$output" ]] && echo "$output" | tail -5 | sed 's/^/      /'
    fi
    FAIL=$((FAIL + 1))
  fi
}

if [[ ! -f package.json ]]; then
  echo "Run this from the repo root (work/), not from the run directory." >&2
  exit 1
fi

echo "=== Entry criteria ==="
# Re-run run 1's gate rather than trusting the handoff.
check "run 1 exit criteria still hold" "$HERE/../run-1-sealed-seam/validate-exit.sh"
check "moderateComment is exported" \
  bash -c 'grep -qE "export (async )?function moderateComment" "$0"' "$MODULE"
check "T-01 finding recorded (no implementation-order note left)" \
  bash -c '! grep -q "Implementation-order note" "$0"' "$HERE/../design.md"

if [[ $ENTRY_ONLY -eq 1 ]]; then
  echo ""
  echo "=== Summary (entry only) ==="
  TOTAL=$((PASS + FAIL))
  echo "Passed: $PASS / $TOTAL"
  echo "Failed: $FAIL / $TOTAL"
  [[ $FAIL -eq 0 ]] && { echo "ALL CHECKS PASSED"; exit 0; }
  echo "SOME CHECKS FAILED"; exit 1
fi

echo ""
echo "=== Exit criteria ==="

# 1. The whole gate, no exceptions. The tripwire must be satisfied by now.
check "typecheck"         npm run typecheck
check "lint"              npm run lint
check "module boundaries" npm run lint:boundaries
check "both test suites"  npm run test:all
check "production build"  npm run build

# 2. The notice version actually moved (DEC-007).
check "PRIVACY_NOTICE_VERSION bumped to 2026-09" \
  bash -c 'grep -qE "PRIVACY_NOTICE_VERSION *= *\"2026-09\"" "$0"' "$POLICY"

# 3. The new processor is disclosed in both places (DEC-002).
check "Anthropic disclosed in docs/PRIVACY.md" \
  bash -c 'grep -qi anthropic docs/PRIVACY.md'
check "Anthropic disclosed on the public notice" \
  bash -c 'grep -qi anthropic "$0"' "$NOTICE"

# 4. Stale claims are gone. Inverted greps: pass when ABSENT.
check "no stale 'no contact field' claim in types.ts" \
  bash -c '! grep -qi "NO contact field" src/lib/types.ts'
check "no stale 'drops any contact' claim in the route" \
  bash -c '! grep -qi "drop.*contact" src/app/api/feedback/route.ts'
check "no stale 'drops any contact' claim in docs/PRIVACY.md" \
  bash -c '! grep -qi "drops any contact" docs/PRIVACY.md'

# 5. The store is registered with an identifier, not as identifier-free.
check "feedback_response no longer registered as identifier-free" \
  bash -c '! grep -A2 "noIdentifierStore(" src/lib/privacy/pii-inventory.ts | grep -q "\"feedback_response\""'

# 6. No raw HTML sink anywhere on the feedback path (control C5).
check "no dangerouslySetInnerHTML on the feedback path" \
  bash -c '! grep -rq "dangerouslySetInnerHTML" src/components/feedback-tab.tsx "src/app/(site)/admin/feedback/"'

# 7. No secret in the run's commits.
check "no API key value in any tracked file" \
  bash -c '! git grep -qIE "sk-ant-[A-Za-z0-9]|ANTHROPIC_API_KEY[[:space:]]*=[[:space:]]*[A-Za-z0-9]" -- .'

echo ""
echo "=== Summary ==="
TOTAL=$((PASS + FAIL))
echo "Passed: $PASS / $TOTAL"
echo "Failed: $FAIL / $TOTAL"

if [[ $TOTAL -eq 0 ]]; then
  echo "NO CHECKS DEFINED — this script proves nothing"
  exit 1
fi

if [[ $FAIL -eq 0 ]]; then
  echo "ALL CHECKS PASSED"
  exit 0
fi

echo "SOME CHECKS FAILED"
exit 1
