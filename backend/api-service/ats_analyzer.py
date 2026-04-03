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
