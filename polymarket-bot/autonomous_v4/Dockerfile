FROM python:3.11-slim

WORKDIR /app

COPY autonomous_v4/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY autonomous_v4 /app/autonomous_v4

ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "autonomous_v4.main"]
