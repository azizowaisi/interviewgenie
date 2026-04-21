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
    # Optional incremental rewrite hints (if absent, pipeline rewrites everything like before).
    rewrite_summary: bool
    rewrite_experience_indices: list[int]


def format_ats_hints_for_prompt(ats_hints: Any) -> str:
    """Human-readable block from stored /ats/analyze output (same content as ATS page)."""
    if not isinstance(ats_hints, dict):
        return ""
    lines: list[str] = []
    sk = ats_hints.get("suggested_skills_to_add")
    if isinstance(sk, list):
        flat = [str(x).strip() for x in sk if str(x).strip()]
        if flat:
            lines.append("Suggested skills to add (if accurate): " + ", ".join(flat[:24]))
    for key, title in (
        ("professional_summary_suggestions", "Professional summary guidance"),
        ("skills_section_suggestions", "Skills section guidance"),
        ("experience_suggestions", "Experience bullet rewrite guidance"),
    ):
        v = ats_hints.get(key)
        if not isinstance(v, list):
            continue
        bullets = [str(item).strip() for item in v if str(item).strip()]
        if bullets:
            lines.append(title + ":\n" + "\n".join(f"- {b}" for b in bullets))

    # Targeted per-entry guidance (preferred, reusable for partial rewrites).
    ees = ats_hints.get("experience_entry_suggestions") if isinstance(ats_hints, dict) else None
    if isinstance(ees, list) and ees:
        blocks: list[str] = []
        for it in ees[:8]:
            if not isinstance(it, dict):
                continue
            idx = it.get("index")
            try:
                idx_i = int(idx)
            except Exception:
                continue
            role = str(it.get("role") or "").strip()
            company = str(it.get("company") or "").strip()
            header = f"Experience entry #{idx_i}" + (f" — {role}" if role else "") + (f" @ {company}" if company else "")
            reasons = it.get("reasons")
            guidance = it.get("guidance")
            r_lines = [str(x).strip() for x in (reasons or []) if str(x).strip()] if isinstance(reasons, list) else []
            g_lines = [str(x).strip() for x in (guidance or []) if str(x).strip()] if isinstance(guidance, list) else []
            body_parts: list[str] = []
            if r_lines:
                body_parts.append("Reasons:\n" + "\n".join(f"- {x}" for x in r_lines[:6]))
            if g_lines:
                body_parts.append("How to rewrite:\n" + "\n".join(f"- {x}" for x in g_lines[:6]))
            if body_parts:
                blocks.append(header + ":\n" + "\n".join(body_parts))
        if blocks:
            lines.append("Targeted experience entry guidance:\n" + "\n\n".join(blocks))
    if not lines:
        return ""
    return (
        "\n\n---\nPrior ATS analysis for this job (same as on the ATS page). "
        "Your JSON rules and implied rewrites MUST reflect this guidance wherever the CV already supports it. "
        "Do not invent employers, dates, or skills with no evidence in the CV.\n\n"
        + "\n\n".join(lines)
    )


