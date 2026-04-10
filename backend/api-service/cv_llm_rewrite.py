from __future__ import annotations

import json
from typing import Any

from cv_docx_optimizer import call_llm_generate, parse_llm_json_object


def build_summary_rewrite_prompt(*, base_cv: dict[str, Any], job_description: str, summary_rules: dict[str, Any]) -> str:
    jd = (job_description or "").strip()
    cv_s = json.dumps(
        {
            "name": (base_cv.get("name") or "").strip(),
            "summary": base_cv.get("summary") or "",
            "skills": base_cv.get("skills") or [],
        },
        ensure_ascii=False,
        indent=2,
    )
    fmt = (summary_rules.get("format") or "years + strongest stack + business impact") if isinstance(summary_rules, dict) else "years + strongest stack + business impact"
    max_lines = summary_rules.get("max_lines") if isinstance(summary_rules, dict) else None
    try:
        max_lines_i = int(max_lines) if max_lines is not None else 3
    except Exception:
        max_lines_i = 3

    return f"""Rewrite ONLY the professional summary in a concise ATS-friendly way.

Job description:
---
{jd}
---

Base CV (JSON):
---
{cv_s}
---

Constraints:
- {fmt}
- Max {max_lines_i} lines
- Keep it truthful; do not invent facts
- Avoid fluff and generic claims

Return ONLY valid JSON (no markdown) with this exact shape:
{{"summary":"..."}}
"""


async def rewrite_summary(
    *,
    base_cv: dict[str, Any],
    job_description: str,
    summary_rules: dict[str, Any],
    llm_service_url: str,
    timeout: float,
) -> str:
    prompt = build_summary_rewrite_prompt(base_cv=base_cv, job_description=job_description, summary_rules=summary_rules)
    import asyncio

    async with asyncio.timeout(timeout):
        raw = await call_llm_generate(prompt, llm_service_url, timeout=timeout)
    if not raw:
        return (base_cv.get("summary") or "").strip()
    try:
        obj = parse_llm_json_object(raw)
        s = obj.get("summary")
        if isinstance(s, str) and s.strip():
            return s.strip()
    except Exception:
        pass
    return (base_cv.get("summary") or "").strip()


def build_bullets_rewrite_prompt(
    *,
    role: str,
    company: str,
    bullets: list[str],
    job_description: str,
    bullet_rules: dict[str, Any],
) -> str:
    jd = (job_description or "").strip()
    br = bullet_rules if isinstance(bullet_rules, dict) else {}
    fmt = (br.get("format") or "action + scope + metric").strip()
    require_metric = bool(br.get("require_metric", True))

    payload = {
        "role": (role or "").strip(),
        "company": (company or "").strip(),
        "bullets": [b.strip() for b in bullets if isinstance(b, str) and b.strip()],
    }
    bullets_s = json.dumps(payload, ensure_ascii=False, indent=2)

    metric_rule = "Require a metric in every bullet (only if implied by original; do not invent numbers)" if require_metric else "Metrics optional"

    return f"""Rewrite the bullets to be ATS-friendly and high impact.

Job description:
---
{jd}
---

Experience entry (JSON):
---
{bullets_s}
---

Rules:
- Format: {fmt}
- {metric_rule}
- Keep it truthful; do not add tools/achievements not supported by the original bullet
- Keep each bullet one line; start with a strong action verb

Return ONLY valid JSON (no markdown) with this exact shape:
{{"bullets":["...","..."]}}
"""


async def rewrite_bullets_batch(
    *,
    role: str,
    company: str,
    bullets: list[str],
    job_description: str,
    bullet_rules: dict[str, Any],
    llm_service_url: str,
    timeout: float,
) -> list[str]:
    src = [b.strip() for b in bullets if isinstance(b, str) and b.strip()]
    if not src:
        return []
    prompt = build_bullets_rewrite_prompt(
        role=role,
        company=company,
        bullets=src,
        job_description=job_description,
        bullet_rules=bullet_rules,
    )
    import asyncio

    async with asyncio.timeout(timeout):
        raw = await call_llm_generate(prompt, llm_service_url, timeout=timeout)
    if not raw:
        return src
    try:
        obj = parse_llm_json_object(raw)
        out = obj.get("bullets")
        if isinstance(out, list):
            cleaned = [str(b).strip() for b in out if str(b).strip()]
            if cleaned:
                return cleaned
    except Exception:
        pass
    return src

