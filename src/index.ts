// @embr/vault: run one command with secrets from Bitwarden Secrets Manager,
// after Touch ID. This package holds no secrets, tokens or project ids:
// those live in Bitwarden and in a root-only file on each Mac (README.md).
//
// The pieces:
//   - A Bitwarden *machine account* token, read-only, one per repo, stored
//     once per Mac in a file only root can read (storeMachineConfig).
//   - Every read of that file is `sudo -k`, which is Touch ID, and leaves no
//     sudo ticket behind for anything else (readMachineConfig).
//   - One `bws secret list` per run (rate-limited tokens: retried on 429),
//     and the command gets the secrets as env vars, never the token (envFor).
//   - It refuses without a terminal: an agent's shell has none, and a Touch ID
//     prompt should only appear because the person at the Mac asked for it.
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

/** The exit code a wrapper uses when Touch ID was cancelled: nothing ran. */
export const TOUCH_ID_DECLINED = 75;

/** Something the vault refuses or could not do. Its message is for the person at the Mac. */
export class VaultError extends Error {
  override name = 'VaultError';
}

/** Touch ID (or the sudo password) was cancelled or refused: nothing was read. */
export class TouchIdDeclined extends VaultError {
  override name = 'TouchIdDeclined';
  constructor() { super('Touch ID was cancelled: nothing ran.'); }
}

/** Refuse unless a person is at a terminal (an agent's shell has none). */
export function requireTerminal(what: string): void {
  if (!process.stdin.isTTY) throw new VaultError(`${what} runs only in a terminal you are at: it asks for Touch ID. Run it yourself.`);
}

/** Ask a question at the terminal; `hidden` turns echo off (tokens). */
export function ask(question: string, { hidden = false }: { readonly hidden?: boolean } = {}): string {
  process.stderr.write(question);
  const r = spawnSync('/bin/sh', ['-c', hidden ? 'stty -echo; read v; stty echo; printf %s "$v"' : 'read v; printf %s "$v"'], {
    stdio: ['inherit', 'pipe', 'inherit'],
    encoding: 'utf-8',
  });
  if (hidden) process.stderr.write('\n');
  return r.stdout.trim();
}

// ---------------------------------------------------------------- the machine config

/** What the root-only file holds: the token, plus whatever the caller stored with it (project ids). */
export interface MachineConfig {
  readonly token: string;
  readonly data: Readonly<Record<string, unknown>>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The file's text → its config. Throws a VaultError naming the file when it is not one. */
export function parseMachineConfig(text: string, path: string): MachineConfig {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new VaultError(`${path} is not valid JSON. Run the vault's setup again.`); }
  if (!isRecord(json)) throw new VaultError(`${path} is not a JSON object. Run the vault's setup again.`);
  const token = json['token'];
  if (typeof token !== 'string' || token === '') throw new VaultError(`${path} holds no token. Run the vault's setup again.`);
  return { token, data: json };
}

function checkPath(path: string): void {
  if (!isAbsolute(path)) throw new VaultError(`The vault's config path must be absolute, not ${path}.`);
}

