import test from 'node:test';
import assert from 'node:assert/strict';

import {
  configuredPublicOrigin,
  mutationOriginAllowed,
} from '../lib/atlas/request-security.ts';

function request(url, origin) {
  return new Request(url, {
    method: 'POST',
    headers: origin ? { Origin: origin } : {},
  });
}

test('direct same-origin mutation is accepted', () => {
  assert.equal(
    mutationOriginAllowed(
      request('https://atlas.test/api/session', 'https://atlas.test'),
      {},
    ),
    true,
  );
});

test('same-host HTTPS to internal HTTP TLS termination is accepted without proxy header trust', () => {
  assert.equal(
    mutationOriginAllowed(
      request(
        'http://codespace-5173.app.github.dev/api/session',
        'https://codespace-5173.app.github.dev',
      ),
      {},
    ),
    true,
  );
});

test('exact configured public origin is accepted when the trusted proxy rewrites the host', () => {
  assert.equal(
    mutationOriginAllowed(
      request(
        'http://127.0.0.1:5173/api/session',
        'https://codespace-5173.app.github.dev',
      ),
      {
        APP_ENVIRONMENT: 'LOCAL',
        APP_PUBLIC_ORIGIN: 'https://codespace-5173.app.github.dev',
      },
    ),
    true,
  );
});

test('arbitrary cross-origin mutation remains rejected', () => {
  assert.equal(
    mutationOriginAllowed(
      request('http://127.0.0.1:5173/api/session', 'https://attacker.example'),
      {
        APP_ENVIRONMENT: 'LOCAL',
        APP_PUBLIC_ORIGIN: 'https://codespace-5173.app.github.dev',
      },
    ),
    false,
  );
});

test('origin hostname lookalikes are rejected', () => {
  assert.equal(
    mutationOriginAllowed(
      request(
        'http://127.0.0.1:5173/api/session',
        'https://codespace-5173.app.github.dev.attacker.example',
      ),
      {
        APP_ENVIRONMENT: 'LOCAL',
        APP_PUBLIC_ORIGIN: 'https://codespace-5173.app.github.dev',
      },
    ),
    false,
  );
});

test('configured public origins with a path fail closed', () => {
  const env = {
    APP_ENVIRONMENT: 'LOCAL',
    APP_PUBLIC_ORIGIN: 'https://codespace-5173.app.github.dev/path',
  };
  assert.equal(configuredPublicOrigin(env), null);
  assert.equal(
    mutationOriginAllowed(
      request(
        'http://127.0.0.1:5173/api/session',
        'https://codespace-5173.app.github.dev',
      ),
      env,
    ),
    false,
  );
});

test('configured public origins with embedded credentials fail closed', () => {
  assert.equal(
    configuredPublicOrigin({
      APP_ENVIRONMENT: 'LOCAL',
      APP_PUBLIC_ORIGIN: 'https://user:password@codespace-5173.app.github.dev',
    }),
    null,
  );
});

test('non-local public origin requires HTTPS', () => {
  assert.equal(
    configuredPublicOrigin({
      APP_ENVIRONMENT: 'PRODUCTION',
      APP_PUBLIC_ORIGIN: 'http://support.example.com',
    }),
    null,
  );
  assert.equal(
    configuredPublicOrigin({
      APP_ENVIRONMENT: 'PRODUCTION',
      APP_PUBLIC_ORIGIN: 'https://support.example.com',
    }),
    'https://support.example.com',
  );
});

test('an exact configured port is part of the origin contract', () => {
  assert.equal(
    mutationOriginAllowed(
      request('http://127.0.0.1:5173/api/session', 'https://support.example.com:8443'),
      {
        APP_ENVIRONMENT: 'LOCAL',
        APP_PUBLIC_ORIGIN: 'https://support.example.com',
      },
    ),
    false,
  );
});

test('missing Origin remains compatible with non-browser callers', () => {
  assert.equal(
    mutationOriginAllowed(
      request('https://atlas.test/api/session'),
      { APP_ENVIRONMENT: 'PRODUCTION' },
    ),
    true,
  );
});
