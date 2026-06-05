# OpenWA-bot - Dockerfile
# Optimized for Hugging Face Spaces deployment

FROM node:22-slim

WORKDIR /app

# Install build dependencies for native modules (like sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Remove default 'node' user to avoid UID/GID 1000 conflicts
RUN (userdel -r node || true) && (groupdel node || true) && \
    groupadd -g 1000 openwabot && useradd -r -u 1000 -g openwabot openwabot

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Ensure the data directory exists with correct permissions
RUN mkdir -p ./data && \
    chown -R openwabot:openwabot /app

# Run as the unprivileged openwabot user (UID 1000)
USER openwabot

# Configure environment variables
ENV PORT=7860
EXPOSE 7860

# Start the application
CMD ["npm", "start"]
