FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    MINERU_HOME=/var/lib/mineru HF_HOME=/var/lib/mineru/huggingface \
    MINERU_TELEMETRY_DISABLED=1

WORKDIR /app

RUN sed -i 's|http://|https://|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=2 update \
    && apt-get -o Acquire::Retries=2 install -y --no-install-recommends libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 mineru && useradd --uid 10001 --gid mineru --create-home mineru \
    && install -d -o mineru -g mineru /var/lib/mineru

RUN pip install --no-cache-dir \
    mineru==4.2.3 mineru-llama-cpp==0.2.3 fastapi==0.165.0 uvicorn==0.54.0 python-multipart==0.0.34

COPY server.py .
USER mineru
EXPOSE 13006

CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "13006"]
