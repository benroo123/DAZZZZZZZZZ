FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY services/api-python services/api-python
COPY packages packages
COPY activity-social-app-product/api activity-social-app-product/api
COPY activity-social-app-product/prototype/assets activity-social-app-product/prototype/assets
RUN pip install --no-cache-dir ./services/api-python
WORKDIR /app/services/api-python
EXPOSE 8100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
