import type { NextConfig } from 'next';
import { codespacesPublicOrigin } from './build/codespaces-origin';

const DEV_PORT = 5173;
const codespacesOrigin = codespacesPublicOrigin(process.env, DEV_PORT);
const codespacesHostname = codespacesOrigin ? new URL(codespacesOrigin).hostname : null;

const nextConfig: NextConfig = {
  // Vinext performs its own dev-server origin validation before requests reach
  // the Worker. Allow only this Codespace's exact forwarded hostname; never a
  // wildcard such as *.app.github.dev.
  allowedDevOrigins: codespacesHostname ? [codespacesHostname] : [],
};

export default nextConfig;
