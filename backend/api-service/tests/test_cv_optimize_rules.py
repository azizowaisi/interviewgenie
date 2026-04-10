from cv_optimize_rules import apply_rules


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


def test_apply_rules_adds_missing_skills_only_if_present_in_cv_blob():
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

