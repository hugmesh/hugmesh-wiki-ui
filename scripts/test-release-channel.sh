#!/usr/bin/env bash
# Tests for scripts/release-channel.sh and for the parts of
# .github/workflows/release.yml that depend on it. Needs bash, git, python3,
# sed and sort -V; no network (the "remote" is a bare repository in a temp
# directory). Run by the release workflow's version job before it decides
# anything; run locally with: bash scripts/test-release-channel.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
script="$here/release-channel.sh"
workflow="$root/.github/workflows/release.yml"
image=ghcr.io/hugmesh/hugmesh-wiki-ui

work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/release-channel-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT

pass=0
fail=0
ok() { pass=$((pass + 1)); echo "ok   $*"; }
bad() { fail=$((fail + 1)); echo "FAIL $*"; }

g() {
  git -C "$work/clone" -c user.name=test -c user.email=test@example.invalid \
    -c commit.gpgsign=false -c tag.gpgsign=false "$@"
}

# --- fixture -----------------------------------------------------------------
# main:        m1(0.2.0-beta.1) - m2(0.3.0-beta.1) - m5(0.4.0-beta.1) - m6(0.5.0-beta.1)
# release/0.2: m1 - r20(0.2.0)
# release/0.3: m2 - r30(0.3.0) - r31(0.3.1) - r32(0.3.2)
# release/0.4: m5 - r40(0.4.0) - r41(0.4.1)
# release/0.9 and release/0.10 for the sort -V check.
# Stable tags already on the remote: v0.2.0, v0.3.0, v0.3.1, v0.4.0.
git init -q --bare "$work/origin.git"
git init -q -b main "$work/clone"
g remote add origin "$work/origin.git"

commit() { # commit MESSAGE -> prints the sha
  g commit -q --allow-empty -m "$1"
  g rev-parse HEAD
}

m1="$(commit 'main 0.2.0-beta.1')"
m2="$(commit 'main 0.3.0-beta.1')"
g checkout -q -b release/0.2 "$m1"
r20="$(commit 'release 0.2.0')"
g checkout -q -b release/0.3 "$m2"
r30="$(commit 'release 0.3.0')"
r31="$(commit 'release 0.3.1')"
r32="$(commit 'release 0.3.2')"
r3b="$(commit 'release/0.3 commit that is not on main')"
g checkout -q main
m5="$(commit 'main 0.4.0-beta.1')"
g checkout -q -b release/0.4 "$m5"
r40="$(commit 'release 0.4.0')"
r41="$(commit 'release 0.4.1')"
g checkout -q main
m6="$(commit 'main 0.5.0-beta.1')"
g checkout -q -b release/0.9 "$m6"
r90="$(commit 'release 0.9.0')"
g checkout -q -b release/0.10 "$m6"
r100="$(commit 'release 0.10.0')"
g checkout -q -b release/attest-something "$m6"
g checkout -q main
g tag v0.2.0 "$r20"
g tag v0.3.0 "$r30"
g tag v0.3.1 "$r31"
g tag v0.4.0 "$r40"
g tag v0.5.0-beta.1 "$m6"
g tag not-a-version "$m6"
g push -q origin main release/0.2 release/0.3 release/0.4 release/0.9 release/0.10 release/attest-something
g push -q origin --tags

# run_case NAME VERSION REF SHA -> sets $out, $err, $rc
run_case() {
  rc=0
  out="$(cd "$work/clone" && VERSION="$2" GITHUB_REF="$3" GITHUB_SHA="$4" \
    IMAGE_NAME="$image" VERSION_FILE=package.json bash "$script" 2>"$work/err")" || rc=$?
  err="$(cat "$work/err")"
}

field() { # field KEY -> value of KEY in $out
  printf '%s\n' "$out" | sed -n "s/^$1=//p"
}

image_tags() { # the image_tags block of $out, tag names only, sorted, space separated
  printf '%s\n' "$out" |
    sed -n '/^image_tags<<EOF_IMAGE_TAGS$/,/^EOF_IMAGE_TAGS$/p' |
    sed '1d;$d' | sed "s#^$image:##" | sort | tr '\n' ' ' | sed 's/ $//'
}

expect_ok() { # expect_ok NAME KIND CHANNEL MOVE_MINOR MOVE_LATEST "TAGS"
  local name
  name="$1"
  if [ "$rc" != 0 ]; then
    bad "$name: exit $rc: $err"
    return
  fi
  local got
  got="kind=$(field kind) channel=$(field channel) move_minor=$(field move_minor) move_latest=$(field move_latest) tags=[$(image_tags)]"
  local want
  want="kind=$2 channel=$3 move_minor=$4 move_latest=$5 tags=[$6]"
  if [ "$got" = "$want" ]; then
    ok "$name"
  else
    bad "$name: got $got; want $want"
  fi
}

expect_refused() { # expect_refused NAME TEXT-IN-ERROR
  if [ "$rc" = 0 ]; then
    bad "$1: accepted, want refusal; output: $out"
    return
  fi
  case "$err" in
    *"::error::"*"$2"*) ok "$1" ;;
    *) bad "$1: refused without '$2': $err" ;;
  esac
}

