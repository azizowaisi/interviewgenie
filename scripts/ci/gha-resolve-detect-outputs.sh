#!/usr/bin/env bash
# Used by Build and Deploy workflow after dorny/paths-filter. Writes GITHUB_OUTPUT.
# Env (boolean strings from GitHub): EVENT_NAME, INPUT_DEPLOY_ONLY, INPUT_FORCE_BUILD, INPUT_SKIP_TESTS
# Env: FILTER_* for each paths-filter output (true/false from dorny)
set -euo pipefail

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

if [[ "${EVENT_NAME}" == "workflow_dispatch" ]]; then
  if [[ "${INPUT_DEPLOY_ONLY}" == "true" ]]; then
    echo "build_any=false" >>"${GITHUB_OUTPUT}"
    echo "tests_any=false" >>"${GITHUB_OUTPUT}"
    write_build_flags "false"
    echo "### Detect" >>"${GITHUB_STEP_SUMMARY}"
    echo "- **Mode:** deploy-only (skipped tests and image builds)" >>"${GITHUB_STEP_SUMMARY}"
    exit 0
  fi
  if [[ "${INPUT_FORCE_BUILD}" == "true" ]]; then
    echo "build_any=true" >>"${GITHUB_OUTPUT}"
    write_build_flags "true"
    if [[ "${INPUT_SKIP_TESTS}" != "true" ]]; then
      tests_any=true
    fi
    echo "tests_any=${tests_any}" >>"${GITHUB_OUTPUT}"
    echo "### Detect" >>"${GITHUB_STEP_SUMMARY}"
    echo "- **Mode:** manual force — build all images" >>"${GITHUB_STEP_SUMMARY}"
    echo "- **Tests:** ${tests_any}" >>"${GITHUB_STEP_SUMMARY}"
    exit 0
  fi
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

if [[ "${FILTER_PYTHON_TESTS:-false}" == "true" ]]; then tests_any=true; fi

echo "build_any=${build_any}" >>"${GITHUB_OUTPUT}"
echo "tests_any=${tests_any}" >>"${GITHUB_OUTPUT}"

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
} >>"${GITHUB_STEP_SUMMARY}"
