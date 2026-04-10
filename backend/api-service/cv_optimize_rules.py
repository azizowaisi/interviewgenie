from __future__ import annotations

import json
import re
from typing import Any, TypedDict


class SummaryRules(TypedDict, total=False):
    format: str
    max_lines: int


class BulletRules(TypedDict, total=False):
    format: str
    require_metric: bool


class SkillsRules(TypedDict, total=False):
    grouping: list[str]
    prioritize: list[str]


class OptimizeRules(TypedDict, total=False):
    missing_skills: list[str]
    keyword_phrases: list[str]
    summary_rules: SummaryRules
    bullet_rules: BulletRules
    skills_rules: SkillsRules


def build_rules_prompt(base_cv: dict[str, Any], job_description: str) -> str:
    cv_s = json.dumps(base_cv, ensure_ascii=False, indent=2)
    jd = (job_description or "").strip()
    return f"""You are an ATS resume optimizer.

Job description:
---
{jd}
---

Base CV (structured JSON):
---
{cv_s}
---

Task:
Return ONLY valid JSON (no markdown, no prose) with ATS optimization rules.

Rules MUST be conservative and truthful:
- Do NOT invent companies, dates, degrees, certifications, projects, or skills not supported by the CV.
- "missing_skills" should be skills that plausibly exist in the CV but are not explicitly listed in the skills section.
- "keyword_phrases" should be short ATS phrases from the job description that the CV could reasonably support.

Return JSON with this exact shape:
{{
  "missing_skills": ["..."],
  "keyword_phrases": ["..."],
  "summary_rules": {{
    "format": "years + strongest stack + business impact",
    "max_lines": 3
  }},
  "bullet_rules": {{
    "format": "action + scope + metric",
    "require_metric": true
  }},
  "skills_rules": {{
    "grouping": ["Languages", "Frameworks", "Cloud/DevOps", "Data", "Testing"],
    "prioritize": ["AI", "CI/CD", "Docker", "Node", "REST", "SQL"]
  }}
}}
"""


_WS_RE = re.compile(r"\s+")


def _cv_text_blob(cv: dict[str, Any]) -> str:
    parts: list[str] = []
    for k in ("name", "summary"):
        v = cv.get(k)
        if isinstance(v, str) and v.strip():
            parts.append(v.strip())
    skills = cv.get("skills") or []
    if isinstance(skills, list):
        parts.extend([str(s) for s in skills if str(s).strip()])
    parts.extend(_experience_text_parts(cv.get("experience")))
    return _WS_RE.sub(" ", " ".join(parts)).strip().lower()


def _experience_text_parts(experience: Any) -> list[str]:
    if not isinstance(experience, list):
        return []
    parts: list[str] = []
    for e in experience:
        if not isinstance(e, dict):
            continue
        for k in ("role", "company"):
            v = e.get(k)
            if isinstance(v, str) and v.strip():
                parts.append(v.strip())
        bullets = e.get("bullets") or []
        if isinstance(bullets, list):
            parts.extend([str(b) for b in bullets if str(b).strip()])
    return parts


def _normalize_skill(s: str) -> str:
    return _WS_RE.sub(" ", (s or "").strip())


def _dedupe_skills(skills_in: Any) -> tuple[list[str], set[str]]:
    skills: list[str] = []
    seen: set[str] = set()
    if not isinstance(skills_in, list):
        return skills, seen
    for s in skills_in:
        ns = _normalize_skill(str(s))
        key = ns.lower()
        if not ns or key in seen:
            continue
        seen.add(key)
        skills.append(ns)
    return skills, seen


def _add_missing_skills_conservative(
    *,
    skills: list[str],
    seen: set[str],
    missing_skills: Any,
    cv_blob_lower: str,
) -> None:
    if not isinstance(missing_skills, list):
        return
    for s in missing_skills:
        ns = _normalize_skill(str(s))
        if not ns:
            continue
        key = ns.lower()
        if key in seen:
            continue
        if key and key in cv_blob_lower:
            seen.add(key)
            skills.append(ns)


def _prioritized_skill_sort(skills: list[str], prioritize: Any) -> list[str]:
    if not isinstance(prioritize, list):
        prioritize = []
    pr = [str(x).strip() for x in prioritize if str(x).strip()]
    pr_l = [x.lower() for x in pr]

    def sort_key(s: str) -> tuple[int, str]:
        sl = s.lower()
        try:
            i = pr_l.index(sl)
            return (0, f"{i:04d}")
        except ValueError:
            for i, p in enumerate(pr_l):
                if sl.startswith(p + " "):
                    return (0, f"{i:04d}")
            return (1, sl)

    return sorted(skills, key=sort_key)


def apply_rules(base_cv: dict[str, Any], rules: OptimizeRules) -> dict[str, Any]:
    """Deterministically apply ATS rules to the structured CV.

    This intentionally avoids rewriting long-form prose; use LLM rewrites for summary/bullets only.
    """
    out = {
        "name": (base_cv.get("name") or "").strip(),
        "summary": base_cv.get("summary") or "",
        "experience": base_cv.get("experience") or [],
        "skills": base_cv.get("skills") or [],
    }

    cv_blob = _cv_text_blob(base_cv)

    skills, seen = _dedupe_skills(out.get("skills"))
    _add_missing_skills_conservative(
        skills=skills,
        seen=seen,
        missing_skills=rules.get("missing_skills"),
        cv_blob_lower=cv_blob,
    )

    prioritize = ((rules.get("skills_rules") or {}).get("prioritize") or []) if isinstance(rules.get("skills_rules"), dict) else []
    out["skills"] = _prioritized_skill_sort(skills, prioritize)
    return out

