export function requireEnv(key: string, allowEmpty = false): string {
  const v = (typeof process !== 'undefined' && process.env) ? process.env[key] ?? '' : '';
  if (!allowEmpty && !v) throw new Error(`Missing required env: ${key}`);
  return v;
}
export function optionalEnv(key: string, fallback = ''): string { return (typeof process !== 'undefined' && process.env) ? (process.env[key] ?? fallback) : fallback; }
