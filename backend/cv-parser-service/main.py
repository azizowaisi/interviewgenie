"""
CV Parser Service — extracts structured data from PDF/DOCX uploads.

POST /parse-cv  multipart file  →  JSON {name, email, skills, experience_years, raw_text}
"""
import io
import re
import logging
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)
app = FastAPI(title="CV Parser Service", version="0.1.0")

# ── Common tech/soft skills keyword list ─────────────────────────────────────
_SKILL_KEYWORDS = {
    # Languages
    "python", "javascript", "typescript", "java", "kotlin", "swift", "go", "golang",
    "rust", "c++", "c#", "ruby", "php", "scala", "r", "matlab", "bash", "sql",
    # Frameworks / libs
    "react", "vue", "angular", "nextjs", "nuxt", "svelte", "fastapi", "django",
    "flask", "express", "nestjs", "spring", "rails", "laravel", "pytorch", "tensorflow",
    "keras", "scikit-learn", "pandas", "numpy",
    # Infra / cloud
    "docker", "kubernetes", "k8s", "aws", "gcp", "azure", "terraform", "ansible",
    "ci/cd", "jenkins", "github actions", "gitlab ci", "linux",
    # Data / AI
    "machine learning", "deep learning", "nlp", "llm", "data science", "sql",
    "postgresql", "mysql", "mongodb", "redis", "elasticsearch",
    # Soft
    "agile", "scrum", "jira", "leadership", "communication",
}


def _extract_text_pdf(data: bytes) -> str:
    """Extract text from PDF using a chain of libraries from most to least robust.
    Falls back to OCR (Tesseract) for scanned/image-only PDFs.
    """

    # 1. PyMuPDF (fitz) — MuPDF engine; handles all font encodings, Word-exported PDFs
    try:
        import fitz
        doc = fitz.open(stream=data, filetype="pdf")
        parts = [page.get_text("text") for page in doc]
        doc.close()
        text = "\n".join(parts).strip()
        if text:
            return text
    except Exception as exc:
        logger.warning("PyMuPDF failed: %s", exc)

    # 2. pdfplumber — good for tabular/structured CVs
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            text = "\n".join(page.extract_text() or "" for page in pdf.pages).strip()
        if text:
            return text
    except Exception as exc:
        logger.warning("pdfplumber failed: %s", exc)

    # 3. pdfminer.six — better on older PDFs with unusual encodings
    try:
        from pdfminer.high_level import extract_text as pdfminer_extract
        text = pdfminer_extract(io.BytesIO(data)).strip()
        if text:
            return text
    except Exception as exc:
        logger.warning("pdfminer.six failed: %s", exc)

    # 4. pypdf — different internal parser
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
        if text:
            return text
    except Exception as exc:
        logger.warning("pypdf failed: %s", exc)

    # 5. OCR fallback — for scanned/image-only PDFs (Tesseract via pdf2image)
    logger.info("All text extractors returned empty — attempting OCR fallback")
    try:
        import pytesseract
        from pdf2image import convert_from_bytes
        images = convert_from_bytes(data, dpi=200, fmt="jpeg")
        ocr_parts = []
        for img in images:
            ocr_parts.append(pytesseract.image_to_string(img, lang="eng"))
        text = "\n".join(ocr_parts).strip()
        if text:
            logger.info("OCR extracted %d chars", len(text))
            return text
    except Exception as exc:
        logger.warning("OCR fallback failed: %s", exc)

    return ""


def _extract_text_docx(data: bytes) -> str:
    try:
        from docx import Document
        doc = Document(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs)
    except Exception as exc:
        logger.warning("python-docx failed: %s", exc)
        return ""


def _extract_name(text: str) -> str:
    """Heuristic: first non-empty line that looks like a name (2-4 capitalized words)."""
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        # Skip lines that look like headers or emails
        if "@" in line or re.search(r"\d{4}", line):
            continue
        words = line.split()
        if 2 <= len(words) <= 4 and all(w[0].isupper() for w in words if w[0].isalpha()):
            return line
        break
    return ""


def _extract_email(text: str) -> str:
    match = re.search(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", text)
    return match.group(0).lower() if match else ""


def _extract_skills(text: str) -> list[str]:
    text_lower = text.lower()
    found = []
    for skill in _SKILL_KEYWORDS:
        # Use word-boundary-like matching
        pattern = r"(?<![a-z0-9])" + re.escape(skill) + r"(?![a-z0-9])"
        if re.search(pattern, text_lower):
            found.append(skill)
    return sorted(found)


def _extract_experience_years(text: str) -> float:
    """Sum up year ranges like '2018 – 2022' or 'Jan 2019 - Present'."""
    import datetime
    current_year = datetime.datetime.now().year

    # Pattern 1: explicit years range
    ranges = re.findall(r"\b(20\d{2}|19\d{2})\s*[-–—]\s*(20\d{2}|19\d{2}|[Pp]resent|[Cc]urrent)\b", text)
    total = 0.0
    for start_s, end_s in ranges:
        start = int(start_s)
        if re.match(r"[Pp]resent|[Cc]urrent", end_s):
            end = current_year
        else:
            end = int(end_s)
        if end >= start:
            total += end - start

    if total > 0:
        return round(min(total, 40.0), 1)

    # Pattern 2a: "X years of experience", "X+ years experience", "X yrs experience"
    m = re.search(
        r"(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience\b",
        text,
        re.IGNORECASE,
    )
    if m:
        return float(m.group(1))

    # Pattern 2b: "Experience: X years", "Total experience 3.5 yrs"
    m = re.search(
        r"\b(?:total\s+)?experience\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b",
        text,
        re.IGNORECASE,
    )
    if m:
        return float(m.group(1))

    return 0.0


def _parse(data: bytes, filename: str) -> dict:
    fname = (filename or "").lower()
    # Detect PDF by extension OR content magic bytes in case clients upload without extension.
    if fname.endswith(".pdf") or data.startswith(b"%PDF"):
        raw = _extract_text_pdf(data)
    elif fname.endswith(".docx"):
        raw = _extract_text_docx(data)
    else:
        # Plain text fallback
        try:
            raw = data.decode("utf-8", errors="replace")
        except Exception:
            raw = ""

    return {
        "name": _extract_name(raw),
        "email": _extract_email(raw),
        "skills": _extract_skills(raw),
        "experience_years": _extract_experience_years(raw),
        "raw_text": raw[:8000],
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return JSONResponse({"status": "ok"})


@app.post("/parse-cv")
async def parse_cv(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    filename = file.filename or "upload"
    result = _parse(data, filename)
    return JSONResponse(result)
