declare module 'cloudflare:workers' {
 export const env: {
  DB: import('./lib/atlas/api').Database;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_ORGANIZATION_ID?: string;
 };
}
