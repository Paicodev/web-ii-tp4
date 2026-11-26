import { existsSync } from 'node:fs';

export interface AppConfig {
  readonly port: number;
  readonly host: string;
  readonly catalogBaseUrl: string;
  readonly catalogTimeoutMs: number;
  readonly catalogDelayMs: number;
  readonly wsHeartbeatMs: number;
}

function loadLocalEnvFile(): void {
  if (!existsSync('.env')) {
    return;
  }

  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile('.env');
  }
}

function parseIntegerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  options: { min: number; max?: number }
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }

  if (!/^-?\d+$/.test(raw.trim())) {
    throw new Error(`La variable ${name} debe ser un número entero (recibido: "${raw}")`);
  }

  const parsed = Number.parseInt(raw.trim(), 10);
  if (parsed < options.min || (options.max !== undefined && parsed > options.max)) {
    const range =
      options.max !== undefined ? `entre ${options.min} y ${options.max}` : `mayor o igual a ${options.min}`;
    throw new Error(`La variable ${name} debe estar ${range} (recibido: ${parsed})`);
  }

  return parsed;
}

function parseUrlEnv(env: NodeJS.ProcessEnv, name: string, defaultValue: string): string {
  const raw = env[name]?.trim() || defaultValue;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`La variable ${name} no es una URL válida (recibido: "${raw}")`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`La variable ${name} debe usar protocolo http o https (recibido: "${raw}")`);
  }

  return raw.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) {
    loadLocalEnvFile();
  }

  return {
    port: parseIntegerEnv(env, 'PORT', 3000, { min: 1, max: 65535 }),
    host: env.HOST?.trim() || '0.0.0.0',
    catalogBaseUrl: parseUrlEnv(env, 'CATALOG_BASE_URL', 'https://dummyjson.com'),
    catalogTimeoutMs: parseIntegerEnv(env, 'CATALOG_TIMEOUT_MS', 5000, { min: 100 }),
    catalogDelayMs: parseIntegerEnv(env, 'CATALOG_DELAY_MS', 0, { min: 0, max: 60000 }),
    wsHeartbeatMs: parseIntegerEnv(env, 'WS_HEARTBEAT_MS', 30000, { min: 1000 }),
  };
}
