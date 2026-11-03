import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../api/_lib/rateLimit.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function('module', 'exports', compiled)(module, module.exports);
const { createRateLimiter } = module.exports;

const authSource = await readFile(new URL('../api/_lib/supabaseAuth.ts', import.meta.url), 'utf8');
const authCompiled = ts.transpileModule(authSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
let getUserResult;
let authClientOptions;
const authModule = { exports: {} };
new Function('require', 'module', 'exports', authCompiled)(
  (name) => {
    assert.equal(name, '@supabase/supabase-js');
    return {
      createClient: (_url, _key, options) => {
        authClientOptions = options;
        return { auth: { getUser: async () => getUserResult } };
      },
    };
  },
  authModule,
  authModule.exports,
);
const { authenticateSupabaseRequest } = authModule.exports;

test('rate limit blocks requests after the configured per-user budget', () => {
  const check = createRateLimiter();
  assert.equal(check('ai-chat:user-1', 2, 60_000, 1_000).allowed, true);
  assert.equal(check('ai-chat:user-1', 2, 60_000, 2_000).allowed, true);
  const limited = check('ai-chat:user-1', 2, 60_000, 3_000);
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfterSeconds, 58);
  assert.equal(check('ai-chat:user-2', 2, 60_000, 3_000).allowed, true);
});

test('rate limit resets after its window expires', () => {
  const check = createRateLimiter();
  assert.equal(check('notification-test:user-1', 1, 10_000, 1_000).allowed, true);
  assert.equal(check('notification-test:user-1', 1, 10_000, 2_000).allowed, false);
  assert.equal(check('notification-test:user-1', 1, 10_000, 11_000).allowed, true);
});

test('rate limiter fails closed at capacity instead of evicting active users', () => {
  const check = createRateLimiter(1);
  assert.equal(check('user-1', 5, 10_000, 1_000).allowed, true);
  assert.equal(check('user-2', 5, 10_000, 2_000).allowed, false);
  assert.equal(check('user-1', 5, 10_000, 3_000).allowed, true);
});

test('Supabase authentication rejects missing or invalid bearer tokens', async () => {
  const priorUrl = process.env.SUPABASE_URL;
  const priorKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://auth-test.invalid';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  try {
    const missing = await authenticateSupabaseRequest(undefined);
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 401);

    getUserResult = { data: { user: null }, error: { status: 401, message: 'invalid token' } };
    const invalid = await authenticateSupabaseRequest('Bearer expired-token');
    assert.equal(invalid.ok, false);
    assert.equal(invalid.status, 401);
    assert.equal(authClientOptions.global.headers.Authorization, 'Bearer expired-token');
  } finally {
    if (priorUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = priorUrl;
    if (priorKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = priorKey;
  }
});

test('Supabase authentication returns only the verified token identity', async () => {
  const priorUrl = process.env.SUPABASE_URL;
  const priorKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://auth-test.invalid';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  getUserResult = {
    data: { user: { id: 'auth-user-id', email: 'farmer@example.test' } },
    error: null,
  };
  try {
    const verified = await authenticateSupabaseRequest('Bearer valid-token');
    assert.equal(verified.ok, true);
    assert.equal(verified.user.id, 'auth-user-id');
  } finally {
    if (priorUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = priorUrl;
    if (priorKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = priorKey;
  }
});
