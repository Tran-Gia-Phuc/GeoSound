# Build context = repo root (see docker-compose.yml).
# Deployment plan: docs/02-design/deployment-plan.md, task 0.3.
# One target: docker-compose.dev.yml reuses it with `uvicorn --reload` and app/ mounted.

# Build stage: Python packages in a venv, plus the embeddings model.
FROM python:3.11-slim AS build
ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
# The venv has no pip or setuptools of its own (about 28 MB): the base image's pip
# installs into it through `--python` (PIP_PYTHON in the final stage).
RUN python -m venv --without-pip /opt/venv
ENV PATH=/opt/venv/bin:$PATH

# requirements-embeddings.txt: local embeddings runtime (ONNX, no torch) for the chatbot index (#219).
COPY services/ai/requirements.txt services/ai/requirements-embeddings.txt ./
# - onnxruntime declares sympy (and through it mpmath, together about 86 MB) for its
#   tools, but ONNX inference never imports them.
# - No .pyc files (--no-compile, about 76 MB): Python compiles in memory at start,
#   which costs under a second (PYTHONDONTWRITEBYTECODE keeps the files read-only).
# - The test suites shipped inside packages (numpy, fsspec, about 20 MB) are dropped.
RUN pip --python /opt/venv/bin/python install --no-cache-dir --no-compile \
      -r requirements.txt -r requirements-embeddings.txt \
 && pip --python /opt/venv/bin/python uninstall -y -q sympy mpmath \
 && find /opt/venv -depth -type d \( -name tests -o -name __pycache__ \) -exec rm -rf {} +

# The embeddings model is downloaded ONCE, here, at build time (the only network use).
# Only the ONNX graph and the tokenizer are kept: /app/models/<EMBEDDING_MODEL>/onnx/.
# The fp32 model is kept on purpose (issue #343): a quantized one would change the vectors
# and need a full re-index of the chatbot.
ARG EMBEDDING_MODEL=intfloat/multilingual-e5-small
ENV EMBEDDING_MODEL=${EMBEDDING_MODEL} \
    EMBEDDING_CACHE_DIR=/app/models
RUN python -c "import os; from huggingface_hub import snapshot_download; \
m = os.environ['EMBEDDING_MODEL']; \
snapshot_download(repo_id=m, local_dir=os.path.join(os.environ['EMBEDDING_CACHE_DIR'], m), \
allow_patterns=['onnx/model.onnx', 'onnx/tokenizer.json', 'onnx/config.json'])" \
 && rm -rf /root/.cache/huggingface /app/models/*/*/.cache

# Runtime: no build files, no tests (they mount the source, see services/ai/README.md).
FROM python:3.11-slim AS prod
ARG EMBEDDING_MODEL=intfloat/multilingual-e5-small
# HF_*_OFFLINE: the runtime never reaches the Hugging Face hub.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:$PATH \
    PIP_PYTHON=/opt/venv/bin/python \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    EMBEDDING_MODEL=${EMBEDDING_MODEL} \
    EMBEDDING_CACHE_DIR=/app/models \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /opt/venv /opt/venv
COPY --from=build /app/models ./models
COPY services/ai/app ./app
# Files stay owned by root (read-only for the app); the process runs as `app`.
# Commands that `pip install` into the venv (pytest, eval) need `--user root`;
# PIP_PYTHON makes the base image's `pip` install into the venv.
USER app
EXPOSE 3004
# `exec` so uvicorn replaces the shell and receives SIGTERM.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-3004}"]
