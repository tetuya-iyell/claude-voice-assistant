FROM node:18-alpine

WORKDIR /usr/src/app

# Install ffmpeg and curl in Alpine
RUN apk add --no-cache ffmpeg curl

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY . .

# Create directories for uploads and temp files
RUN mkdir -p uploads temp

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "server.js"]