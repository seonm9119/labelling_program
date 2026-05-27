FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY config.py .
COPY responses.py .
COPY models/ models/
COPY routes/ routes/
COPY utils/ utils/

EXPOSE 5001

CMD ["python", "app.py"]
