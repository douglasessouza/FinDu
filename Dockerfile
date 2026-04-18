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

# Expose the port FastAPI will run on
EXPOSE 8080

# Command to start the server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]