s12() { printf '%s' "${1:0:12}"; }

# --- the required cases ------------------------------------------------------
run_case "beta tag on main" 0.5.0-beta.1 refs/tags/v0.5.0-beta.1 "$m6"
expect_ok "beta tag on main -> :X.Y.Z-beta.N + :beta, no :X.Y/:latest" release beta false false \
  "0.5.0-beta.1 beta sha-$(s12 "$m6")"

run_case "stable, newest line" 0.4.1 refs/tags/v0.4.1 "$r41"
expect_ok "stable on release/0.4, newest line -> :X.Y.Z + :X.Y + :latest" release stable true true \
  "0.4 0.4.1 latest sha-$(s12 "$r41")"

run_case "stable, older-line patch" 0.3.2 refs/tags/v0.3.2 "$r32"
expect_ok "stable older-line patch on release/0.3 -> :X.Y moves, :latest does not" release stable true false \
  "0.3 0.3.2 sha-$(s12 "$r32")"

run_case "stable tag on main" 0.5.0 refs/tags/v0.5.0 "$m6"
expect_refused "stable tag on a main commit (no release/0.5) is refused" "needs branch release/0.5"
run_case "stable tag on main, line branch exists" 0.4.2 refs/tags/v0.4.2 "$m6"
expect_refused "stable tag on a main commit that release/0.4 lacks is refused" "is not on release/0.4"

run_case "beta tag on a release branch" 0.3.3-beta.1 refs/tags/v0.3.3-beta.1 "$r3b"
expect_refused "beta tag on a release/X.Y-only commit is refused" "is not on main"

# --- more stable-line rules --------------------------------------------------
run_case "first stable of a line, newest" 0.10.0 refs/tags/v0.10.0 "$r100"
expect_ok "sort -V: 0.10.0 is newer than 0.9.x and 0.4.x" release stable true true \
  "0.10 0.10.0 latest sha-$(s12 "$r100")"

# Pretend v0.10.0 is published, then cut 0.9.0: an older line by sort -V.
g tag v0.10.0 "$r100"
g push -q origin v0.10.0
run_case "older line by sort -V" 0.9.0 refs/tags/v0.9.0 "$r90"
expect_ok "sort -V: 0.9.0 is older than 0.10.0 -> no :latest" release stable true false \
  "0.9 0.9.0 sha-$(s12 "$r90")"
g push -q origin :refs/tags/v0.10.0
g tag -d v0.10.0 >/dev/null

run_case "rerun of an old patch" 0.3.0 refs/tags/v0.3.0 "$r30"
expect_ok "re-running v0.3.0 after v0.3.1 moves no floating tag" release stable false false \
  "0.3.0 sha-$(s12 "$r30")"

run_case "beta tags ignored for :latest" 0.4.1 refs/tags/v0.4.1 "$r41"
expect_ok "a newer beta tag (v0.5.0-beta.1) does not take :latest from a stable" release stable true true \
  "0.4 0.4.1 latest sha-$(s12 "$r41")"

run_case "stable without its release branch" 0.6.0 refs/tags/v0.6.0 "$m6"
expect_refused "stable tag whose release/X.Y does not exist is refused" "release/0.6"

run_case "stable on the wrong line" 0.3.3 refs/tags/v0.3.3 "$r41"
expect_refused "stable tag on another line's branch is refused" "is not on release/0.3"

run_case "tag does not match version" 0.4.1 refs/tags/v0.4.2 "$r41"
expect_refused "tag must equal v + version" "does not match package.json version 0.4.1"

run_case "bad version" 0.4.1-rc.1 refs/tags/v0.4.1-rc.1 "$r41"
expect_refused "only X.Y.Z and X.Y.Z-beta.N are versions" "is not MAJOR.MINOR.PATCH"

# --- branch pushes -----------------------------------------------------------
run_case "push to main" 0.5.0-beta.1 refs/heads/main "$m6"
expect_ok "push to main -> :main + :sha" main none false false "main sha-$(s12 "$m6")"

run_case "push to release/0.3" 0.3.2 refs/heads/release/0.3 "$r32"
expect_ok "push to release/X.Y -> :sha only, no floating tag" branch none false false "sha-$(s12 "$r32")"

run_case "push to release/<not X.Y>" 0.5.0-beta.1 refs/heads/release/attest-something "$m6"
expect_refused "release/<not X.Y> is refused" "a release branch is named release/X.Y"

run_case "release branch with another line's version" 0.4.1 refs/heads/release/0.3 "$r32"
expect_refused "release/0.3 carrying 0.4.1 is refused" "must carry an X.Y.* version"

run_case "other branch" 0.5.0-beta.1 refs/heads/feature/x "$m6"
expect_refused "other branches are refused" "only main, release/X.Y branches and v* tags publish"

(cd "$work/clone" && git remote set-url origin "$work/nowhere.git")
run_case "unreadable remote" 0.4.1 refs/tags/v0.4.1 "$r41"
expect_refused "an unreadable remote fails closed" "could not read branch release/0.4"
(cd "$work/clone" && git remote set-url origin "$work/origin.git")

