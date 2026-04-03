#!/usr/bin/env bash
# Keep only the newest N immutable sha-* tags in one Docker Hub repository.
# Leaves the special :cache tag and any non-sha tags untouched.
set -euo pipefail

trim() { printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

DH_USER="$(trim "${DH_USER:-}")"
DH_TOKEN="$(trim "${DH_TOKEN:-}")"
IMAGE_SLUG="$(trim "${IMAGE_SLUG:-}")"
KEEP_LAST_IMAGES="$(trim "${KEEP_LAST_IMAGES:-3}")"

if [[ -z "${DH_USER}" || -z "${DH_TOKEN}" || -z "${IMAGE_SLUG}" ]]; then
  echo "cleanup: missing DH_USER, DH_TOKEN, or IMAGE_SLUG; skipping"
  exit 0
fi

case "${KEEP_LAST_IMAGES}" in
  ''|*[!0-9]*)
    echo "cleanup: KEEP_LAST_IMAGES must be a non-negative integer" >&2
    exit 1
    ;;
esac

if [[ "${KEEP_LAST_IMAGES}" -eq 0 ]]; then
  echo "cleanup: KEEP_LAST_IMAGES=0; skipping"
  exit 0
fi

repo="interview-ai-${IMAGE_SLUG}"

login_payload="$(DH_USER="${DH_USER}" DH_TOKEN="${DH_TOKEN}" python3 - <<'PY'
import json
import os

print(json.dumps({"username": os.environ["DH_USER"], "password": os.environ["DH_TOKEN"]}))
PY
)"

login_response="$({
  curl -fsSL -X POST \
    -H 'Content-Type: application/json' \
    -d "${login_payload}" \
    https://hub.docker.com/v2/users/login/
})"

hub_jwt="$(LOGIN_RESPONSE="${login_response}" python3 -c 'import json, os; print(json.loads(os.environ["LOGIN_RESPONSE"]).get("token", ""))')"

if [[ -z "${hub_jwt}" ]]; then
  echo "cleanup: failed to obtain Docker Hub API token" >&2
  exit 1
fi

api_base="https://hub.docker.com/v2/namespaces/${DH_USER}/repositories/${repo}/tags"
next_url="${api_base}?page_size=100&ordering=last_updated"

sha_tags=()
while [[ -n "${next_url}" ]]; do
  response="$(curl -fsSL -H "Authorization: JWT ${hub_jwt}" "${next_url}")"
  while IFS= read -r tag; do
    [[ -z "${tag}" ]] && continue
    if [[ "${tag}" == sha-* ]]; then
      sha_tags+=("${tag}")
    fi
  done < <(RESPONSE_JSON="${response}" python3 -c 'import json, os; [print(item.get("name")) for item in json.loads(os.environ["RESPONSE_JSON"]).get("results", []) if item.get("name")]')

  next_url="$(RESPONSE_JSON="${response}" python3 -c 'import json, os; print(json.loads(os.environ["RESPONSE_JSON"]).get("next") or "")')"
done

count="${#sha_tags[@]}"
if (( count <= KEEP_LAST_IMAGES )); then
  echo "cleanup: ${repo} has ${count} sha tags; nothing to delete"
  exit 0
fi

echo "cleanup: ${repo} has ${count} sha tags; keeping newest ${KEEP_LAST_IMAGES}"

for ((i = KEEP_LAST_IMAGES; i < count; i++)); do
  tag="${sha_tags[$i]}"
  echo "cleanup: deleting ${repo}:${tag}"
  curl -fsSL -X DELETE \
    -H "Authorization: JWT ${hub_jwt}" \
    "${api_base}/${tag}/" >/dev/null
done

echo "cleanup: done for ${repo}"