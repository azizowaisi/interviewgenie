#!/usr/bin/env bash
# Used by Build and Deploy workflow after dorny/paths-filter. Writes GITHUB_OUTPUT.
# Env (boolean strings from GitHub): EVENT_NAME, INPUT_DEPLOY_ONLY, INPUT_FORCE_BUILD, INPUT_SKIP_TESTS
# Env: VAR_CI_FORCE_BUILD_ALL — repository Variable CI_FORCE_BUILD_ALL (true/1/yes): on push, build all eight images.
# Env: HEAD_COMMIT_MESSAGE — github.event.head_commit.message; if it contains [ci-full-build], same full matrix on push.
# Env: FILTER_* for each paths-filter output (true/false from dorny)
#
# Also writes build_matrix_slugs (JSON array) for the build-images matrix so only changed
# services spawn Docker build jobs (not all eight runners on every push).
# Writes test_matrix_services (JSON) for pytest — only backends under backend/<svc> that changed.
set -euo pipefail

write_test_matrix_to_output() {
  local json="$1"
  {
    echo "test_matrix_services<<TM_EOF"
    echo "${json}"
    echo "TM_EOF"
  } >>"${GITHUB_OUTPUT}"
}

emit_test_matrix_from_filters() {
  local json="["
  local sep=""
  if [[ "${FILTER_QUESTION_SERVICE:-false}" == "true" ]]; then json+="${sep}\"question-service\""; sep=","; fi
  if [[ "${FILTER_FORMATTER_SERVICE:-false}" == "true" ]]; then json+="${sep}\"formatter-service\""; sep=","; fi
  if [[ "${FILTER_LLM_SERVICE:-false}" == "true" ]]; then json+="${sep}\"llm-service\""; sep=","; fi
  if [[ "${FILTER_STT_SERVICE:-false}" == "true" ]]; then json+="${sep}\"stt-service\""; sep=","; fi
  if [[ "${FILTER_AUDIO_SERVICE:-false}" == "true" ]]; then json+="${sep}\"audio-service\""; sep=","; fi
  json+="]"
  write_test_matrix_to_output "${json}"
  if [[ "${json}" != "[]" ]]; then
    tests_any=true
  fi
}

write_matrix_to_output() {
  local json="$1"
  {
    echo "build_matrix_slugs<<BM_EOF"
    echo "${json}"
    echo "BM_EOF"
  } >>"${GITHUB_OUTPUT}"
}

emit_build_matrix_from_filters() {
  local json="["
  local sep=""
  if [[ "${FILTER_API_SERVICE:-false}" == "true" ]]; then json+="${sep}\"api-service\""; sep=","; fi
  if [[ "${FILTER_AUDIO_SERVICE:-false}" == "true" ]]; then json+="${sep}\"audio-service\""; sep=","; fi
  if [[ "${FILTER_STT_SERVICE:-false}" == "true" ]]; then json+="${sep}\"stt-service\""; sep=","; fi
  if [[ "${FILTER_QUESTION_SERVICE:-false}" == "true" ]]; then json+="${sep}\"question-service\""; sep=","; fi
  if [[ "${FILTER_LLM_SERVICE:-false}" == "true" ]]; then json+="${sep}\"llm-service\""; sep=","; fi
  if [[ "${FILTER_FORMATTER_SERVICE:-false}" == "true" ]]; then json+="${sep}\"formatter-service\""; sep=","; fi
  if [[ "${FILTER_MONITORING_SERVICE:-false}" == "true" ]]; then json+="${sep}\"monitoring-service\""; sep=","; fi
  if [[ "${FILTER_WEB:-false}" == "true" ]]; then json+="${sep}\"web\""; sep=","; fi
  json+="]"
  write_matrix_to_output "${json}"
}

