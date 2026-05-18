#!/bin/bash
set -e
echo "Building..."
docker compose build frontend api worker
echo "Deploying..."
docker compose up -d frontend api worker
echo "Done. Prod is live at platform.symbiobc.com"
