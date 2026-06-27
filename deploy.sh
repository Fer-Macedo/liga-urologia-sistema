#!/bin/bash
cd /var/www/liga-urologia
git pull origin main
npm install --production
pm2 restart liga-urologia
echo "Deploy concluído!"
