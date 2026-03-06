const http = require('http');

const TEST_HTML = `<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <h1>Test Page</h1>
  <textarea id="testTextarea" rows="4" cols="50"></textarea>
  <br><br>
  <input type="text" id="testInput" />
  <br><br>
  <div id="testContentEditable" contenteditable="true"
       style="border:1px solid #ccc; padding:8px; min-height:40px; width:300px;">
  </div>
  <br>
  <p id="nonEditable">This is non-editable text for click targets.</p>
</body>
</html>`;

const TEST_HTML_BOTTOM = `<!DOCTYPE html>
<html>
<head><title>Test Page Bottom</title></head>
<body style="margin:0; display:flex; flex-direction:column; height:100vh;">
  <div style="flex:1"></div>
  <textarea id="bottomTextarea" rows="2" cols="50"
    style="margin-bottom:0; position:fixed; bottom:0; left:20px; width:300px;"></textarea>
</body>
</html>`;

const MOCK_MODELS = {
  data: [
    {
      id: 'google/gemini-3-flash-preview',
      name: 'Gemini 3 Flash Preview',
      context_length: 1000000,
      pricing: {
        prompt: '0.000001',
        completion: '0.000004',
      },
    },
    {
      id: 'test-model',
      name: 'Test Model',
      context_length: 128000,
      pricing: {
        prompt: '0.00001',
        completion: '0.00003',
      },
    },
  ],
};

function startServer() {
  return new Promise((resolve) => {
    let lastRequestBody = null;

    const server = http.createServer((req, res) => {
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, HTTP-Referer, X-Title, Accept, Accept-Encoding');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Serve test page
      if (req.method === 'GET' && req.url === '/test-page') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(TEST_HTML);
        return;
      }

      // Serve bottom textarea test page
      if (req.method === 'GET' && req.url === '/test-page-bottom') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(TEST_HTML_BOTTOM);
        return;
      }

      // Last request body (for test assertions)
      if (req.method === 'GET' && req.url === '/last-request') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(lastRequestBody || {}));
        return;
      }

      // Models endpoint
      if (req.method === 'GET' && req.url === '/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(MOCK_MODELS));
        return;
      }

      // Chat completions
      if (req.method === 'POST' && req.url === '/chat/completions') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
            return;
          }

          lastRequestBody = parsed;

          if (parsed.stream) {
            // SSE streaming response
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            });

            const polishedText = 'This is the polished text.';
            const words = polishedText.split(' ');
            let i = 0;

            const interval = setInterval(() => {
              if (i < words.length) {
                const chunk = (i === 0 ? '' : ' ') + words[i];
                const data = JSON.stringify({
                  choices: [{ delta: { content: chunk } }],
                });
                res.write(`data: ${data}\n\n`);
                i++;
              } else {
                res.write('data: [DONE]\n\n');
                clearInterval(interval);
                res.end();
              }
            }, 20);
          } else {
            // Non-streaming (for API test button)
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                choices: [{ message: { content: 'ok' } }],
              })
            );
          }
        });
        return;
      }

      // 404
      res.writeHead(404);
      res.end('Not Found');
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        stop: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { startServer };
