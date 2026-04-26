# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p data

# Expose port (if the app exposes any)
# EXPOSE 3000

# Default command
CMD ["node", "tracker.js"]