type Environment = Record<string, string | undefined>;

const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const dnsName =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Resolve the browser-facing Codespaces origin used by forwarded Vite ports.
 *
 * Values come only from the trusted Codespaces process environment. Invalid or
 * incomplete metadata fails closed by returning null instead of constructing a
 * permissive hostname.
 */
export function codespacesPublicOrigin(
  env: Environment,
  port: number,
): string | null {
  if (env.CODESPACES !== 'true') return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  const name = env.CODESPACE_NAME?.trim().toLowerCase();
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ?.trim()
    .toLowerCase()
    .replace(/\.$/, '');

  if (!name || !domain || !dnsLabel.test(name) || !dnsName.test(domain))
    return null;

  return `https://${name}-${port}.${domain}`;
}
