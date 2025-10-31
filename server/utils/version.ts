export const BUILD = {
  git: process.env.REPL_SLUG || 'unknown',
  dist: Math.random().toString(16).slice(2,10),
  timestamp: new Date().toISOString(),
};
