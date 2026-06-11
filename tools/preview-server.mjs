import { createServer } from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import { createAiGateway } from './ai-gateway.mjs';
import { createAgentRunGateway } from './agent-run-gateway.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number.parseInt(process.env.PORT || '8766', 10);
const aiGateway = createAiGateway();
const agentRunGateway = createAgentRunGateway();

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_048_576) {
        rejectBody(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!raw.trim()) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch (error) {
        rejectBody(error);
      }
    });
    request.on('error', rejectBody);
  });
}

function statusForError(error) {
  const message = String(error?.message ?? error);
  if (message.includes('unsupported company')) return 400;
  if (message.includes('unsupported period')) return 400;
  if (message.includes('missing company-period data')) return 400;
  if (message.includes('unknown run')) return 404;
  if (message.includes('Request body too large')) return 413;
  if (message.includes('Unexpected token')) return 400;
  return 500;
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host}`);
  if (requestUrl.pathname === '/api/agent/run') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method Not Allowed' });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await agentRunGateway.startRun({
        companyKey: body.companyKey,
        periodKey: body.periodKey,
      });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, statusForError(error), {
        error: 'Agent run start failed',
        message: String(error?.message ?? error),
      });
    }
    return;
  }

  if (requestUrl.pathname.startsWith('/api/agent/run/')) {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Method Not Allowed' });
      return;
    }

    try {
      const runId = decodeURIComponent(requestUrl.pathname.replace('/api/agent/run/', ''));
      const result = await agentRunGateway.getRun(runId);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, statusForError(error), {
        error: 'Agent run status failed',
        message: String(error?.message ?? error),
      });
    }
    return;
  }

  if (requestUrl.pathname === '/api/ai/analyze') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method Not Allowed' });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await aiGateway.analyze(body);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, statusForError(error), {
        error: 'AI analyze failed',
        message: String(error?.message ?? error),
      });
    }
    return;
  }

  if (requestUrl.pathname === '/api/ai/chat') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method Not Allowed' });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const result = await aiGateway.chat(body);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, statusForError(error), {
        error: 'AI chat failed',
        message: String(error?.message ?? error),
      });
    }
    return;
  }

  const relativePath = requestUrl.pathname === '/'
    ? 'index.html'
    : decodeURIComponent(requestUrl.pathname.slice(1));
  const filePath = resolve(root, relativePath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`preview-server listening on http://127.0.0.1:${port}`);
});
