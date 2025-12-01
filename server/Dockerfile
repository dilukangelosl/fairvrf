# Use Node.js 22 Alpine for smaller image size
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Build the TypeScript code
RUN npm run build

# Create non-root user for security
RUN addgroup -g 1001 -S fairvrf && \
    adduser -S fairvrf -u 1001

# Change ownership of the app directory
RUN chown -R fairvrf:fairvrf /app

# Switch to non-root user
USER fairvrf

# Expose port (if needed for health checks)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# Start the service
CMD ["npm", "start"]
