import { ChildProcess, spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { exchangeLaunchToken } from './auth';
import { DshEndpoint } from './protocol';

const URL_PATTERN = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/\?token=[^\s"']+/;

export class DshProcessManager {
  private process?: ChildProcess;
  private endpoint?: DshEndpoint;
  private starting?: Promise<DshEndpoint>;

  async start(): Promise<DshEndpoint> {
    if (this.endpoint) return this.endpoint;
    if (this.starting) return this.starting;
    this.starting = this.startInternal().finally(() => { this.starting = undefined; });
    return this.starting;
  }
  private async startInternal(): Promise<DshEndpoint> {
    const command = resolveNpx();
    const child = this.process = spawn(command, ['-y', '@deepseek-ai/dsh@latest', 'web', '--no-open', '--port', '0'], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32'
    });
    const url = await this.readLaunchUrl(child);
    this.endpoint = await exchangeLaunchToken(url);
    return this.endpoint;
  }
  async restart(): Promise<DshEndpoint> { this.stop(); return this.start(); }
  stop(): void {
    this.endpoint = undefined;
    const child = this.process;
    this.process = undefined;
    if (!child?.pid) return;
    if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGTERM'); return; } catch { /* Fall through when no group was created. */ }
    }
    child.kill();
  }
  private readLaunchUrl(child: ChildProcess): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
        const found = output.match(URL_PATTERN)?.[0];
        if (found) resolve(found);
        if (output.length > 64_000) output = output.slice(-32_000);
      };
      child.stdout?.on('data', collect); child.stderr?.on('data', collect);
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`dsh web exited before startup (code ${code ?? 'unknown'}): ${output.slice(-2000)}`)));
      setTimeout(() => reject(new Error(`Timed out waiting for dsh web launch URL: ${output.slice(-2000)}`)), 90_000).unref();
    });
  }
}

/** VS Code Remote does not necessarily inherit the interactive shell's nvm PATH. */
function resolveNpx(): string {
  if (process.platform === 'win32') return 'npx.cmd';
  if (process.env.NVM_BIN && existsSync(join(process.env.NVM_BIN, 'npx'))) return join(process.env.NVM_BIN, 'npx');
  const versions = join(homedir(), '.nvm', 'versions', 'node');
  try {
    const candidate = readdirSync(versions).sort().reverse().map((version) => join(versions, version, 'bin', 'npx')).find(existsSync);
    if (candidate) return candidate;
  } catch { /* nvm is optional; use PATH below. */ }
  return 'npx';
}
