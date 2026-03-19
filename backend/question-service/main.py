from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.responses import JSONResponse


class QuestionRequest(BaseModel):
    text: str
    cv_context: str | None = None
    job_description: str | None = None


class QuestionPayload(BaseModel):
    prompt: str


app = FastAPI(title="Question Processor Service", version="0.1.0")


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.post("/process", response_model=QuestionPayload)
async def process_question(body: QuestionRequest) -> QuestionPayload:
    cleaned = body.text.strip()
    cv_block = ""
    if body.cv_context and body.cv_context.strip():
        cv_block = (
            "Use this candidate CV to base your answer on their real experience and skills:\n\n"
            f"{body.cv_context.strip()[:4000]}\n\n"
        )
    job_block = ""
    if body.job_description and body.job_description.strip():
        job_block = (
            "Target role/job context (tailor the answer to this role):\n\n"
            f"{body.job_description.strip()[:3000]}\n\n"
        )
    prompt = (
        "Answer the interview question in STAR format (Situation, Task, Action, Result).\n\n"
        "Rules: Base the answer on the candidate's CV where relevant. Relate the answer to the target job. "
        "Maximum 2-3 short lines total. Interview answer only—very concise, not a speech. No preamble.\n\n"
        f"{cv_block}"
        f"{job_block}"
        f"Question: {cleaned}\n\n"
        "Return only the answer."
    )
    return QuestionPayload(prompt=prompt)

