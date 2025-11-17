import { env } from './env';

export const abs = (p: string) => {
  const baseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, ''); // Remove trailing slash
  const path = p.startsWith('/') ? p : `/${p}`; // Ensure leading slash
  return `${baseUrl}${path}`;
};
