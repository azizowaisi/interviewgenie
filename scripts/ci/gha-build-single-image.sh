#!/usr/bin/env bash
# Build & push one image (used by parallel matrix jobs in GitHub Actions).
# Caching: GHA cache (per service scope) + optional Docker registry :cache tag.
#
# Required env: IMAGE_SLUG — api-service | audio-service | stt-service | question-service |
#                          llm-service | formatter-service | monitoring-service | web
# Required env: DH_USER, IMAGE_TAG (e.g. sha-abc123def456)
# Optional: PLATFORMS (CI sets this; default matches workflow: multi-arch)
# Optional: WEB_DOCKER_PLATFORMS — when IMAGE_SLUG=web and this is non-empty, overrides PLATFORMS
#   (e.g. linux/amd64 only — avoids QEMU arm64 and often cuts web build time by ~50%+).
# Optional web build-args: WEB_PUBLIC_APP_URL, WEB_ADMIN_SITE_URL, WEB_ADMIN_HOSTS, WEB_MAIN_APP_HOSTS
# Optional Auth0/app build-args for web: AUTH0_DOMAIN, AUTH0_ISSUER_BASE_URL, AUTH0_CLIENT_ID,
#   AUTH0_CLIENT_SECRET, AUTH0_SECRET, AUTH0_BASE_URL, APP_BASE_URL
set -euo pipefail

SLUG="${IMAGE_SLUG:?IMAGE_SLUG is required}"
PLATFORMS="${PLATFORMS:-linux/arm64}"
if [[ "${SLUG}" == "web" ]] && [[ -n "${WEB_DOCKER_PLATFORMS:-}" ]]; then
  PLATFORMS="${WEB_DOCKER_PLATFORMS}"
  echo "Web build: using WEB_DOCKER_PLATFORMS=${PLATFORMS} (overrides global PLATFORMS)"
fi
ENABLE_REGISTRY_CACHE="${ENABLE_REGISTRY_CACHE:-true}"

case "${SLUG}" in
  api-service) CONTEXT_DIR="./backend/api-service" ;;
  audio-service) CONTEXT_DIR="./backend/audio-service" ;;
  stt-service) CONTEXT_DIR="./backend/stt-service" ;;
  question-service) CONTEXT_DIR="./backend/question-service" ;;
  llm-service) CONTEXT_DIR="./backend/llm-service" ;;
  formatter-service) CONTEXT_DIR="./backend/formatter-service" ;;
  cv-parser-service) CONTEXT_DIR="./backend/cv-parser-service" ;;
  monitoring-service) CONTEXT_DIR="./backend/monitoring-service" ;;
  web) CONTEXT_DIR="./web" ;;
  *)
    echo "Unknown IMAGE_SLUG=${SLUG}" >&2
    exit 1
    ;;
esac

scope="${SLUG}"
cache_args=()
cache_args+=(--cache-from "type=gha,scope=${scope}")
cache_args+=(--cache-to "type=gha,mode=max,scope=${scope}")
if [[ "${ENABLE_REGISTRY_CACHE}" == "true" ]] && [[ -n "${DH_USER:-}" ]]; then
  cref="${DH_USER}/interview-ai-${SLUG}:cache"
  cache_args+=(--cache-from "type=registry,ref=${cref}")
  cache_args+=(--cache-to "type=registry,ref=${cref},mode=max")
fi

echo "---- build & push interview-ai-${SLUG} (platforms=${PLATFORMS}) ----"

if [[ "${SLUG}" == "web" ]]; then
  PUB="${WEB_PUBLIC_APP_URL:-}"
  PUB="${PUB:-http://localhost:3002}"
  ADM_SITE="${WEB_ADMIN_SITE_URL:-}"
  ADM_HOSTS="${WEB_ADMIN_HOSTS:-}"
  MAIN_HOSTS="${WEB_MAIN_APP_HOSTS:-}"
  AUTH0_DOMAIN_VAL="${AUTH0_DOMAIN:-}"
  AUTH0_ISSUER_BASE_URL_VAL="${AUTH0_ISSUER_BASE_URL:-}"
  AUTH0_CLIENT_ID_VAL="${AUTH0_CLIENT_ID:-}"
  AUTH0_CLIENT_SECRET_VAL="${AUTH0_CLIENT_SECRET:-}"
  AUTH0_SECRET_VAL="${AUTH0_SECRET:-}"
  AUTH0_BASE_URL_VAL="${AUTH0_BASE_URL:-$PUB}"
  APP_BASE_URL_VAL="${APP_BASE_URL:-$PUB}"
  echo "Web NEXT_PUBLIC_* PUB=$PUB ADM_SITE=$ADM_SITE"
  docker buildx build \
    --platform "${PLATFORMS}" \
    --provenance=false \
    --push \
    "${cache_args[@]}" \
    -t "${DH_USER}/interview-ai-${SLUG}:${IMAGE_TAG}" \
    --build-arg "NEXT_PUBLIC_PUBLIC_APP_URL=${PUB}" \
    --build-arg "NEXT_PUBLIC_ADMIN_SITE_URL=${ADM_SITE}" \
    --build-arg "NEXT_PUBLIC_ADMIN_HOSTS=${ADM_HOSTS}" \
    --build-arg "NEXT_PUBLIC_MAIN_APP_HOSTS=${MAIN_HOSTS}" \
    --build-arg "AUTH0_DOMAIN=${AUTH0_DOMAIN_VAL}" \
    --build-arg "AUTH0_ISSUER_BASE_URL=${AUTH0_ISSUER_BASE_URL_VAL}" \
    --build-arg "AUTH0_CLIENT_ID=${AUTH0_CLIENT_ID_VAL}" \
    --build-arg "AUTH0_CLIENT_SECRET=${AUTH0_CLIENT_SECRET_VAL}" \
    --build-arg "AUTH0_SECRET=${AUTH0_SECRET_VAL}" \
    --build-arg "AUTH0_BASE_URL=${AUTH0_BASE_URL_VAL}" \
    --build-arg "APP_BASE_URL=${APP_BASE_URL_VAL}" \
    "${CONTEXT_DIR}"
else
  docker buildx build \
    --platform "${PLATFORMS}" \
    --provenance=false \
    --push \
    "${cache_args[@]}" \
    -t "${DH_USER}/interview-ai-${SLUG}:${IMAGE_TAG}" \
    "${CONTEXT_DIR}"
fi

echo "=== Done interview-ai-${SLUG} (tag ${IMAGE_TAG}) ==="
