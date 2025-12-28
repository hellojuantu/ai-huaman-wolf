import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { GameManager } from './game/GameManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载配置
const configPath = path.join(__dirname, '../config/default.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const PORT = config.server.port || 3000;

// MIME 类型映射
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  // 去除查询字符串
  const urlPath = req.url.split('?')[0];
  let filePath = path.join(__dirname, '../public', urlPath === '/' ? 'index.html' : urlPath);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// 创建 WebSocket 服务器
const wss = new WebSocketServer({ server });
const gameManager = new GameManager(config);

// WebSocket 连接处理
wss.on('connection', (ws) => {
  console.log('新连接建立');

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      gameManager.handleMessage(ws, message);
    } catch (err) {
      console.error('消息解析错误:', err);
      ws.send(JSON.stringify({ type: 'error', message: '无效的消息格式' }));
    }
  });

  ws.on('close', () => {
    console.log('连接关闭');
    gameManager.handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket 错误:', err);
  });
});

// 心跳检测
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`🐺 狼人杀游戏服务器运行在 http://localhost:${PORT}`);
});
