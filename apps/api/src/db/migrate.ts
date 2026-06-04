import 'dotenv/config'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { resolve } from 'node:path'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[MIGRATE] DATABASE_URL não definido — abortando.')
    process.exit(1)
  }

  // SSL: Railway internal e localhost rodam em rede privada/loopback (sem TLS).
  // Tudo o mais (public Railway, cloud Postgres) precisa SSL com cert relaxado.
  const isPlaintext =
    url.includes('.railway.internal') ||
    url.includes('localhost') ||
    url.includes('127.0.0.1')

  console.log(`[MIGRATE] Iniciando migrate (ssl=${!isPlaintext})`)

  const pool = new Pool({
    connectionString: url,
    ssl: isPlaintext ? false : { rejectUnauthorized: false },
  })

  const db = drizzle(pool)

  const migrationsFolder = resolve(__dirname, '../../drizzle/migrations')
  console.log(`[MIGRATE] Lendo migrations de: ${migrationsFolder}`)

  try {
    await migrate(db, { migrationsFolder })
    console.log('[MIGRATE] Concluído com sucesso.')
  } catch (err) {
    console.error('[MIGRATE] Falhou:', err)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[MIGRATE] Erro não tratado:', err)
  process.exit(1)
})
