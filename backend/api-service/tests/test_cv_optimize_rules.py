from cv_optimize_rules import apply_rules, merge_rule_skills_into_cv


def test_apply_rules_dedupes_and_prioritizes_skills():
    base = {
        "name": "Jane Doe",
        "summary": "Backend engineer.",
        "experience": [{"role": "Engineer", "company": "Acme", "bullets": ["Built APIs in Python and Docker."]}],
        "skills": ["Docker", "python", "Docker", "REST"],
    }
    rules = {"skills_rules": {"prioritize": ["REST", "Docker", "Python"]}}
    out = apply_rules(base, rules)  # type: ignore[arg-type]
    assert out["skills"][:3] == ["REST", "Docker", "python"]


def test_apply_rules_adds_missing_skills_when_evidence_in_cv():
    base = {
        "name": "Jane Doe",
        "summary": "Worked on Terraform modules and CI/CD pipelines.",
        "experience": [],
        "skills": ["Docker"],
    }
    rules = {"missing_skills": ["Terraform", "Kubernetes"]}
    out = apply_rules(base, rules)  # type: ignore[arg-type]
    assert "Terraform" in out["skills"]
    assert "Kubernetes" not in out["skills"]


def test_apply_rules_adds_skill_when_multi_token_evidence_in_cv():
    """Tokens need not be adjacent: 'REST' + 'API' both in blob."""
    base = {
        "name": "X",
        "summary": "",
        "experience": [
            {"role": "Dev", "company": "Co", "bullets": ["Designed REST services and public API gateways."]}
        ],
        "skills": ["Python"],
    }
    rules = {"missing_skills": ["REST API"]}
    out = apply_rules(base, rules)  # type: ignore[arg-type]
    assert any("REST API" == s or s.lower() == "rest api" for s in out["skills"])


def test_apply_rules_merges_keyword_phrases_when_supported_by_cv():
    base = {
        "name": "X",
        "summary": "Heavy use of GitHub Actions for deployment pipelines.",
        "experience": [],
        "skills": ["Docker"],
    }
    rules = {"keyword_phrases": ["GitHub Actions"]}
    out = apply_rules(base, rules)  # type: ignore[arg-type]
    assert any("github" in s.lower() and "actions" in s.lower() for s in out["skills"])


def test_merge_rule_skills_picks_up_skills_from_rewritten_bullets():
    cv = {
        "name": "X",
        "summary": "Engineer.",
        "experience": [{"role": "Dev", "company": "Co", "bullets": ["Shipped features using Redis caching extensively."]}],
        "skills": ["Python"],
    }
    rules = {"missing_skills": ["Redis"], "skills_rules": {"prioritize": ["Redis"]}}
    merge_rule_skills_into_cv(cv, rules)  # type: ignore[arg-type]
    assert "Redis" in cv["skills"]