write_build_flags() {
  local v="$1"
  echo "build_api_service=${v}" >>"${GITHUB_OUTPUT}"
  echo "build_audio_service=${v}" >>"${GITHUB_OUTPUT}"
  echo "build_stt_service=${v}" >>"${GITHUB_OUTPUT}"
  echo "build_question_service=${v}" >>"${GITHUB_OUTPUT}"
  echo "build_llm_service=${v}" >>"${GITHUB_OUTPUT}"
  echo "build_formatter_service=${v}" >>"${GITHUB_OUTPUT}"
  echo "build_monitoring_service=${v}" >>"${GITHUB_OUTPUT}"
  echo "build_web=${v}" >>"${GITHUB_OUTPUT}"
}

build_any=false
tests_any=false

# Full image + pytest matrix on push (same slugs as manual workflow force_build).
emit_push_full_matrix() {
  local note="$1"
  echo "build_any=true" >>"${GITHUB_OUTPUT}"
  write_build_flags "true"
  write_matrix_to_output '["api-service","audio-service","stt-service","question-service","llm-service","formatter-service","monitoring-service","web"]'
  echo "tests_any=true" >>"${GITHUB_OUTPUT}"
  write_test_matrix_to_output '["question-service","formatter-service","llm-service","stt-service","audio-service"]'
  {
    echo "### Detect"
    echo "- ${note}"
    echo "- **build_any:** true"
    echo "- **tests_any:** true"
    echo ""
    echo "| Path group | Changed |"
    echo "|------------|---------|"
    echo "| api-service | true |"
    echo "| audio-service | true |"
    echo "| stt-service | true |"
    echo "| question-service | true |"
    echo "| llm-service | true |"
    echo "| formatter-service | true |"
    echo "| monitoring-service | true |"
    echo "| web | true |"
    echo "| python tests (pytest services) | true |"
    echo "| **pytest matrix** | true (see test_matrix_services) |"
  } >>"${GITHUB_STEP_SUMMARY}"
}

if [[ "${EVENT_NAME}" == "workflow_dispatch" ]]; then
  if [[ "${INPUT_DEPLOY_ONLY}" == "true" ]]; then
    echo "build_any=false" >>"${GITHUB_OUTPUT}"
    echo "tests_any=false" >>"${GITHUB_OUTPUT}"
    write_build_flags "false"
    write_matrix_to_output "[]"
    write_test_matrix_to_output "[]"
    echo "### Detect" >>"${GITHUB_STEP_SUMMARY}"
    echo "- **Mode:** deploy-only (skipped tests and image builds)" >>"${GITHUB_STEP_SUMMARY}"
    exit 0
  fi
  if [[ "${INPUT_FORCE_BUILD}" == "true" ]]; then
    echo "build_any=true" >>"${GITHUB_OUTPUT}"
    write_build_flags "true"
    write_matrix_to_output '["api-service","audio-service","stt-service","question-service","llm-service","formatter-service","monitoring-service","web"]'
    tests_any=false
    if [[ "${INPUT_SKIP_TESTS}" != "true" ]]; then
      tests_any=true
      write_test_matrix_to_output '["question-service","formatter-service","llm-service","stt-service","audio-service"]'
    else
      write_test_matrix_to_output "[]"
    fi
    echo "tests_any=${tests_any}" >>"${GITHUB_OUTPUT}"
    echo "### Detect" >>"${GITHUB_STEP_SUMMARY}"
    echo "- **Mode:** manual force — build all images" >>"${GITHUB_STEP_SUMMARY}"
    echo "- **Tests:** ${tests_any}" >>"${GITHUB_STEP_SUMMARY}"
    exit 0
  fi
fi

# Push to main: full matrix if Variable CI_FORCE_BUILD_ALL or commit message contains [ci-full-build].
_force_var="$(printf '%s' "${VAR_CI_FORCE_BUILD_ALL:-}" | tr '[:upper:]' '[:lower:]' | tr -d ' \t\r\n')"
_commit_msg="${HEAD_COMMIT_MESSAGE:-}"
if [[ "${EVENT_NAME}" == "push" ]] && printf '%s' "${_commit_msg}" | grep -qF '[ci-full-build]'; then
  emit_push_full_matrix "**Mode:** commit message contains \`[ci-full-build]\` — full Docker matrix + pytest (path filters ignored for this run)."
  exit 0
