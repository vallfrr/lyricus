FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY migrations.sql .

EXPOSE 8000

CMD ["python", "-m", "sanic", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
