#!/bin/bash
set -e

# System updates and dependencies
sudo apt update
sudo apt install -y python3-pip python3-venv nginx certbot python3-certbot-nginx curl git

# Install Node.js (for building frontend)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Build Frontend
echo "Building frontend..."
npm install
npm run build
sudo mkdir -p /var/www/rimi-ai
sudo cp -r dist /var/www/rimi-ai/

# Setup Backend
echo "Setting up backend..."
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# PM2 for process management
sudo npm install -g pm2
pm2 start "gunicorn -c gunicorn_config.py" --name "rimi-backend"
pm2 save
pm2 startup | tail -n 1 | bash -

# Nginx config
echo "Setting up Nginx..."
cd ..
sudo cp nginx.conf /etc/nginx/sites-available/rimi-ai
sudo ln -sf /etc/nginx/sites-available/rimi-ai /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "Deployment complete! Next step: setup SSL with 'sudo certbot --nginx -d rimi-ai.pro'"
