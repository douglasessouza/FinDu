from fastapi import FastAPI

app = FastAPI(
    title="FinDu API",
    description="Personal multi-currency financial control app (BRL + CAD)",
    version="0.1.0",
)

@app.get("/health")
def health_check():
    return {"status": "ok", "app": "FinDu"}