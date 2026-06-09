from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import logging
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.catalog import initialize_schema
from backend.config import load_config
from backend.logging_config import configure_logging


logger = logging.getLogger("canvasgpt.backend")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    config = load_config()
    app.state.config = config
    configure_logging(config)
    initialize_schema(config.db_path)
    logger.info("CanvasGPT backend startup complete")
    yield


app = FastAPI(title="Canvas AI Assistant API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
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
