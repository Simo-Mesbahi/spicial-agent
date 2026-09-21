import test from 'node:test';
import assert from 'node:assert/strict';

import { codespacesPublicOrigin } from '../build/codespaces-origin.ts';

test('Codespaces public origin is derived deterministically for the fixed dev port', () => {
  assert.equal(
    codespacesPublicOrigin(
      {
        CODESPACES: 'true',
        CODESPACE_NAME: 'upgraded-space-fiesta-g4799vrq4rqwcww9',
        GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
      },
      5173,
    ),
    'https://upgraded-space-fiesta-g4799vrq4rqwcww9-5173.app.github.dev',
  );
});

test('Codespaces public origin is absent outside Codespaces', () => {
  assert.equal(
    codespacesPublicOrigin(
      {
        CODESPACES: 'false',
        CODESPACE_NAME: 'example',
        GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
      },
      5173,
    ),
    null,
  );
});

test('Codespaces public origin rejects malformed environment metadata', () => {
  assert.equal(
    codespacesPublicOrigin(
      {
        CODESPACES: 'true',
        CODESPACE_NAME: 'bad/name',
        GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
      },
      5173,
    ),
    null,
  );

  assert.equal(
    codespacesPublicOrigin(
      {
        CODESPACES: 'true',
        CODESPACE_NAME: 'valid-name',
        GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev/path',
      },
      5173,
    ),
    null,
  );
});

test('Codespaces public origin rejects invalid ports', () => {
  const env = {
    CODESPACES: 'true',
    CODESPACE_NAME: 'valid-name',
    GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
  };

  assert.equal(codespacesPublicOrigin(env, 0), null);
  assert.equal(codespacesPublicOrigin(env, 65536), null);
  assert.equal(codespacesPublicOrigin(env, 5173.5), null);
});
