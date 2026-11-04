FROM python:3.13.18-slim-bookworm@sha256:281d39ff02e3b389401586134ff9e6572954687822a58055ec07a60ded4e0b7f AS runtime
ARG SOURCE_DATE_EPOCH=0
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY apps/ai/requirements.lock ./requirements.lock
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export PIP_CERT=/run/secrets/npm_ca; fi; \
    pip install --no-cache-dir --require-hashes -r requirements.lock
COPY apps/ai/ferweb_ai ./ferweb_ai
RUN useradd --create-home --uid 10001 app
USER app
EXPOSE 8000
CMD ["uvicorn", "ferweb_ai.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--log-level", "warning"]

FROM runtime AS tests
COPY apps/ai/tests ./tests
CMD ["python", "-m", "unittest", "discover", "-s", "tests", "-v"]
