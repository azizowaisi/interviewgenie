from __future__ import annotations

from typing import Any

from cv_docx_template import render_cv_to_docx_bytes as render_cv_to_docx_bytes_templated
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field


class ExperienceItem(BaseModel):
    role: str = ""
    company: str = ""
    bullets: list[str] = Field(default_factory=list)


class RenderCvRequest(BaseModel):
    name: str = ""
    headline: str = ""
    contact: list[str] = Field(default_factory=list)
    summary: str = ""
    experience: list[ExperienceItem] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    education: list[str] = Field(default_factory=list)


app = FastAPI(title="CV Renderer Service", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def render_cv_to_docx_bytes(payload: RenderCvRequest) -> bytes:
    return render_cv_to_docx_bytes_templated(
        name=payload.name,
        headline=payload.headline,
        contact=list(payload.contact or []),
        summary=payload.summary,
        experience=list(payload.experience or []),
        skills=[s.strip() for s in (payload.skills or []) if isinstance(s, str) and s.strip()],
        education=[s.strip() for s in (payload.education or []) if isinstance(s, str) and s.strip()],
    )


@app.post(
    "/render/docx",
    responses={
        422: {"description": "Invalid CV JSON for rendering"},
        500: {"description": "Renderer produced empty DOCX"},
    },
)
async def render_docx(body: dict[str, Any]) -> Response:
    try:
        req = RenderCvRequest.model_validate(body)
    except Exception as e:
        raise HTTPException(status_code=422, detail="Invalid CV JSON for rendering") from e

    data = render_cv_to_docx_bytes(req)
    if not data:
        raise HTTPException(status_code=500, detail="Renderer produced empty DOCX")

    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": 'attachment; filename="ats_optimized_cv.docx"'},
    )
