from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


app = FastAPI(title="Canvas AI Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LinkData(BaseModel):
    text: str = ""
    href: str = ""


class DueDateData(BaseModel):
    text: str = ""
    dateTime: str = ""


class CanvasData(BaseModel):
    assignments: list[LinkData] = Field(default_factory=list)
    files: list[LinkData] = Field(default_factory=list)
    modules: list[LinkData] = Field(default_factory=list)
    dueDates: list[DueDateData] = Field(default_factory=list)


class PageData(BaseModel):
    url: str
    title: str
    headings: list[str]
    links: list[LinkData]
    canvas: CanvasData | None = None
    visibleText: str


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/extract")
def receive_page_data(data: PageData) -> dict[str, Any]:
    canvas = data.canvas or CanvasData()

    return {
        "message": "Data received successfully",
        "url": data.url,
        "title": data.title,
        "num_headings": len(data.headings),
        "num_links": len(data.links),
        "num_assignments": len(canvas.assignments),
        "num_files": len(canvas.files),
        "num_modules": len(canvas.modules),
        "num_due_dates": len(canvas.dueDates),
        "text_preview": data.visibleText[:500],
    }
