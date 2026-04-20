# Base image — Python 3.14 slim (smallest possible size)
FROM python:3.14-slim

# Set the working directory inside the container
WORKDIR /app

# Copy the dependencies file first (optimizes Docker layer caching)
COPY requirements.txt .

# Install all dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose the port
EXPOSE 8080

# Start both FastAPI (port 8000) and Streamlit (port 8080)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 & sleep 3 && streamlit run frontend/app_streamlit.py --server.port 8080 --server.address 0.0.0.0"]