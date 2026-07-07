#!/bin/bash
set -e

DOMAIN="${RIMI_DOMAIN:-rimiai.pro}"
APP_PORT="${PORT:-3001}"

sudo apt update
sudo apt install -y python3-pip python3-venv nginx certbot python3-certbot-nginx curl git

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

echo "Building frontend..."
npm install
npm run build
sudo mkdir -p /var/www/rimi-ai/dist
sudo mkdir -p /var/www/rimi-ai/backend/uploads
sudo mkdir -p /var/www/rimi-ai/backend/results
sudo cp -r dist/* /var/www/rimi-ai/dist/

echo "Setting up backend..."
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

sudo npm install -g pm2
pm2 start "gunicorn -c gunicorn_config.py server:app" --name "rimi-backend" --cwd "$(pwd)"
pm2 start "rq worker --url ${REDIS_URL:-redis://127.0.0.1:6379/0} rimi-ai" --name "rimi-worker" --cwd "$(pwd)"
pm2 save
pm2 startup | tail -n 1 | bash -

echo "Setting up Nginx..."
cd ..
sudo cp nginx.conf /etc/nginx/sites-available/rimi-ai
sudo ln -sf /etc/nginx/sites-available/rimi-ai /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "Deployment complete. Next: sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
