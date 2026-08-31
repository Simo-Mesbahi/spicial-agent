declare module 'cloudflare:workers' {
 export const env: { DB: import('./lib/atlas/api').Database };
}
