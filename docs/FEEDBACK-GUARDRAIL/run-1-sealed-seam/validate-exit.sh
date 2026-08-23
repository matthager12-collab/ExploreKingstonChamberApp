#!/usr/bin/env bash
# validate-exit.sh — Run 1: the sealed moderation seam
#
# Checks run 1's entry and exit criteria. Exits 0 only if every check passed.
# Run from the repo root (work/):
#
#   ./docs/FEEDBACK-GUARDRAIL/run-1-sealed-seam/validate-exit.sh
#
# Two inherited bugs this template exists to avoid:
#   1. ((PASS++)) evaluates to 0 on the first increment, which `set -e` treats
#      as failure and aborts on. Always use PASS=$((PASS+1)).
#   2. eval'ing a criterion string with a substring match passes on noise and
#      hangs forever on a stalled command. Use exit status and a timeout.

set -uo pipefail

PASS=0
FAIL=0
TIMEOUT="${CHECK_TIMEOUT:-600}"

MODULE="src/lib/feedback-moderation.ts"
TESTFILE="tests/unit/feedback-moderation.test.ts"

# Portable timeout: GNU coreutils on Linux, gtimeout via brew on macOS, or none.
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
check "inside a git work tree"          git rev-parse --is-inside-work-tree
check "main exists to diff against"     git rev-parse --verify --quiet main
check "no API key value in any tracked file" \
  bash -c '! git grep -qIE "ANTHROPIC_API_KEY[[:space:]]*=[[:space:]]*[A-Za-z0-9]" -- .'

echo ""
echo "=== Exit criteria ==="

# 1. The gate.
check "typecheck"        npm run typecheck
check "lint"             npm run lint
check "module boundaries" npm run lint:boundaries
check "both test suites" npm run test:all

# 2. The artifacts exist.
check "moderation module exists" test -f "$MODULE"
check "moderation tests exist"   test -f "$TESTFILE"

# 3. Containment, asserted against the source. Each is an inverted grep: the
#    check passes when the pattern is ABSENT, so `grep -q` is negated with `!`.
#
#    Every one of these MUST test -f the file first. grep on a missing file
#    exits 2, which `!` inverts to 0 — so without the guard these four report
#    PASS against a file that was never written. That false pass was observed
#    on 2026-08-21 and is exactly the failure mode this script exists to catch.
absent_from() { # absent_from <file> <extended-regex>
  test -f "$1" || return 1
  # Filenames are stripped before matching. Without this the C6 check fires on
  # the module's own header comment, which cites src/lib/email.ts as the design
  # it is modelled on — a reference to a file, not a contact field. Observed on
  # 2026-08-23 during run 1. A check that forces the code to stop naming its
  # own influences is a worse check, so the check gave way rather than the
  # comment.
  ! sed -E 's/[A-Za-z0-9_-]+\.(ts|tsx|js|mjs|md)//g' "$1" | grep -qiE "$2"
}
export -f absent_from

check "C1 — no tools declared in the seam" \
  bash -c 'absent_from "$0" "\"?tools\"?[[:space:]]*:"' "$MODULE"
check "C8 — the seam never throws" \
  bash -c 'absent_from "$0" "throw |Promise\.reject"' "$MODULE"
check "C6 — no contact data reachable from the seam" \
  bash -c 'absent_from "$0" "\bemail\b|\bfullName\b|body\.name"' "$MODULE"
check "C5 — no raw HTML sink in the seam" \
  bash -c 'absent_from "$0" "dangerouslySetInnerHTML"' "$MODULE"

# 4. Blast radius. Anything outside this set means run 1 reached into run 2.
#    docs/FEEDBACK-GUARDRAIL/** is excluded: the planning documents are this
#    project'\''s own paperwork, committed before run 1 starts, and run 1 is
#    expected to edit design.md § Contracts with the T-01 finding.
check "blast radius confined to the seam" bash -c '
  allowed="src/lib/feedback-moderation.ts
tests/unit/feedback-moderation.test.ts
package.json
package-lock.json
.env.production.example"
  changed=$(git diff --name-only main...HEAD | grep -v "^docs/FEEDBACK-GUARDRAIL/")
  extra=$(comm -23 <(echo "$changed" | sort -u) <(echo "$allowed" | sort -u) | sed "/^$/d")
  if [[ -n "$extra" ]]; then
    echo "unexpected files changed:"; echo "$extra"; exit 1
  fi
  exit 0'

# 5. No secret in this run's commits.
check "no API key in this run's diff" bash -c '
  ! git diff main...HEAD | grep -iE "sk-ant-[A-Za-z0-9]|ANTHROPIC_API_KEY[[:space:]]*=[[:space:]]*[A-Za-z0-9]"'

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
