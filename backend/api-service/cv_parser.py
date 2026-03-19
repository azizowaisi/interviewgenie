"""
Parse CV files: PDF, DOCX, TXT. Returns plain text.
"""
import io
from typing import Optional


def parse_pdf(data: bytes) -> Optional[str]:
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        parts = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                parts.append(t)
        return "\n".join(parts).strip() or None
    except Exception:
        return None


def parse_docx(data: bytes) -> Optional[str]:
    try:
        from docx import Document
        doc = Document(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs if p.text).strip() or None
    except Exception:
        return None


def parse_txt(data: bytes) -> Optional[str]:
    try:
        return data.decode("utf-8", errors="replace").strip() or None
    except Exception:
        return None


def parse_cv(data: bytes, filename: str) -> Optional[str]:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return parse_pdf(data)
    if lower.endswith(".docx") or lower.endswith(".doc"):
        return parse_docx(data)
    if lower.endswith(".txt"):
        return parse_txt(data)
    return None
