# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["mineru==4.2.3", "fastapi==0.165.0", "uvicorn==0.54.0", "python-multipart==0.0.34"]
# ///
"""将本地 MinerU 接入 FastGPT 的自建 PDF 解析接口。"""

import logging
import os
from pathlib import Path
from secrets import compare_digest
from shutil import copyfileobj
from tempfile import TemporaryDirectory
from threading import Lock
from typing import Annotated

import uvicorn
from fastapi import FastAPI, Header, HTTPException, UploadFile
from mineru.config import VlmConfig
from mineru.errors import InvalidRequestError
from mineru.parser import parse

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
logger = logging.getLogger("uvicorn.error")
parse_lock = Lock()
api_key = os.environ.get("FASTGPT_PDF_PARSE_KEY", "")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v2/parse/file")
def parse_pdf(
    file: UploadFile, authorization: Annotated[str, Header()] = ""
) -> dict[str, str | int]:
    """接收 PDF，返回 FastGPT 所需的 Markdown 和页数。"""
    if api_key and not compare_digest(authorization.encode(), f"Bearer {api_key}".encode()):
        raise HTTPException(status_code=401, detail="Invalid parser credentials")
    if b"%PDF-" not in file.file.read(1024):
        raise HTTPException(status_code=415, detail="Expected a PDF file")
    file.file.seek(0)

    # 单机串行推理，避免同时处理多份 PDF 时耗尽统一内存。
    with parse_lock, TemporaryDirectory(prefix="fastgpt-pdf-") as directory:
        path = Path(directory) / "document.pdf"
        with path.open("wb") as target:
            copyfileobj(file.file, target)

        try:
            result = parse(path, tier="standard", vlm_config=VlmConfig(engine="llama-cpp"))
            markdown = result.markdown()
        except InvalidRequestError:
            return {"error": "PDF 无法解析，请确认文件完整且未加密。"}
        except Exception:
            logger.exception("MinerU PDF parsing failed")
            return {"error": "PDF 增强解析失败，请检查本地解析服务日志。"}

    if not markdown.strip():
        return {"error": "PDF 中未提取到可索引的文本或图片。"}
    return {"pages": len(result.pages), "markdown": markdown}


if __name__ == "__main__":
    os.environ.setdefault("MINERU_TELEMETRY_DISABLED", "1")
    uvicorn.run(app, host="127.0.0.1", port=13006)
