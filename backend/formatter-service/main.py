from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.responses import JSONResponse
import re


class FormatRequest(BaseModel):
    raw_answer: str


class StarAnswer(BaseModel):
    situation: str
    task: str
    action: str
    result: str


app = FastAPI(title="Formatter Service", version="0.1.0")


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


def extract_section(text: str, key: str) -> str:
    pattern = re.compile(rf"{key}\s*[:\-]\s*(.+?)(?=(Situation|Task|Action|Result)\s*[:\-]|$)", re.IGNORECASE | re.DOTALL)
    match = pattern.search(text)
    return match.group(1).strip() if match else ""


@app.post("/format", response_model=StarAnswer)
async def format_answer(body: FormatRequest) -> StarAnswer:
    raw = body.raw_answer.strip()
    situation = extract_section(raw, "Situation")
    task = extract_section(raw, "Task")
    action = extract_section(raw, "Action")
    result = extract_section(raw, "Result")
    if not (situation or task or action or result):
        situation = raw
    return StarAnswer(
        situation=situation,
        task=task,
        action=action,
        result=result,
    )

