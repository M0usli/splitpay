FROM python:3.12-slim

# Don't write .pyc files, and print logs immediately instead of buffering them.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Tesseract is the OCR program itself. The Python package "pytesseract" only
# calls it, so the program has to be installed in the image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only the requirements first. Docker caches each step, so the slow
# "pip install" step is reused until the requirements files change.
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt

COPY . .

EXPOSE 8000

# --host 0.0.0.0 makes the server reachable from outside the container.
# --reload restarts the server when a source file changes (development only).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
