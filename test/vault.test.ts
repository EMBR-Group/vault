// The parts that decide something without Touch ID or Bitwarden: config
// parsing, the env a command gets, rate-limit retries, shared reads, argv.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from '../src/cli.ts';
import { envFor, isRateLimited, parseMachineConfig, parseProjects, parseSecrets, retryWhileRateLimited, shareRecentRead, VaultError, type Secret } from '../src/index.ts';

const secret = (key: string, value: string): Secret => ({ id: key, key, value, revisionDate: '2026-11-05T00:00:00Z', projectId: 'p', organizationId: 'o' });

test('the machine config needs a token, and keeps what was stored with it', () => {
  assert.deepEqual(parseMachineConfig('{"token":"t","projectId":"p"}', '/x').data, { token: 't', projectId: 'p' });
  assert.equal(parseMachineConfig('{"token":"t"}', '/x').token, 't');
  assert.throws(() => parseMachineConfig('{"projectId":"p"}', '/x'), /holds no token/);
  assert.throws(() => parseMachineConfig('not json', '/x'), /not valid JSON/);
  assert.throws(() => parseMachineConfig('[]', '/x'), /not a JSON object/);
});

test('a command gets every secret and never the Bitwarden token', () => {
  const env = envFor([secret('SUPABASE_DB_PASSWORD', 'pw'), secret('API_KEY', 'k')], { PATH: '/bin', BWS_ACCESS_TOKEN: 'secret-token' });
  assert.equal(env['SUPABASE_DB_PASSWORD'], 'pw');
  assert.equal(env['API_KEY'], 'k');
  assert.equal(env['PATH'], '/bin');
  assert.equal('BWS_ACCESS_TOKEN' in env, false);
});

test('a key that is no env var name, or a key twice, is refused', () => {
  assert.throws(() => envFor([secret('has space', 'x')], {}), VaultError);
  assert.throws(() => envFor([secret('A', '1'), secret('A', '2')], {}), /in the vault twice/);
});

test('bws output is checked, not trusted', () => {
  assert.equal(parseSecrets([{ id: 'i', key: 'K', value: 'v', revisionDate: 'd', projectId: 'p' }])[0]?.key, 'K');
  assert.throws(() => parseSecrets({}), /other than a list/);
  assert.throws(() => parseSecrets([{ id: 'i', key: 'K' }]), /without a value/);
  assert.deepEqual(parseProjects([{ id: 'p', name: 'Makes Cents' }]), [{ id: 'p', name: 'Makes Cents' }]);
});

test('a rate-limited call is retried, anything else returned at once', () => {
  assert.ok(isRateLimited('Error: [429 Too Many Requests]'));
  assert.ok(!isRateLimited('404 Not Found'));
  let calls = 0;
  const slept: number[] = [];
  const r = retryWhileRateLimited(() => (++calls < 3 ? { status: 1, stderr: '429' } : { status: 0, stderr: '' }), { delays: [5, 10, 20], sleep: (ms) => { slept.push(ms); } });
  assert.equal(r.status, 0);
  assert.deepEqual(slept, [5, 10]);
  calls = 0;
  retryWhileRateLimited(() => { calls++; return { status: 1, stderr: '404' }; }, { delays: [5], sleep: () => undefined });
  assert.equal(calls, 1);
});

test('reads close together share one call; a failed one is not reused', async () => {
  let t = 0;
  let calls = 0;
  const read = shareRecentRead(() => { calls++; return Promise.resolve(calls); }, { freshMs: 100, now: () => t });
  assert.equal(await read(), 1);
  t = 50;
  assert.equal(await read(), 1);
  t = 200;
  assert.equal(await read(), 2);
  let fails = 0;
  const failing = shareRecentRead(() => { fails++; return Promise.reject(new Error('no')); }, { freshMs: 100, now: () => 0 });
  await assert.rejects(failing());
  await assert.rejects(failing());
  assert.equal(fails, 2);
});

test('argv: run takes the command after --, even a doubled one', () => {
  assert.deepEqual(parseArgs(['run', '--config', '/Library/EMBR/x.json', '--', '--', 'scripts/a.sh', '--yes']).program, ['scripts/a.sh', '--yes']);
  assert.deepEqual(parseArgs(['run', '--config', '/c', 'node', 'x.ts']).program, ['node', 'x.ts']);
  assert.throws(() => parseArgs(['run', '--config', '/c']), /needs a command/);
  assert.throws(() => parseArgs(['setup', '--config', '/c']), /needs --project/);
  assert.throws(() => parseArgs(['keys']), /--config is required/);
  assert.throws(() => parseArgs(['nope']), /Usage/);
});
