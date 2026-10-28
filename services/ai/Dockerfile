FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY services/ai/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Local embeddings runtime (ONNX, no torch) for the chatbot index (#219).
COPY services/ai/requirements-embeddings.txt ./requirements-embeddings.txt
RUN pip install --no-cache-dir -r requirements-embeddings.txt

# The embeddings model is downloaded ONCE, here, at build time (the only network use).
# Only the ONNX graph and the tokenizer are kept: /app/models/<EMBEDDING_MODEL>/onnx/.
ARG EMBEDDING_MODEL=intfloat/multilingual-e5-small
ENV EMBEDDING_MODEL=${EMBEDDING_MODEL} \
    EMBEDDING_CACHE_DIR=/app/models
RUN python -c "import os; from huggingface_hub import snapshot_download; \
m = os.environ['EMBEDDING_MODEL']; \
snapshot_download(repo_id=m, local_dir=os.path.join(os.environ['EMBEDDING_CACHE_DIR'], m), \
allow_patterns=['onnx/model.onnx', 'onnx/tokenizer.json', 'onnx/config.json'])" \
 && rm -rf /root/.cache/huggingface /app/models/*/*/.cache

# Runtime never reaches the Hugging Face hub.
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

COPY services/ai/ ./

EXPOSE 3004

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-3004}"]
