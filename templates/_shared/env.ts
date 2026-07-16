export function requireEnv(key: string, allowEmpty = false): string {
  const v = (typeof process !== 'undefined' ? process.env?.[key] : undefined) ?? '';
  if (!allowEmpty && !v) {
    throw new Error(`Missing required env: ${key}`);
  }
  return v;
}

export function optionalEnv(key: string, fallback = ''): string {
  const v = (typeof process !== 'undefined' ? process.env?.[key] : undefined) ?? '';
  return v || fallback;
}
