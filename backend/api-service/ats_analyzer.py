"""
Simple ATS-style analyzer: compare CV text vs job description.
Extracts keywords/skills via word tokenization and common tech terms; computes match scores.
"""
import re

# Common tech/skill terms to boost extraction (lowercase)
COMMON_SKILLS = {
    "python", "java", "javascript", "typescript", "go", "golang", "rust", "kotlin", "scala",
    "react", "angular", "vue", "node", "nodejs", "spring", "django", "fastapi", "flask",
    "aws", "azure", "gcp", "kubernetes", "k8s", "docker", "terraform", "ansible",
    "sql", "nosql", "mongodb", "postgresql", "redis", "kafka", "rabbitmq",
    "microservices", "rest", "graphql", "grpc", "ci/cd", "jenkins", "github", "gitlab",
    "machine learning", "ml", "ai", "nlp", "tensorflow", "pytorch",
    "agile", "scrum", "jira", "leadership", "mentoring",
}

# Generic words that frequently appear in job descriptions but are not useful skill suggestions.
NOISE_WORDS = {
    "a", "an", "and", "any", "all", "also", "about", "able", "added", "accident",
    "after", "again", "against", "along", "already", "app", "application", "appwebsite",
    "are", "as", "at", "be", "because", "before", "being", "between", "by", "can",
    "candidate", "company", "clients", "collaborate", "communication", "create", "day", "days",
    "design", "develop", "do", "done", "each", "etc", "for", "from", "full", "good",
    "great", "have", "help", "high", "if", "in", "into", "is", "it", "its", "job",
    "knowledge", "level", "like", "must", "need", "new", "of", "on", "one", "or", "other",
    "our", "out", "over", "people", "plus", "product", "project", "projects", "required",
    "role", "skills", "so", "some", "strong", "team", "teams", "that", "the", "their",
    "them", "there", "these", "this", "to", "tools", "using", "very", "we", "well", "with",
    "work", "worked", "working", "you", "your", "ads", "agencies", "aircraft", "airlines", "airports",
}


def _looks_like_meaningful_skill_token(token: str) -> bool:
    """Return True when token is likely a concrete skill keyword, not filler text."""
    t = (token or "").strip().lower().replace("_", " ")
    if not t:
        return False
    # Reject purely numeric chunks like "000".
    if re.fullmatch(r"\d+", t):
        return False
    # Reject one-character noise and common filler words.
    if len(t) <= 2 or t in NOISE_WORDS:
        return False

    base = t.replace(" ", "_")
    if base in COMMON_SKILLS:
        return True

    # For unknown terms, require stronger signal than plain words.
    # Accept terms that look technical (contains dot/slash/plus/hash) or multiword with decent length.
    if any(ch in t for ch in (".", "/", "+", "#")):
        return True
    if " " in t and len(t) >= 6:
        return True
    return False


def _normalize(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text.lower().strip())


def _tokenize(text: str) -> set:
    """Simple tokenization: words (alphanumeric + allowed punctuation) and bigrams for known skills."""
    norm = _normalize(text)
    # Words: letters, numbers, dots, slashes (e.g. CI/CD, Node.js)
    words = set(re.findall(r"[a-z0-9]+(?:\.[a-z0-9]+)?(?:\/[a-z0-9]+)?", norm))
    # Add multi-word skills that appear in text
    for skill in COMMON_SKILLS:
        if skill in norm:
            words.add(skill.replace(" ", "_"))
    return words


def _extract_phrases(text: str, max_len: int = 4) -> set:
    """Extract short phrases (2–4 words) that might be skills or requirements."""
    norm = _normalize(text)
    words = re.findall(r"[a-z0-9]+(?:\.[a-z0-9]+)?", norm)
    out = set()
    for n in range(2, min(max_len + 1, len(words) + 1)):
        for i in range(len(words) - n + 1):
            out.add("_".join(words[i : i + n]))
    return out


def _skill_label(raw: str) -> str:
    s = (raw or "").replace("_", " ").strip()
    return s.title() if s else ""