/** Read the root-only file through `sudo -k` (Touch ID every time, no sudo ticket left behind). */
export function readMachineConfig(path: string): MachineConfig {
  checkPath(path);
  const r = spawnSync('sudo', ['-k', '/bin/cat', path], { stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf-8' });
  if (r.status !== 0) {
    // Past Touch ID only cat can fail, and it names itself; anything else is sudo refused.
    if (!/\bcat: /.test(r.stderr)) throw new TouchIdDeclined();
    throw new VaultError(`Could not read ${path}. Set the vault up once on this Mac (its setup command).`);
  }
  return parseMachineConfig(r.stdout, path);
}

/**
 * Write the root-only file (Touch ID), then check it really is unreadable
 * without sudo. Its folder is made root-only too.
 */
export function storeMachineConfig(path: string, config: { readonly token: string } & Readonly<Record<string, unknown>>): void {
  checkPath(path);
  const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
  const dir = dirname(path);
  const script = ['umask 077', `mkdir -p ${q(dir)}`, `chmod 700 ${q(dir)}`, `cat > ${q(path)}`, `chmod 400 ${q(path)}`, `chown root:wheel ${q(dir)} ${q(path)}`].join(' && ');
  const wrote = spawnSync('sudo', ['-k', '/bin/sh', '-c', script], { input: JSON.stringify(config), stdio: ['pipe', 'inherit', 'inherit'] });
  if (wrote.status !== 0) throw new VaultError('Nothing was stored.');
  let readable = true;
  try { accessSync(path, constants.R_OK); } catch { readable = false; }
  if (readable) throw new VaultError(`${path} is readable without sudo, which defeats the point. Check its owner and mode.`);
}

// ---------------------------------------------------------------- Bitwarden

// Bitwarden answers 429 when one token calls it in a burst: wait it out
// rather than fail. Any other failure is returned at once.
export const RATE_LIMIT_DELAYS_MS: readonly number[] = [1000, 2000, 4000];

export function isRateLimited(stderr: string): boolean {
  return /\b429\b|too many requests/i.test(stderr);
}

interface Ran { readonly status: number | null; readonly stdout: string; readonly stderr: string }

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function retryWhileRateLimited<R extends { readonly status: number | null; readonly stderr: string }>(
  attempt: () => R,
  { delays = RATE_LIMIT_DELAYS_MS, sleep = sleepSync }: { readonly delays?: readonly number[]; readonly sleep?: (ms: number) => void } = {},
): R {
  let result = attempt();
  for (const ms of delays) {
    if (result.status === 0 || !isRateLimited(result.stderr)) return result;
    console.error(`Bitwarden asked to slow down; trying again in ${String(ms / 1000)}s.`);
    sleep(ms);
    result = attempt();
  }
  return result;
}

/** `retryWhileRateLimited` for a caller that must keep answering while it waits. */
export async function retryWhileRateLimitedAsync<R extends { readonly status: number | null; readonly stderr: string }>(
  attempt: () => Promise<R>,
  { delays = RATE_LIMIT_DELAYS_MS, sleep = (ms: number) => new Promise<void>((done) => { setTimeout(done, ms); }) }: { readonly delays?: readonly number[]; readonly sleep?: (ms: number) => Promise<void> } = {},
): Promise<R> {
  let result = await attempt();
  for (const ms of delays) {
    if (result.status === 0 || !isRateLimited(result.stderr)) return result;
    console.error(`Bitwarden asked to slow down; trying again in ${String(ms / 1000)}s.`);
    await sleep(ms);
    result = await attempt();
  }
  return result;
}

/**
 * `read`, shared: a call while one is in flight, or within `freshMs` of one
 * that succeeded, gets that one's result. A failed read is never reused.
 */
export function shareRecentRead<T>(read: () => Promise<T>, { freshMs, now = Date.now }: { readonly freshMs: number; readonly now?: () => number }): () => Promise<T> {
  let last: { at: number | undefined; readonly value: Promise<T> } | undefined;
  return () => {
    if (last && (last.at === undefined || now() - last.at < freshMs)) return last.value;
    const entry: { at: number | undefined; readonly value: Promise<T> } = { at: undefined, value: read() };
    last = entry;
    entry.value.then(() => { entry.at = now(); }, () => { if (last === entry) last = undefined; });
    return entry.value;
  };
}

/** The env bws runs with: ours plus the token. */
const bwsEnv = (token: string): NodeJS.ProcessEnv => ({ ...process.env, BWS_ACCESS_TOKEN: token });

function parsed(args: readonly string[], r: Ran): unknown {
  if (r.status !== 0) throw new VaultError(`Bitwarden refused bws ${args.join(' ')}:\n${r.stderr.trim()}`);
  try { return JSON.parse(r.stdout); } catch { throw new VaultError(`bws ${args.join(' ')} printed something other than JSON.`); }
}

/** One bws call (JSON out), retried while rate limited. Throws what Bitwarden said. */
export function bws(token: string, args: readonly string[]): unknown {
  return parsed(args, retryWhileRateLimited(() => spawnSync('bws', [...args, '--output', 'json'], {
    env: bwsEnv(token), encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024,
  })));
}

/** `bws` without blocking the event loop. */
export async function bwsAsync(token: string, args: readonly string[]): Promise<unknown> {
  return parsed(args, await retryWhileRateLimitedAsync(() => new Promise<Ran>((done) => {
    const child = spawn('bws', [...args, '--output', 'json'], { env: bwsEnv(token), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (d: string) => { stdout += d; });
    child.stderr.on('data', (d: string) => { stderr += d; });
    child.on('error', (e) => { done({ status: null, stdout, stderr: stderr + e.message }); });
    child.on('close', (status) => { done({ status, stdout, stderr }); });
  })));
}

export interface Secret {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly revisionDate: string;
  readonly projectId: string | undefined;
  readonly organizationId: string | undefined;
}

export interface Project {
  readonly id: string;
  readonly name: string;
}

const str = (o: Record<string, unknown>, k: string, what: string): string => {
  const v = o[k];
  if (typeof v !== 'string') throw new VaultError(`bws printed a ${what} without a ${k}.`);
  return v;
};
const optStr = (o: Record<string, unknown>, k: string): string | undefined => {
  const v = o[k];
  return typeof v === 'string' ? v : undefined;
};

/** `bws secret list` output → secrets. */
export function parseSecrets(json: unknown): Secret[] {
  if (!Array.isArray(json)) throw new VaultError('bws secret list printed something other than a list.');
  return json.map((s: unknown) => {
    if (!isRecord(s)) throw new VaultError('bws secret list printed a row that is not an object.');
    return { id: str(s, 'id', 'secret'), key: str(s, 'key', 'secret'), value: str(s, 'value', 'secret'), revisionDate: str(s, 'revisionDate', 'secret'), projectId: optStr(s, 'projectId'), organizationId: optStr(s, 'organizationId') };
  });
}

/** `bws project list` output → projects. */
export function parseProjects(json: unknown): Project[] {
  if (!Array.isArray(json)) throw new VaultError('bws project list printed something other than a list.');
  return json.map((p: unknown) => {
    if (!isRecord(p)) throw new VaultError('bws project list printed a row that is not an object.');
    return { id: str(p, 'id', 'project'), name: str(p, 'name', 'project') };
  });
}

/** Every secret the token reads; with a project id, only that project's (refusing any other). */
export function listSecrets(token: string, projectId?: string): Secret[] {
  const all = parseSecrets(bws(token, projectId === undefined ? ['secret', 'list'] : ['secret', 'list', projectId]));
  if (projectId === undefined) return all;
  const stray = all.filter((s) => s.projectId !== projectId);
  if (stray.length) throw new VaultError(`bws returned ${String(stray.length)} secret(s) outside project ${projectId}.`);
  return all;
}

/** Every project the token reads. */
export function listProjects(token: string): Project[] {
  return parseProjects(bws(token, ['project', 'list']));
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The environment a command gets: `base` without any Bitwarden token, plus
 * each secret under its key. Refuses a key that is not an env var name, or
 * two secrets under one key (which would win is not something to guess).
 */
export function envFor(secrets: readonly Secret[], base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(base).filter(([name]) => name !== 'BWS_ACCESS_TOKEN'));
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const s of secrets) {
    if (!ENV_NAME.test(s.key)) problems.push(`${s.key} is not an environment variable name`);
    else if (seen.has(s.key)) problems.push(`${s.key} is in the vault twice`);
    seen.add(s.key);
    env[s.key] = s.value;
  }
  if (problems.length) throw new VaultError(`The vault's keys need fixing in Bitwarden:\n  ${problems.join('\n  ')}`);
  return env;
}

/** A project's page in the Bitwarden web app, for telling a person where a value goes. */
export function projectLink(organizationId: string | undefined, projectId: string): string {
  return organizationId ? `https://vault.bitwarden.com/#/sm/${organizationId}/projects/${projectId}/secrets` : 'https://vault.bitwarden.com/#/sm';
}
