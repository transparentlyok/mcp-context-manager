#!/usr/bin/env node

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');
const SERVER_NAME = 'context-manager';

// Detect if running as postinstall in global mode
const isGlobalInstall = process.env.npm_config_global === 'true';
if (isGlobalInstall && !process.argv.includes('--force')) {
  console.log('[install] Global install detected.');
  console.log('[install] Run "mcp-context-setup" after installation to configure Claude.');
  process.exit(0);
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: 'pipe', ...opts }).toString().trim();
  } catch (e) {
    return null;
  }
}

function log(msg) { console.log(`[install] ${msg}`); }
function err(msg) { console.error(`[install] ERROR: ${msg}`); }

// 1. Check if already built (npm published package)
if (!fs.existsSync(DIST_ENTRY)) {
  // Building from source (development mode)
  log('Building from source...');

  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    log('Installing dependencies...');
    execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
  }

  try {
    execSync('npx tsc', { cwd: ROOT, stdio: 'inherit' });
  } catch {
    err('TypeScript build failed');
    process.exit(1);
  }

  if (!fs.existsSync(DIST_ENTRY)) {
    err('Build output not found at ' + DIST_ENTRY);
    process.exit(1);
  }
} else {
  log('Using pre-built package');
}

// 3. Verify the server starts
log('Verifying server...');
const { spawn } = require('child_process');
const verify = new Promise((resolve, reject) => {
  const proc = spawn('node', [DIST_ENTRY], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  proc.stdout.on('data', d => stdout += d.toString());
  proc.stderr.on('data', () => {});

  const initMsg = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'install-check', version: '1.0.0' } }
  });
  proc.stdin.write(initMsg + '\n');

  setTimeout(() => {
    proc.kill();
    if (stdout.includes('"result"')) {
      resolve();
    } else {
      reject(new Error('Server did not respond to initialize'));
    }
  }, 3000);

  proc.on('error', reject);
});

verify.then(() => {
  log('Server verified OK');
  registerWithClaude();
}).catch(e => {
  err('Server verification failed: ' + e.message);
  process.exit(1);
});

function registerWithClaude() {
  // 4. Check if claude CLI exists
  const claudePath = run('which claude') || run('where claude');
  if (!claudePath) {
    log('Claude Code CLI not found in PATH.');
    log('To manually register, run:');
    log(`  claude mcp add --transport stdio --scope user ${SERVER_NAME} -- node "${DIST_ENTRY}"`);
    return;
  }

  // 5. Remove existing registration (ignore errors)
  run(`claude mcp remove ${SERVER_NAME} --scope user`);
  run(`claude mcp remove ${SERVER_NAME}`);

  // 6. Register with user scope
  log('Registering MCP server with Claude Code...');
  const entryPosix = DIST_ENTRY.replace(/\\/g, '/');
  const result = run(`claude mcp add --transport stdio --scope user ${SERVER_NAME} -- node "${entryPosix}"`);

  if (result === null) {
    err('Failed to register with Claude Code.');
    log('To manually register, run:');
    log(`  claude mcp add --transport stdio --scope user ${SERVER_NAME} -- node "${entryPosix}"`);
    process.exit(1);
  }

  log('Registered successfully!');

  // 7. Verify registration
  const list = run('claude mcp list');
  if (list && list.includes(SERVER_NAME)) {
    log('Confirmed: server appears in claude mcp list');
  }

  log('');
  log('Done! The context-manager MCP server is now available in Claude Code.');
  log('Restart Claude Code or start a new session to use it.');
}