fi
if [[ "${EVENT_NAME}" == "push" ]] && [[ "${_force_var}" == "true" || "${_force_var}" == "1" || "${_force_var}" == "yes" ]]; then
  emit_push_full_matrix "**Mode:** \`CI_FORCE_BUILD_ALL\` repository variable — full matrix on push. *Tip:* set variable to \`false\` or remove after this run so future pushes stay path-filtered."
  exit 0
fi

# Push to main, or manual incremental (paths-filter ran)
if [[ "${FILTER_API_SERVICE:-false}" == "true" ]]; then build_any=true; fi
if [[ "${FILTER_AUDIO_SERVICE:-false}" == "true" ]]; then build_any=true; fi
if [[ "${FILTER_STT_SERVICE:-false}" == "true" ]]; then build_any=true; fi
if [[ "${FILTER_QUESTION_SERVICE:-false}" == "true" ]]; then build_any=true; fi
if [[ "${FILTER_LLM_SERVICE:-false}" == "true" ]]; then build_any=true; fi
if [[ "${FILTER_FORMATTER_SERVICE:-false}" == "true" ]]; then build_any=true; fi
if [[ "${FILTER_MONITORING_SERVICE:-false}" == "true" ]]; then build_any=true; fi
if [[ "${FILTER_WEB:-false}" == "true" ]]; then build_any=true; fi

echo "build_api_service=${FILTER_API_SERVICE:-false}" >>"${GITHUB_OUTPUT}"
echo "build_audio_service=${FILTER_AUDIO_SERVICE:-false}" >>"${GITHUB_OUTPUT}"
echo "build_stt_service=${FILTER_STT_SERVICE:-false}" >>"${GITHUB_OUTPUT}"
echo "build_question_service=${FILTER_QUESTION_SERVICE:-false}" >>"${GITHUB_OUTPUT}"
echo "build_llm_service=${FILTER_LLM_SERVICE:-false}" >>"${GITHUB_OUTPUT}"
echo "build_formatter_service=${FILTER_FORMATTER_SERVICE:-false}" >>"${GITHUB_OUTPUT}"
echo "build_monitoring_service=${FILTER_MONITORING_SERVICE:-false}" >>"${GITHUB_OUTPUT}"
echo "build_web=${FILTER_WEB:-false}" >>"${GITHUB_OUTPUT}"

tests_any=false
emit_test_matrix_from_filters
# If paths were added only under python_tests (not per-service) later, still run all five.
if [[ "${FILTER_PYTHON_TESTS:-false}" == "true" ]] && [[ "${tests_any}" != "true" ]]; then
  tests_any=true
  write_test_matrix_to_output '["question-service","formatter-service","llm-service","stt-service","audio-service"]'
fi

echo "build_any=${build_any}" >>"${GITHUB_OUTPUT}"
echo "tests_any=${tests_any}" >>"${GITHUB_OUTPUT}"

if [[ "${build_any}" == "true" ]]; then
  emit_build_matrix_from_filters
else
  write_matrix_to_output "[]"
fi

{
  echo "### Detect"
  echo "- **build_any:** ${build_any}"
  echo "- **tests_any:** ${tests_any}"
  echo ""
  echo "| Path group | Changed |"
  echo "|------------|---------|"
  echo "| api-service | ${FILTER_API_SERVICE:-n/a} |"
  echo "| audio-service | ${FILTER_AUDIO_SERVICE:-n/a} |"
  echo "| stt-service | ${FILTER_STT_SERVICE:-n/a} |"
  echo "| question-service | ${FILTER_QUESTION_SERVICE:-n/a} |"
  echo "| llm-service | ${FILTER_LLM_SERVICE:-n/a} |"
  echo "| formatter-service | ${FILTER_FORMATTER_SERVICE:-n/a} |"
  echo "| monitoring-service | ${FILTER_MONITORING_SERVICE:-n/a} |"
  echo "| web | ${FILTER_WEB:-n/a} |"
  echo "| python tests (pytest services) | ${FILTER_PYTHON_TESTS:-n/a} |"
  echo "| **pytest matrix** | ${tests_any} (see test_matrix_services) |"
} >>"${GITHUB_STEP_SUMMARY}"
