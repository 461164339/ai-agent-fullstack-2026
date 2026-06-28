import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const docsUrl = process.env.API_DOCS_URL ?? 'http://localhost:3000/api/docs';
const waitTimeoutMs = Number(process.env.API_DOCS_WAIT_MS ?? 45_000);

if (await isReachable(docsUrl)) {
  openChrome(docsUrl);
  process.exit(0);
}

await runPnpm(['--filter', '@ai-agent/shared', 'build']);

const api = spawnProcess('pnpm', ['--filter', '@ai-agent/api', 'start:dev'], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});

api.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    api.kill(signal);
  });
}

try {
  await waitUntilReachable(docsUrl, waitTimeoutMs);
  openChrome(docsUrl);
  console.log(`Swagger docs opened in Chrome: ${docsUrl}`);
} catch {
  console.log(`API is starting. Open Swagger manually when ready: ${docsUrl}`);
}

async function waitUntilReachable(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(url)) {
      return;
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function isReachable(url) {
  try {
    const response = await fetch(url, {
      redirect: 'manual',
    });

    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

function openChrome(url) {
  const opener = getChromeOpener(url);
  const child = spawnProcess(opener.command, opener.args, {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
}

function runPnpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('pnpm', args, {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`pnpm ${args.join(' ')} exited with ${code}`));
    });
  });
}

function spawnProcess(command, args, options = {}) {
  if (process.platform !== 'win32') {
    return spawn(command, args, options);
  }

  return spawn(process.env.ComSpec ?? 'cmd.exe', [
    '/d',
    '/s',
    '/c',
    [command, ...args].join(' '),
  ], options);
}

function getChromeOpener(url) {
  if (process.platform === 'win32') {
    return {
      command: 'start',
      args: ['""', 'chrome', url],
    };
  }

  if (process.platform === 'darwin') {
    return {
      command: 'open',
      args: ['-a', 'Google Chrome', url],
    };
  }

  return {
    command: 'google-chrome',
    args: [url],
  };
}
