"""JD 上传复用安全提取，验证坏文件、空文件和原始岗位要求的会话保存。"""
import io
import unicodedata

import pytest
from docx import Document
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.wenjing.api.v1 import interview as api


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(api, "_enforce_setup_rate_limit", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(api.router)
    return TestClient(app)


@pytest.mark.parametrize("filename,content_type", [("jd.txt", "text/plain"), ("jd.md", "text/markdown")])
def test_extract_jd_text(client, filename, content_type):
    text = "Java 后端岗位：负责 B 端业务开发，需要熟悉 MySQL、Redis 和 Spring Boot。"
    response = client.post("/api/v1/interview/jd/extract", files={"file": (filename, text.encode(), content_type)})
    assert response.status_code == 200
    assert response.json()["text"] == unicodedata.normalize("NFKC", text)


def test_extract_jd_docx(client):
    doc = Document()
    doc.add_paragraph("岗位要求：Java 后端开发，熟悉 MySQL。")
    output = io.BytesIO()
    doc.save(output)
    response = client.post("/api/v1/interview/jd/extract", files={"file": ("jd.docx", output.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    assert response.status_code == 200
    assert "MySQL" in response.json()["text"]


@pytest.mark.parametrize("filename,data", [("jd.pdf", b"not a PDF"), ("jd.exe", b"executable"), ("jd.txt", b""), ("jd.txt", b"a" * 20001)])
def test_bad_jd_upload_is_rejected(client, filename, data):
    response = client.post("/api/v1/interview/jd/extract", files={"file": (filename, data, "application/octet-stream")})
    assert response.status_code == 422


def test_job_spec_keeps_original_description():
    job = api.JobSpecInput(title="Java", description="负责 B 端系统开发，熟悉 MySQL 和 Redis。")
    assert job.model_dump()["description"] == job.description
