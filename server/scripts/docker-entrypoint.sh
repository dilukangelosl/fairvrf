#!/bin/sh

# FairVRF Docker Entrypoint Script
# Handles chain generation and server startup

set -e

echo "FairVRF Docker Container Starting..."
echo "===================================="
echo "Environment: ${NODE_ENV:-development}"
echo "Contract: ${CONTRACT_ADDRESS:-Not configured}"
echo "Chain Length: ${CHAIN_LENGTH:-100000}"
echo ""

# Step 1: Generate hash chain if it doesn't exist
echo "Step 1: Hash Chain Generation"
echo "-----------------------------"
node /app/scripts/generate-chain-docker.cjs

# Check if chain generation was successful
if [ ! -f "/app/chain.db.json" ]; then
    echo "Chain generation failed - exiting"
    exit 1
fi

echo ""
echo "Step 2: Starting FairVRF Server"
echo "-------------------------------"

# Step 2: Start the main server
exec npm start
