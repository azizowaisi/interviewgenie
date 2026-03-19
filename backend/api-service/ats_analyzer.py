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
    for s in sorted(missing_tech):
        missing_skills.append(s.replace("_", " ").title())
    for w in sorted(missing_skill_tokens):
        if w.replace("_", " ") not in [s.lower() for s in missing_skills]:
            missing_skills.append(w.replace("_", " ").title())
        if len(missing_skills) >= 15:
            break

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
    }
