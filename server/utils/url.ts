import { env } from './env';

export const abs = (p: string) => `${env.PUBLIC_BASE_URL}${p}`;