def build_rules_prompt(base_cv: dict[str, Any], job_description: str, ats_hints: Any | None = None) -> str:
    def _compact_cv_for_rules_prompt(cv: dict[str, Any]) -> dict[str, Any]:
        exp_in = cv.get("experience") if isinstance(cv.get("experience"), list) else []
        exp_out: list[dict[str, Any]] = []
        for i, e in enumerate(exp_in):
            if i >= 12:
                break
            if not isinstance(e, dict):
                continue
            bullets = e.get("bullets") if isinstance(e.get("bullets"), list) else []
            b_out: list[str] = []
            for b in bullets[:6]:
                if not isinstance(b, str):
                    continue
                s = b.strip()
                if not s:
                    continue
                b_out.append(s[:220])
            exp_out.append(
                {
                    "role": str(e.get("role") or "")[:120],
                    "company": str(e.get("company") or "")[:120],
                    "bullets": b_out,
                }
            )
        skills = cv.get("skills") if isinstance(cv.get("skills"), list) else []
        skills_out = [str(s).strip()[:60] for s in skills if str(s).strip()][:60]
        return {
            "name": (cv.get("name") or "")[:120],
            "summary": (cv.get("summary") or "")[:900],
            "skills": skills_out,
            "experience": exp_out,
        }

    cv_s = json.dumps(_compact_cv_for_rules_prompt(base_cv), ensure_ascii=False)
    jd = (job_description or "").strip()
    ats_block = format_ats_hints_for_prompt(ats_hints)
    return f"""You are an ATS resume optimizer.

Job description:
---
{jd}
---

Base CV (structured JSON; compacted for speed):
---
{cv_s}
---
{ats_block}

Task:
Return ONLY valid JSON (no markdown, no prose) with ATS optimization rules AND incremental rewrite hints.

Incremental rewrite hints (critical):
- Your goal is to MINIMIZE LLM rewrites to save time.
- Set "rewrite_summary" to false if the current summary already meets the summary_rules format and is already ATS-aligned with the job description and prior ATS analysis guidance (without inventing facts).
- Set "rewrite_experience_indices" to ONLY the experience entries that truly need bullet rewrites. If an entry is already concise, action-led, tech-specific, and aligned to the JD, DO NOT include its index.
- Only include an experience index if at least one of these is true:
  - bullets are too long / multi-sentence / not one-line
  - bullets are vague (no action + scope) or generic
  - important technologies/tools already present in that entry are not surfaced clearly in bullets (ATS match risk)
  - prior ATS analysis experience guidance indicates a fix applicable to that entry
  - the entry contains relevant capability but wording is mismatched vs the job description (synonym/phrase alignment), WITHOUT inventing anything
- Do NOT include indices just because they exist. Prefer 0–3 indices when possible.

Rules MUST be truthful:
- Do NOT invent companies, dates, degrees, certifications, or employers.
- **missing_skills (critical):** Exhaustively scan summary, every experience bullet, role titles, and company context. List every notable **tool, language, framework, database, cloud product, protocol, or platform** that is clearly used or implied in the CV text but is **missing, abbreviated, or only buried in bullets** and not reflected in the skills array. Prefer wording that appears in the CV (e.g. if bullets say "Postgres", include "PostgreSQL" only if that capability is clearly the same thing described in the CV). **Do not omit** a skill the candidate clearly has in the narrative just because it is not in the skills list today. **When the prior ATS analysis lists a suggested skill and the CV text supports it, include it in missing_skills or keyword_phrases.**
- **keyword_phrases:** Short ATS phrases (2–5 words) aligned with the job description **only when** the CV already demonstrates that capability (same rules as skills). Use for synonyms (e.g. job says "CI/CD" and CV says "pipelines/GitHub Actions"). Prefer exact job-description wording when the CV supports it (e.g. "REST APIs").

Return JSON with this exact shape:
{{
  "missing_skills": ["..."],
  "keyword_phrases": ["..."],
  "rewrite_summary": true,
  "rewrite_experience_indices": [0,2,5],
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


_TOKEN_RE = re.compile(r"[a-z0-9]+", re.I)


def _skill_supported_by_cv_text(skill_norm: str, cv_blob_lower: str) -> bool:
    """True if the skill is evidenced in the CV (substring or all significant tokens)."""
    key = skill_norm.lower()
    if not key:
        return False
    if key in cv_blob_lower:
        return True
    # Slash/stack names: "ci/cd", "node.js"
    flat = re.sub(r"[^a-z0-9]+", "", key)
    if len(flat) >= 3 and flat in re.sub(r"[^a-z0-9]+", "", cv_blob_lower):
        return True
    tokens = [t.lower() for t in _TOKEN_RE.findall(skill_norm)]
    tokens = [t for t in tokens if len(t) >= 2]
    if not tokens:
        return False
    return all(t in cv_blob_lower for t in tokens)


def _add_missing_skills_from_rules(
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
        if _skill_supported_by_cv_text(ns, cv_blob_lower):
            seen.add(key)
            skills.append(ns)


def _merge_keyword_phrases_as_skills(
    *,
    skills: list[str],
    seen: set[str],
    keyword_phrases: Any,
    cv_blob_lower: str,
    max_phrases: int = 12,
) -> None:
    if not isinstance(keyword_phrases, list):
        return
    for i, p in enumerate(keyword_phrases):
        if i >= max_phrases:
            break
        ns = _normalize_skill(str(p))
        if not ns or len(ns) > 60:
            continue
        key = ns.lower()
        if key in seen:
            continue
        if _skill_supported_by_cv_text(ns, cv_blob_lower):
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


def _add_ats_suggested_skills(
    *,
    skills: list[str],
    seen: set[str],
    ats_hints: Any,
    cv_blob_lower: str,
) -> None:
    if not isinstance(ats_hints, dict):
        return
    raw = ats_hints.get("suggested_skills_to_add")
    if not isinstance(raw, list):
        return
    for s in raw:
        ns = _normalize_skill(str(s))
        if not ns:
            continue
        key = ns.lower()
        if key in seen:
            continue
        if _skill_supported_by_cv_text(ns, cv_blob_lower):
            seen.add(key)
            skills.append(ns)


def merge_rule_skills_into_cv(cv: dict[str, Any], rules: OptimizeRules, ats_hints: Any | None = None) -> None:
    """Append skills from rules if supported by the current CV text (e.g. after bullet rewrites)."""
    cv_blob = _cv_text_blob(cv)
    skills, seen = _dedupe_skills(cv.get("skills"))
    _add_missing_skills_from_rules(
        skills=skills,
        seen=seen,
        missing_skills=rules.get("missing_skills"),
        cv_blob_lower=cv_blob,
    )
    _merge_keyword_phrases_as_skills(
        skills=skills,
        seen=seen,
        keyword_phrases=rules.get("keyword_phrases"),
        cv_blob_lower=cv_blob,
    )
    _add_ats_suggested_skills(skills=skills, seen=seen, ats_hints=ats_hints, cv_blob_lower=cv_blob)
    prioritize = ((rules.get("skills_rules") or {}).get("prioritize") or []) if isinstance(rules.get("skills_rules"), dict) else []
    cv["skills"] = _prioritized_skill_sort(skills, prioritize)


def apply_rules(base_cv: dict[str, Any], rules: OptimizeRules, ats_hints: Any | None = None) -> dict[str, Any]:
    """Deterministically apply ATS rules to the structured CV.

    This intentionally avoids rewriting long-form prose; use LLM rewrites for summary/bullets only.
    """
    edu = base_cv.get("education")
    out = {
        "name": (base_cv.get("name") or "").strip(),
        "summary": base_cv.get("summary") or "",
        "experience": base_cv.get("experience") or [],
        "skills": base_cv.get("skills") or [],
        "education": edu if isinstance(edu, list) else [],
    }

    merge_rule_skills_into_cv(out, rules, ats_hints)
    return out

