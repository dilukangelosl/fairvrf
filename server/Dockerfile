# Use Node.js 22 Alpine for smaller image size
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY bun.lock* ./
COPY tsconfig.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm install

# Copy source code and scripts
COPY src/ ./src/
COPY scripts/ ./scripts/

# Build the TypeScript code
RUN npm run build

# Remove dev dependencies after build to reduce image size
RUN npm prune --omit=dev

# Make scripts executable
RUN chmod +x ./scripts/docker-entrypoint.sh ./scripts/generate-chain-docker.cjs

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
ENV CHAIN_LENGTH=100000

# Health check - wait longer for initial chain generation
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "const fs = require('fs'); if (!fs.existsSync('/app/chain.db.json')) process.exit(1); console.log('Health check passed')" || exit 1

# Use custom entrypoint that handles chain generation
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
