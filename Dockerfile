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

# Copy start script and make it executable
COPY start.sh .
RUN chmod +x start.sh

# Expose port for server (if needed)
EXPOSE 3000

# Default command
CMD ["sh", "start.sh"]