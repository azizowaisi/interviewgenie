"""
Parse CV files: PDF, DOCX, TXT. Returns plain text.
"""
import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def parse_pdf(data: bytes) -> Optional[str]:
    # 1. PyMuPDF — best for Word-exported and multi-column PDFs
    try:
        import fitz
        doc = fitz.open(stream=data, filetype="pdf")
        parts = [page.get_text("text") for page in doc]
        doc.close()
        text = "\n".join(parts).strip()
        if len(text) > 50:
            return text
    except Exception as exc:
        logger.warning("PyMuPDF failed: %s", exc)

    # 2. pdfplumber
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            text = "\n".join(p.extract_text() or "" for p in pdf.pages).strip()
        if len(text) > 50:
            return text
    except Exception as exc:
        logger.warning("pdfplumber failed: %s", exc)

    # 3. pdfminer.six
    try:
        from pdfminer.high_level import extract_text as pdfminer_extract
        text = pdfminer_extract(io.BytesIO(data)).strip()
        if len(text) > 50:
            return text
    except Exception as exc:
        logger.warning("pdfminer.six failed: %s", exc)

    # 4. pypdf
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
        if len(text) > 50:
            return text
    except Exception as exc:
        logger.warning("pypdf failed: %s", exc)

    # 5. OCR fallback — scanned/image-only PDFs
    logger.info("All text extractors empty — attempting OCR fallback")
    try:
        import pytesseract
        from pdf2image import convert_from_bytes
        images = convert_from_bytes(data, dpi=200, fmt="jpeg")
        text = "\n".join(pytesseract.image_to_string(img, lang="eng") for img in images).strip()
        if text:
            logger.info("OCR extracted %d chars", len(text))
            return text
    except Exception as exc:
        logger.warning("OCR fallback failed: %s", exc)

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
    if lower.endswith(".pdf") or data.startswith(b"%PDF"):
        return parse_pdf(data)
    if lower.endswith(".docx") or lower.endswith(".doc"):
        return parse_docx(data)
    if lower.endswith(".txt"):
        return parse_txt(data)
    # Last resort for unknown extensions/content types.
    return parse_txt(data)
