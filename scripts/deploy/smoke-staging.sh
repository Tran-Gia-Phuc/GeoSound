#!/bin/sh
# End-to-end check of a GeoSound environment on Kubernetes (deployment plan task 2.6, issue #374).
# Plays a new contributor through the public entry (Ingress -> gateway -> services):
#
#   client page and public tours list -> register -> OTP from the auth log -> verify -> login
#   -> create a tour -> add a place (place.submitted) -> wait for the moderation result
#
#   sh scripts/deploy/smoke-staging.sh <base-url> [namespace]
#   e.g. sh scripts/deploy/smoke-staging.sh http://localhost geosound-staging
#
# Needs curl and kubectl (the OTP is read from the auth pod log, so the environment must run
# without geosound-smtp: staging only, never prod). It leaves one test account
# (smoke-<time>@example.com) and one draft tour behind.
#
# Env:
#   SMOKE_REJECT=1    also add a place marked E2E_REJECT and expect `rejected` (AI stub only,
#                     deploy/local/ai-stub.yaml; the real AI would judge the text itself)
#   SMOKE_TIMEOUT     seconds to wait for a moderation result (default 90)
#   KUBECTL           kubectl command (default kubectl), e.g. "kubectl --kubeconfig k3s.yaml"
set -eu

[ $# -ge 1 ] || { echo "usage: $0 <base-url> [namespace]" >&2; exit 2; }
BASE=${1%/}
NS=${2:-geosound-staging}
KUBECTL=${KUBECTL:-kubectl}
TIMEOUT=${SMOKE_TIMEOUT:-90}
RUN=$(date +%s)
EMAIL="smoke-$RUN@example.com"
PASSWORD="Smoke${RUN}a1"
BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT

fail() { echo "[smoke] FAIL: $*" >&2; exit 1; }
# call <method> <path> [json] [token]: the body goes to $BODY, the status code to stdout.
call() {
  set -- "$1" "$2" "${3:-}" "${4:-}"
  curl -sS -o "$BODY" -w '%{http_code}' -X "$1" "$BASE$2" \
    -H 'content-type: application/json' \
    ${4:+-H "authorization: Bearer $4"} \
    ${3:+--data "$3"}
}
expect() { # expect <status> <what>
  [ "$code" = "$1" ] || fail "$2: HTTP $code, expected $1: $(head -c 300 "$BODY")"
  echo "[smoke] $2: $code"
}
# First string value of a key in $BODY (enough for ids, tokens and states).
field() { grep -o "\"$1\":\"[^\"]*\"" "$BODY" | head -n 1 | cut -d'"' -f4; }

code=$(call GET /); expect 200 "client page"
code=$(call GET /api/tours); expect 200 "public tours list"

code=$(call POST /api/auth/register \
  "{\"fullName\":\"Smoke Test\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"role\":\"contributor\"}")
expect 202 "register $EMAIL"

otp=""
i=0
while [ -z "$otp" ] && [ $i -lt 10 ]; do
  otp=$($KUBECTL -n "$NS" logs deploy/auth --since=5m 2>/dev/null \
    | grep "OTP (register) cho $EMAIL = " | tail -n 1 | sed 's/.* = //' | tr -d '\r')
  [ -n "$otp" ] || { i=$((i + 1)); sleep 1; }
done
[ -n "$otp" ] || fail "no OTP for $EMAIL in the auth log (is geosound-smtp set? this check needs the console mailer)"
echo "[smoke] OTP read from the auth log"

code=$(call POST /api/auth/verify-otp "{\"email\":\"$EMAIL\",\"otp\":\"$otp\"}"); expect 201 "verify OTP"
code=$(call POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"); expect 200 "login"
token=$(field accessToken)
[ -n "$token" ] || fail "login answered no accessToken"

code=$(call POST /api/tours '{"title":"Smoke test tour","originalLanguage":"en","city":"Hanoi"}' "$token")
expect 201 "create tour"
tour=$(field id)

# add_place <name> <description>: prints the place id.
add_place() {
  code=$(call POST "/api/tours/mine/$tour/places" \
    "{\"name\":\"$1\",\"description\":\"$2\",\"lat\":21.0285,\"lng\":105.8542}" "$token")
  expect 201 "add place '$1' (moderation status $(field moderationStatus))" >&2
  field id
}
# wait_result <place id> <expected status>
wait_result() {
  deadline=$(( $(date +%s) + TIMEOUT ))
  while :; do
    code=$(call GET "/api/tours/mine/$tour/places" "" "$token")
    [ "$code" = 200 ] || fail "list places: HTTP $code"
    status=$(sed -n "s/.*\"id\":\"$1\"[^}]*\"moderationStatus\":\"\([a-z]*\)\".*/\1/p" "$BODY")
    if [ -n "$status" ] && [ "$status" != checking ]; then break; fi
    [ "$(date +%s)" -lt "$deadline" ] || fail "place $1 still '${status:-?}' after ${TIMEOUT}s (moderation or AI down?)"
    sleep 2
  done
  [ "$status" = "$2" ] || fail "place $1 ended '$status', expected '$2'"
  echo "[smoke] moderation result for place $1: $status"
}

place=$(add_place "Hoan Kiem Lake" "A calm lake in the centre of Hanoi with the Turtle Tower and the red Huc bridge.")
wait_result "$place" approved

if [ "${SMOKE_REJECT:-0}" = 1 ]; then
  place=$(add_place "Smoke reject" "A place the AI stub rejects: E2E_REJECT.")
  wait_result "$place" rejected
fi

echo "[smoke] OK: $BASE ($NS)"
