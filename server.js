require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

let PORT = process.env.PORT || 3000;

// API Route Handlers
const configHandler = require('./api/config');
const testChatHandler = require('./api/test-chat');
const notifyStatusHandler = require('./api/notify-status');
const webhookHandler = require('./api/webhook');

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

function startServer(portToUse) {
  const server = http.createServer((req, res) => {
    // Augment res object for Express/Vercel compatibility
    res.status = function(statusCode) {
      res.statusCode = statusCode;
      return res;
    };
    res.json = function(obj) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(obj));
    };
    res.send = function(content) {
      if (typeof content === 'object') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(content));
      } else {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(content);
      }
    };

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // Body parser helper for POST requests
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      if (bodyData) {
        try {
          req.body = JSON.parse(bodyData);
        } catch (e) {
          req.body = {};
        }
      }

      // 1. API Route Routing
      if (pathname === '/api/config') {
        return configHandler(req, res);
      }
      if (pathname === '/api/test-chat') {
        return testChatHandler(req, res);
      }
      if (pathname === '/api/notify-status') {
        return notifyStatusHandler(req, res);
      }
      if (pathname === '/api/webhook') {
        return webhookHandler(req, res);
      }

      // 2. Static Files Serving
      let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
      
      if (!filePath.startsWith(__dirname)) {
        res.statusCode = 403;
        return res.end('Forbidden');
      }

      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.end('<h1>404 Not Found</h1>');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
      });
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' || err.code === 'EPERM') {
      console.log(`[Warning] Порт ${portToUse} недоступен (${err.code}), пробуем порт ${portToUse + 1}...`);
      startServer(portToUse + 1);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(portToUse, '127.0.0.1', () => {
    console.log(`\n==================================================`);
    console.log(`🚀 CRM сервер noriCRM успешно запущен локально!`);
    console.log(`==================================================`);
    console.log(`💻 Планшет Кассира:        http://localhost:${portToUse}`);
    console.log(`🤖 ИИ Клиент-Чат (Эмулятор): http://localhost:${portToUse}/api/test-chat`);
    console.log(`==================================================\n`);
  });
}

startServer(PORT);
