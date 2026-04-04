#!/usr/bin/env bash
# Undo one revision on Deployments stuck on bad image tags (ImagePullBackOff, ErrImagePull)
# or split rollouts (old pod Running + new pod Pending for a long time).
#
# Run on the k3s node (or anywhere with kubeconfig), from repo root or synced tree:
#   ./scripts/k8s-recover-stuck-rollouts.sh           # dry-run: print what would run
#   ./scripts/k8s-recover-stuck-rollouts.sh --apply   # actually kubectl rollout undo
#
# Does not change mongo / ollama unless they match the same stuck pattern (usually skip).
set -euo pipefail

NS="${K8S_NAMESPACE:-interview-ai}"
APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

DEPS=(
  api-service
  audio-service
  stt-service
  question-service
  llm-service
  formatter-service
  monitoring-service
  web
)
  DEPS=(
    api-service
    audio-service
    cv-parser-service
    stt-service
    question-service
    llm-service
    formatter-service
    monitoring-service
    web
  )
  local n
  n="$(echo "$lines" | wc -l | tr -d ' ')"
  statuses="$(echo "$lines" | awk '{print $3}')"

  if echo "$statuses" | grep -qE 'ImagePullBackOff|ErrImagePull|InvalidImageName'; then
    return 0
  fi
  # Two (or more) pods: typical failed surge rollout — new stuck Pending / pull.
  if [[ "$n" -ge 2 ]] && echo "$statuses" | grep -qE 'Pending|ImagePull|ErrImage|Init:'; then
    return 0
  fi
  # Single pod never became Ready
  if [[ "$n" -eq 1 ]] && echo "$statuses" | grep -qE 'Pending|ImagePull|ErrImage'; then
    return 0
  fi
  return 1
}

echo "=== Namespace: $NS (recover stuck rollouts) ==="
if ! kubectl get ns "$NS" &>/dev/null; then
  echo "Namespace $NS not found." >&2
  exit 1
fi

any=false
for dep in "${DEPS[@]}"; do
  if should_undo "$dep"; then
    any=true
    if [[ "$APPLY" == true ]]; then
      echo "Applying: kubectl rollout undo deployment/$dep -n $NS"
      kubectl rollout undo "deployment/$dep" -n "$NS" || echo "WARN: undo failed for $dep" >&2
    else
      echo "Would run: kubectl rollout undo deployment/$dep -n $NS"
    fi
  fi
done

if [[ "$any" == false ]]; then
  echo "No matching stuck deployments (by pod status). Nothing to do."
  echo "If a pod is still wrong, inspect: kubectl describe pod -n $NS <name>"
elif [[ "$APPLY" == false ]]; then
  echo ""
  echo "Dry run only. To roll back, run:"
  echo "  $0 --apply"
fi