# --- the workflow's signref guard agrees with the computed tags ---------------
# Extract the python of the "signref" step from release.yml and run it.
python3 - "$workflow" "$work/signref.py" <<'PY'
import sys, textwrap
lines = open(sys.argv[1]).read().split("\n")
start = next(i for i, l in enumerate(lines) if l.strip() == "id: signref")
begin = next(i for i in range(start, len(lines)) if lines[i].strip() == "python3 - <<'PY'")
end = next(i for i in range(begin + 1, len(lines)) if lines[i].strip() == "PY")
open(sys.argv[2], "w").write(textwrap.dedent("\n".join(lines[begin + 1:end])) + "\n")
PY

signref() { # signref VERSION MOVE_LATEST "pushed tags" "expected tags" -> rc
  local names expected t
  names=""
  for t in $3; do names="$names${names:+,}$image:$t"; done
  expected=""
  for t in $4; do expected="$expected$image:$t"$'\n'; done
  : >"$work/gho"
  VERSION="$1" MOVE_LATEST="$2" EXPECTED_TAGS="$expected" GITHUB_OUTPUT="$work/gho" \
    DIGEST="sha256:$(printf '%064d' 0)" METADATA="{\"image.name\": \"$names\"}" \
    python3 "$work/signref.py" >/dev/null 2>&1
}

expect_signref() { # expect_signref NAME WANT-RC VERSION MOVE_LATEST "pushed" ["expected"]
  local rc
  rc=0
  signref "$3" "$4" "$5" "${6:-$5}" || rc=$?
  if { [ "$2" = 0 ] && [ "$rc" = 0 ]; } || { [ "$2" != 0 ] && [ "$rc" != 0 ]; }; then
    ok "signref: $1"
  else
    bad "signref: $1 (exit $rc)"
  fi
}

expect_signref "stable newest line with :latest is signed" 0 0.4.1 true "0.4.1 0.4 latest sha-abc"
expect_signref "older-line patch without :latest is signed" 0 0.3.2 false "0.3.2 0.3 sha-abc"
expect_signref "beta with :beta is signed" 0 0.5.0-beta.1 false "0.5.0-beta.1 beta sha-abc"
expect_signref "main push is signed" 0 0.5.0-beta.1 false "main sha-abc"
expect_signref "beta with :latest is refused" 1 0.5.0-beta.1 true "0.5.0-beta.1 latest sha-abc"
expect_signref "older-line patch with :latest is refused" 1 0.3.2 false "0.3.2 latest sha-abc"
expect_signref "empty VERSION with :latest is refused" 1 "" true "0.4.1 latest sha-abc"
expect_signref "pushed tags differing from the computed tags are refused" 1 0.4.1 true \
  "0.4.1 0.4 latest sha-abc" "0.4.1 sha-abc"

# --- wiring: release.yml uses the script and keeps the guards -----------------
has() { # has NAME FIXED-STRING: the workflow contains the string
  if grep -F -e "$2" "$workflow" >/dev/null; then ok "workflow: $1"; else bad "workflow: $1 (missing: $2)"; fi
}
lacks() {
  if grep -F -e "$2" "$workflow" >/dev/null; then bad "workflow: $1 (found: $2)"; else ok "workflow: $1"; fi
}
has "push trigger includes release/**" "branches: [main, 'release/**']"
has "tag trigger is v*" "tags: ['v*']"
has "version job runs this self-test" "run: bash scripts/test-release-channel.sh"
has "version job calls release-channel.sh" "bash scripts/release-channel.sh)"
has "version regex still in the version job" '^[0-9]+\.[0-9]+\.[0-9]+(-beta\.[1-9][0-9]*)?$'
has "package-lock check still in the version job" 'does not match package.json ($version)'
has "image job takes the computed tags" 'IMAGE_TAGS: ${{ needs.version.outputs.image_tags }}'
has "overwrite guard inspects the immutable :X.Y.Z" 'ref="$IMAGE_NAME:$VERSION"'
has "overwrite guard fails closed on an unknown error" 'could not tell whether $ref exists'
has "signref keeps the :latest literal" 'if "latest" in tags and ("-" in (os.environ.get("VERSION") or "-")'
has "signref compares pushed and computed tags" 'EXPECTED_TAGS: ${{ steps.meta.outputs.tags }}'
has "every pushed tag is checked against the signed digest" "Check every pushed tag resolves to the signed digest"
has "beta GitHub release is a prerelease, never Latest" "*-*) args+=(--prerelease --latest=false) ;;"
has "newest stable GitHub release is marked Latest" "args+=(--latest)"
has "older-line stable GitHub release is not Latest" "args+=(--latest=false)"
has "github-release gets MOVE_LATEST" 'MOVE_LATEST: ${{ needs.version.outputs.move_latest }}'
lacks "no pull_request trigger" "pull_request:"
lacks "no unconditional :latest refusal left" 'if "latest" in tags:'

echo
echo "release-channel tests: $pass passed, $fail failed"
[ "$fail" = 0 ]
