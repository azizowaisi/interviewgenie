#!/usr/bin/env bash
# Build & push only images flagged by the detect job (serial — local or ad-hoc).
# GitHub Actions on main uses parallel matrix + scripts/ci/gha-build-single-image.sh instead.
# Caching: GHA cache (per service scope) + optional Docker registry cache (persists across runners).
#
# Env: DH_USER, IMAGE_TAG (e.g. sha-abc123def456)
# Env: PLATFORMS — default multi-arch (match CI)
# Env: ENABLE_REGISTRY_CACHE — true/false (default true when DH_USER set); uses :cache tag per image repo
# Flags: BUILD_API_SERVICE, BUILD_AUDIO_SERVICE, ... BUILD_WEB (true/false)
# Optional: WEB_PUBLIC_APP_URL, WEB_ADMIN_SITE_URL, WEB_ADMIN_HOSTS, WEB_MAIN_APP_HOSTS
set -euo pipefail

PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
ENABLE_REGISTRY_CACHE="${ENABLE_REGISTRY_CACHE:-true}"
KEEP_LAST_IMAGES="${KEEP_LAST_IMAGES:-3}"

need() {
  [[ "${!1:-false}" == "true" ]]
}

# Usage: build_one <context_dir> <image_slug> <cache_scope> [extra docker buildx args...]
build_one() {
  local context_dir="$1"
  local image_slug="$2"
  local scope="$3"
  shift 3
  local -a cache_args=()
  cache_args+=(--cache-from "type=gha,scope=${scope}")
  cache_args+=(--cache-to "type=gha,mode=max,scope=${scope}")
  if [[ "${ENABLE_REGISTRY_CACHE}" == "true" ]] && [[ -n "${DH_USER:-}" ]]; then
    local cref="${DH_USER}/interview-ai-${image_slug}:cache"
    cache_args+=(--cache-from "type=registry,ref=${cref}")
    cache_args+=(--cache-to "type=registry,ref=${cref},mode=max")
  fi

  echo "---- build & push interview-ai-${image_slug} (platforms=${PLATFORMS}) ----"
  docker buildx build \
    --platform "${PLATFORMS}" \
    --push \
    "${cache_args[@]}" \
    -t "${DH_USER}/interview-ai-${image_slug}:${IMAGE_TAG}" \
    "$@" \
    "${context_dir}"

  if [[ -n "${DH_TOKEN:-}" ]]; then
    IMAGE_SLUG="${image_slug}" KEEP_LAST_IMAGES="${KEEP_LAST_IMAGES}" \
      DH_USER="${DH_USER}" DH_TOKEN="${DH_TOKEN}" \
      bash scripts/ci/gha-clean-dockerhub-tags.sh
  fi
}

if need BUILD_API_SERVICE; then build_one ./backend/api-service api-service api-service; fi
if need BUILD_AUDIO_SERVICE; then build_one ./backend/audio-service audio-service audio-service; fi
if need BUILD_STT_SERVICE; then build_one ./backend/stt-service stt-service stt-service; fi
if need BUILD_QUESTION_SERVICE; then build_one ./backend/question-service question-service question-service; fi
if need BUILD_LLM_SERVICE; then build_one ./backend/llm-service llm-service llm-service; fi
if need BUILD_FORMATTER_SERVICE; then build_one ./backend/formatter-service formatter-service formatter-service; fi
if need BUILD_MONITORING_SERVICE; then build_one ./backend/monitoring-service monitoring-service monitoring-service; fi

if need BUILD_WEB; then
  PUB="${WEB_PUBLIC_APP_URL:-}"
  PUB="${PUB:-http://localhost:3002}"
  ADM_SITE="${WEB_ADMIN_SITE_URL:-}"
  ADM_HOSTS="${WEB_ADMIN_HOSTS:-}"
  MAIN_HOSTS="${WEB_MAIN_APP_HOSTS:-}"
  echo "Web NEXT_PUBLIC_* PUB=$PUB ADM_SITE=$ADM_SITE"
  build_one ./web web web \
    --build-arg "NEXT_PUBLIC_PUBLIC_APP_URL=${PUB}" \
    --build-arg "NEXT_PUBLIC_ADMIN_SITE_URL=${ADM_SITE}" \
    --build-arg "NEXT_PUBLIC_ADMIN_HOSTS=${ADM_HOSTS}" \
    --build-arg "NEXT_PUBLIC_MAIN_APP_HOSTS=${MAIN_HOSTS}"
fi

echo "=== Done build-push (tag ${IMAGE_TAG}) ==="