def _role_hint(jd_text: str) -> str:
    first_line = (jd_text or "").strip().splitlines()[0] if (jd_text or "").strip() else ""
    compact = re.sub(r"\s+", " ", first_line)
    if not compact:
        return "the target role"
    return compact[:80]


def _build_professional_summary_suggestions(role_hint: str, top_skills: list[str]) -> list[str]:
    skills_text = ", ".join(top_skills[:4]) if top_skills else "the required stack"
    return [
        "Use 2-3 lines with this order: years/domain + strongest stack + business impact.",
        f"Example: Results-oriented candidate targeting {role_hint}, experienced in {skills_text}, with a track record of shipping reliable features and improving team delivery metrics.",
        "Avoid generic text such as 'hardworking' or 'team player' without proof. Include one concrete outcome.",
    ]


def _build_skills_section_suggestions(missing: list[str], matched: list[str]) -> list[str]:
    missing_text = ", ".join(missing[:8]) if missing else "job-specific tools and frameworks"
    matched_text = ", ".join(matched[:6]) if matched else "your strongest technologies"
    return [
        "Split skills into groups: Languages, Frameworks, Cloud/DevOps, Data, and Testing.",
        f"Keep matched skills visible near the top: {matched_text}.",
        f"Add missing job keywords only when true for your profile: {missing_text}.",
        "Use exact job-description wording for ATS (for example: 'REST APIs' instead of only 'API').",
    ]


def _build_experience_suggestions(top_skills: list[str]) -> list[str]:
    skill_text = ", ".join(top_skills[:3]) if top_skills else "the required stack"
    return [
        "Write bullets with action + scope + metric (what you did, where, and measurable result).",
        f"Example rewrite: 'Built backend services' -> 'Built and deployed {skill_text}-based services used by 50k+ monthly users, reducing API latency by 35%'.",
        "Add one impact metric per bullet: latency, conversion, uptime, delivery time, revenue, or cost savings.",
        "Prioritize recent and role-relevant bullets first; keep older unrelated details short.",
    ]


