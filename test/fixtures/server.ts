import http from 'node:http';
import type net from 'node:net';

export type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

function htmlPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Igloo Chrome Test Page</title>
  </head>
  <body>
    <main>
      <h1>Igloo Chrome Test Page</h1>
      <p id="status">ready</p>
    </main>
  </body>
</html>`;
}

export async function startTestServer(): Promise<TestServer> {
  const sockets = new Set<net.Socket>();
  const server = http.createServer((req, res) => {
    if (!req.url || req.url === '/' || req.url.startsWith('/provider')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(htmlPage());
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve test server address');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  };
}
