import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { env } from '../lib/env'
import * as schema from './schema'

/**
 * Singleton do pool — evita esgotar conexões durante hot reload
 * (ts-node-dev recarrega o módulo mas o processo continua).
 */
const globalForPool = globalThis as unknown as { _pgPool?: Pool }

const isPlaintext =
  env.DATABASE_URL.includes('.railway.internal') ||
  env.DATABASE_URL.includes('localhost') ||
  env.DATABASE_URL.includes('127.0.0.1')

export const pool =
  globalForPool._pgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    ssl: isPlaintext ? false : { rejectUnauthorized: false },
  })

if (env.NODE_ENV !== 'production') {
  globalForPool._pgPool = pool
}

export const db = drizzle(pool, { schema })
export { schema }
