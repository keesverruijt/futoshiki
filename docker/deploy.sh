#!/bin/bash
# Deployment script for Futoshiki Helper
# Run this on your server to deploy the application

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEPLOY_DIR="/var/www/futoshiki"

echo "=== Futoshiki Helper Deployment ==="

# Check if .env exists
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "Error: .env file not found!"
    echo "Please copy .env.example to .env and set your passwords"
    exit 1
fi

# Create deployment directory
echo "Creating deployment directory..."
sudo mkdir -p "$DEPLOY_DIR"

# Copy static files
echo "Copying static files..."
sudo cp "$SCRIPT_DIR/index.html" "$DEPLOY_DIR/"
sudo cp "$PROJECT_DIR/app.js" "$DEPLOY_DIR/"
sudo cp "$PROJECT_DIR/styles.css" "$DEPLOY_DIR/"
sudo cp "$PROJECT_DIR/generator-worker.js" "$DEPLOY_DIR/"

# Set permissions
echo "Setting permissions..."
sudo chown -R www-data:www-data "$DEPLOY_DIR"
sudo chmod -R 755 "$DEPLOY_DIR"

# Build and start containers
echo "Starting Docker containers..."
cd "$SCRIPT_DIR"
docker-compose down 2>/dev/null || true
docker-compose build
docker-compose up -d

# Wait for database to be ready
echo "Waiting for database..."
sleep 10

# Check container status
echo ""
echo "=== Container Status ==="
docker-compose ps

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Next steps:"
echo "1. Include nginx.conf in your server configuration"
echo "2. Reload nginx: sudo nginx -t && sudo systemctl reload nginx"
echo "3. Test the API: curl https://verruijt.net/futoshiki/api/stats.php?size=5"
echo ""