def compute_ats(
    cv_text: str,
    jd_text: str,
) -> dict:
    """
    Compare CV and job description; return match scores and missing skills.
    Returns dict with: overall_score, skill_match, keyword_match, experience_match, tech_match, missing_skills.
    """
    cv_text = (cv_text or "").strip()
    jd_text = (jd_text or "").strip()
    if not cv_text or not jd_text:
        return {
            "overall_score": 0,
            "skill_match": 0,
            "keyword_match": 0,
            "experience_match": 0,
            "tech_match": 0,
            "missing_skills": [],
        }

    cv_words = _tokenize(cv_text)
    jd_words = _tokenize(jd_text)
    cv_phrases = _extract_phrases(cv_text)
    jd_phrases = _extract_phrases(jd_text)

    # Keyword match: how many JD keywords appear in CV (by word)
    jd_only = jd_words - cv_words
    keyword_match = (
        round(100 * (len(jd_words - jd_only) / len(jd_words))) if jd_words else 0
    )

    # Skill match: overlap of known skills and important-looking tokens (longer words)
    jd_skill_like = {w for w in jd_words if len(w) > 2 or w in COMMON_SKILLS}
    cv_skill_like = {w for w in cv_words if len(w) > 2 or w in COMMON_SKILLS}
    missing_skill_tokens = jd_skill_like - cv_skill_like
    skill_match = (
        round(100 * (len(jd_skill_like - missing_skill_tokens) / len(jd_skill_like)))
        if jd_skill_like else 0
    )

    # Tech match: COMMON_SKILLS in JD that appear in CV
    jd_tech = {s for s in COMMON_SKILLS if s in _normalize(jd_text)}
    cv_tech = {s for s in COMMON_SKILLS if s in _normalize(cv_text)}
    missing_tech = jd_tech - cv_tech
    tech_match = round(100 * (len(jd_tech - missing_tech) / len(jd_tech))) if jd_tech else 0

    # Experience match: heuristic from phrase overlap (e.g. "5 years", "led team")
    jd_phrase_in_cv = len(jd_phrases & cv_phrases)
    experience_match = (
        min(100, round(100 * jd_phrase_in_cv / max(1, len(jd_phrases) // 2)))
        if jd_phrases else 0
    )

    # Missing skills: prefer known tech terms, then other JD-only tokens (short list)
    missing_skills = []
    seen = set()
    for s in sorted(missing_tech):
        label = s.replace("_", " ").strip()
        if not _looks_like_meaningful_skill_token(label):
            continue
        lower = label.lower()
        if lower in seen:
            continue
        seen.add(lower)
        missing_skills.append(label.title())

    for w in sorted(missing_skill_tokens):
        label = w.replace("_", " ").strip()
        if not _looks_like_meaningful_skill_token(label):
            continue
        lower = label.lower()
        if lower in seen:
            continue
        seen.add(lower)
        missing_skills.append(label.title())
        if len(missing_skills) >= 15:
            break

    matched_skills = sorted([_skill_label(s) for s in (jd_tech & cv_tech)])
    suggested_skills = missing_skills[:8]
    role_hint = _role_hint(jd_text)

    professional_summary_suggestions = _build_professional_summary_suggestions(role_hint, suggested_skills)
    skills_section_suggestions = _build_skills_section_suggestions(suggested_skills, matched_skills)
    experience_suggestions = _build_experience_suggestions(suggested_skills)

    # Overall: weighted average
    overall = round(
        (keyword_match * 0.35 + skill_match * 0.25 + tech_match * 0.25 + experience_match * 0.15)
    )
    overall = min(100, max(0, overall))

    return {
        "overall_score": overall,
        "skill_match": min(100, skill_match),
        "keyword_match": min(100, keyword_match),
        "experience_match": min(100, experience_match),
        "tech_match": min(100, tech_match),
        "missing_skills": missing_skills[:15],
        "suggested_skills_to_add": suggested_skills,
        "professional_summary_suggestions": professional_summary_suggestions,
        "skills_section_suggestions": skills_section_suggestions,
        "experience_suggestions": experience_suggestions,
    }


_DIGIT_RE = re.compile(r"\d")


def compute_experience_entry_suggestions(*, cv_structure: dict, jd_text: str, missing_skills: list[str] | None = None) -> list[dict]:
    """Create targeted suggestions for specific experience entries.

    Output is designed to be:
    - actionable on the ATS page
    - directly reusable by the CV optimizer (rewrite only these indices)
    """
    if not isinstance(cv_structure, dict):
        return []
    exp = cv_structure.get("experience")
    exp_list = exp if isinstance(exp, list) else []
    if not exp_list:
        return []

    jd_norm = _normalize(jd_text or "")
    jd_tokens = _tokenize(jd_norm)
    missing = [str(x).strip() for x in (missing_skills or []) if str(x).strip()]
    missing_l = [m.lower() for m in missing]

    jd_has_metrics_language = any(x in jd_norm for x in ("%", "percent", "reduced", "increased", "improved", "grew"))

    out: list[dict] = []
    for i, item in enumerate(exp_list):
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        company = str(item.get("company") or "").strip()
        bullets = item.get("bullets") if isinstance(item.get("bullets"), list) else []
        bullets_s = [str(b).strip() for b in bullets if isinstance(b, str) and str(b).strip()]
        if not bullets_s:
            continue

        blob = _normalize(" ".join([role, company] + bullets_s))
        blob_tokens = _tokenize(blob)

        reasons: list[str] = []
        guidance: list[str] = []

        if any(len(b) > 170 for b in bullets_s):
            reasons.append("Bullets are too long for ATS scanning")
            guidance.append("Split long bullets into 1-line bullets; keep one idea per bullet.")
        if any(b.count(".") >= 2 for b in bullets_s):
            reasons.append("Bullets read like paragraphs (multi-sentence)")
            guidance.append("Rewrite bullets to one sentence each; start with an action verb.")
        if jd_has_metrics_language and not any(_DIGIT_RE.search(b) for b in bullets_s):
            reasons.append("Job description emphasizes impact but this entry has no metric signal")
            guidance.append("Add one metric per bullet when the original implies it (latency, cost, uptime, conversion).")

        # Missing-skill surfacing: if the CV overall is missing a skill, but this entry contains it (or close token),
        # tell the user to surface it in these bullets.
        to_surface: list[str] = []
        if missing_l:
            for m in missing_l[:10]:
                if not m or len(m) < 3:
                    continue
                if m in blob:
                    to_surface.append(m)
        if to_surface:
            reasons.append("Relevant skills are present but not surfaced clearly")
            guidance.append("Make sure these keywords are explicitly mentioned in bullets (if truthful): " + ", ".join(sorted(set(to_surface))[:6]))

        # JD alignment signal: if the entry shares few JD tokens, suggest a rewrite to align phrasing if relevant.
        overlap = len(jd_tokens & blob_tokens)
        if jd_tokens and overlap < max(2, min(6, len(jd_tokens) // 25)):
            reasons.append("Low keyword overlap with job description (may need phrasing alignment)")
            guidance.append("If this entry is relevant to the target role, rewrite bullets using closer job-description wording (without inventing).")

        if not reasons:
            continue

        out.append(
            {
                "index": i,
                "role": role,
                "company": company,
                "reasons": reasons[:6],
                "guidance": guidance[:6],
            }
        )

    # Keep it small and stable so we only rewrite what matters.
    return out[:6]


def compute_rewrite_targets(*, cv_structure: dict, jd_text: str) -> dict:
    """Return deterministic rewrite targets based on CV structure quality signals.

    This intentionally does NOT use an LLM; it is a cheap, explainable gate so we only rewrite
    sections that are likely to improve ATS matching and readability.
    """
    jd_norm = _normalize(jd_text or "")
    jd_has_metrics_language = any(x in jd_norm for x in ("%", "percent", "reduced", "increased", "improved", "grew"))

    summary = (cv_structure.get("summary") or "").strip() if isinstance(cv_structure, dict) else ""
    summary_lines = [ln.strip() for ln in summary.splitlines() if ln.strip()]
    summary_too_long = len(summary_lines) > 3 or len(summary) > 420

    # If JD has clear impact language, prefer rewriting a summary that doesn't mention any numbers at all.
    summary_missing_metric_signal = bool(jd_has_metrics_language and summary and not _DIGIT_RE.search(summary))
    rewrite_summary = bool(summary_too_long or summary_missing_metric_signal)

    exp = cv_structure.get("experience") if isinstance(cv_structure, dict) else None
    exp_list = exp if isinstance(exp, list) else []
    rewrite_experience_indices: list[int] = []
    reasons_by_index: dict[str, list[str]] = {}

    for i, item in enumerate(exp_list):
        if not isinstance(item, dict):
            continue
        bullets = item.get("bullets") if isinstance(item.get("bullets"), list) else []
        bullets_s = [str(b).strip() for b in bullets if isinstance(b, str) and str(b).strip()]
        if not bullets_s:
            continue

        reasons: list[str] = []
        # Heuristics: long / multi-sentence / no metric when JD is metric-y.
        if any(len(b) > 170 for b in bullets_s):
            reasons.append("has very long bullets")
        if any(b.count(".") >= 2 for b in bullets_s):
            reasons.append("has multi-sentence bullets")
        if jd_has_metrics_language and not any(_DIGIT_RE.search(b) for b in bullets_s):
            reasons.append("no metric signal found in bullets (JD emphasizes impact)")

        if reasons:
            rewrite_experience_indices.append(i)
            reasons_by_index[str(i)] = reasons

    # Keep list stable + small by default (rewrite only the most likely-problematic entries).
    rewrite_experience_indices = sorted(set(rewrite_experience_indices))[:6]

    return {
        "rewrite_summary": rewrite_summary,
        "rewrite_experience_indices": rewrite_experience_indices,
        "rewrite_reasons": reasons_by_index,
    }
