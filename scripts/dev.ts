/**
 * One-command dev server.
 *
 * `bun run dev` is the only thing a developer should need.
 *
 * Default behaviour (no DATABASE_URL in the environment): the script uses
 * SQLite at ./.tmp/dev.db — no Docker or any other external services required.
 * The parent directory is created automatically on first run.
 *
 * Postgres mode: set DATABASE_URL=postgres://... to run against a Postgres
 * database. When it points at this machine, the script manages the local
 * docker postgres for you (a remote host is left alone):
 *
 *   1. Verifies the docker daemon is reachable.
 *   2. Brings up the `postgres` compose service (`up -d`, so a container
 *      built from an older compose config gets reconciled).
 *   3. Stops the `app` compose service if it IS running (it would
 *      otherwise hold port 3001 and block the local cms).
 *   4. Checks the published host port matches DATABASE_URL, then runs one
 *      real query so a foreign postgres squatting on that port is reported
 *      as such instead of as an authentication failure.
 *
 * Either way, the script then:
 *
 *   - Runs `bun install --frozen-lockfile` so a checkout pulled after a
 *     dependency change does not start a CMS that dies on its first import.
 *   - Pre-checks ports 3001 (cms) and 5173 (vite) and prints an
 *     actionable message if either is held by something we don't own.
 *   - Spawns the cms (`bun --watch server/index.ts`) and vite
 *     (`bun node_modules/vite/bin/vite.js --host 127.0.0.1`) as children, forwarding their output
 *     and signals so Ctrl+C cleanly kills both.
 */

import { SQL } from 'bun'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isSqliteUrl } from '../server/db'
import { bunCommand, viteCommand } from './lib/bunCommand'
import { ensureDependencies } from './lib/ensureDependencies'
import { isLoopbackHost, parsePublishedPort } from './lib/composePort'
import { ensurePortFree } from './lib/freePort'

const CMS_PORT = Number(process.env.PORT ?? '3001')
const VITE_PORT = Number(process.env.VITE_PORT ?? '5173')
const DATABASE_URL = process.env.DATABASE_URL ?? 'sqlite:./.tmp/dev.db'

const decoder = new TextDecoder()

function log(msg: string): void {
  console.error(`[dev] ${msg}`)
}

function fail(...lines: string[]): never {
  for (const line of lines) log(line)
  process.exit(1)
}

// --- docker helpers -------------------------------------------------------

function dockerInstalled(): boolean {
  const result = Bun.spawnSync(['docker', '--version'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
  return result.exitCode === 0
}

function dockerDaemonRunning(): boolean {
  const result = Bun.spawnSync(['docker', 'info'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
  return result.exitCode === 0
}

interface ComposeServiceState {
  state: 'running' | 'exited' | 'paused' | 'created' | 'restarting' | 'dead' | 'absent'
}

/**
 * Reads the state of a compose service. Handles both the NDJSON output
 * from older docker-compose versions and the JSON-array output from newer
 * versions; returns 'absent' when no entry is found.
 */
function getComposeServiceState(service: string): ComposeServiceState['state'] {
  const result = Bun.spawnSync(
    ['docker', 'compose', 'ps', '--all', '--format', 'json', service],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  if (result.exitCode !== 0) return 'absent'

  const stdout = decoder.decode(result.stdout).trim()
  if (!stdout) return 'absent'

  const parseEntry = (raw: unknown): ComposeServiceState['state'] | null => {
    if (!raw || typeof raw !== 'object') return null
    const entry = raw as { Service?: string; State?: string; Name?: string }
    if (entry.Service !== service) return null
    const state = entry.State?.toLowerCase()
    if (
      state === 'running' ||
      state === 'exited' ||
      state === 'paused' ||
      state === 'created' ||
      state === 'restarting' ||
      state === 'dead'
    ) {
      return state
    }
    return null
  }

  // Newer compose: a single JSON array.
  if (stdout.startsWith('[')) {
    try {
      const arr = JSON.parse(stdout) as unknown[]
      for (const entry of arr) {
        const state = parseEntry(entry)
        if (state) return state
      }
    } catch {
      // fall through to NDJSON
    }
  }

  // Older / default compose: one JSON object per line.
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const state = parseEntry(JSON.parse(trimmed))
      if (state) return state
    } catch {
      // ignore unparseable lines
    }
  }

  return 'absent'
}

function runDocker(args: string[], description: string): void {
  log(description)
  const result = Bun.spawnSync(['docker', ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (result.exitCode !== 0) {
    fail(`\`docker ${args.join(' ')}\` exited with code ${result.exitCode}.`)
  }
}

function ensurePostgresRunning(): void {
  // `up -d` is idempotent AND reconciles the container with the compose file.
  // `compose start` is not: it revives a container built from a stale config
  // (e.g. one created before the host port mapping existed) forever.
  runDocker(
    ['compose', 'up', '-d', 'postgres'],
    'Bringing up the docker postgres service...',
  )
}

function stopAppContainerIfRunning(): void {
  const state = getComposeServiceState('app')
  if (state === 'running') {
    runDocker(
      ['compose', 'stop', 'app'],
      'Docker `app` container is running — stopping it (it would conflict with the local cms on port 3001)...',
    )
  }
}

/**
 * Fails when the port compose actually published differs from the one
 * DATABASE_URL dials. Without this the app silently connects to whatever
 * other postgres happens to own that port and reports an auth failure that
 * looks like a credentials problem.
 *
 * A `null` reading (compose cannot describe the container) is not fatal —
 * `assertDatabaseUsable` is the real gate.
 */
function assertPublishedPortMatches(expected: number): void {
  const result = Bun.spawnSync(['docker', 'compose', 'port', 'postgres', '5432'], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  if (result.exitCode !== 0) return
  const published = parsePublishedPort(decoder.decode(result.stdout))
  if (published === null || published === expected) return

  fail(
    `DATABASE_URL points at port ${expected}, but the docker postgres is published on ${published}.`,
    `Set POSTGRES_HOST_PORT=${expected} in .env (docker-compose.yml reads it), or point`,
    `DATABASE_URL at port ${published}.`,
  )
}

/** Waits for the port to start accepting TCP connections (container boot). */
async function waitForPort(hostname: string, port: number, timeoutMs = 60_000): Promise<void> {
  log(`Waiting for postgres at ${hostname}:${port}...`)
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      // Bun.connect requires at least one handler, even for a liveness probe.
      const socket = await Bun.connect({ hostname, port, socket: { data() {} } })
      socket.end()
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  fail(`Nothing is listening on ${hostname}:${port} after ${timeoutMs}ms.`)
}

/**
 * Runs one real query. A TCP probe only proves *something* answers; this
 * proves it is OUR database. The difference matters because a postgres from
 * an unrelated project holding the same host port fails here with an opaque
 * "password authentication failed", which is not a credentials problem at all.
 */
async function assertDatabaseUsable(url: string, hostname: string, port: number): Promise<void> {
  const sql = new SQL(url)
  try {
    await sql`select 1`
    log('Postgres is accepting connections.')
  } catch (err) {
    fail(
      `Something answers on ${hostname}:${port}, but it rejected us: ${String(err)}`,
      'That usually means another postgres owns this port. List what is bound with:',
      '  docker ps --format "{{.Names}} | {{.Ports}}"',
      'Then pick a free port via POSTGRES_HOST_PORT + DATABASE_URL in .env.',
    )
  } finally {
    await sql.end()
  }
}

// --- main -----------------------------------------------------------------

if (isSqliteUrl(DATABASE_URL)) {
  const dbPath = DATABASE_URL.replace(/^sqlite:|^file:/, '')
  await mkdir(dirname(dbPath), { recursive: true })
  log(`Using SQLite at ${dbPath} — skipping Postgres docker provisioning`)
} else {
  const dbUrl = new URL(DATABASE_URL)
  const dbPort = Number(dbUrl.port || '5432')

  if (isLoopbackHost(dbUrl.hostname)) {
    if (!dockerInstalled()) {
      fail('Docker is not installed. Install Docker Desktop, or set DATABASE_URL to point at your own postgres.')
    }
    if (!dockerDaemonRunning()) {
      fail('Docker daemon is not running. Start Docker Desktop, or set DATABASE_URL to point at your own postgres.')
    }
    ensurePostgresRunning()
    stopAppContainerIfRunning()
    assertPublishedPortMatches(dbPort)
  } else {
    log(`DATABASE_URL points at ${dbUrl.hostname} — skipping docker postgres provisioning.`)
  }

  await waitForPort(dbUrl.hostname, dbPort)
  await assertDatabaseUsable(DATABASE_URL, dbUrl.hostname, dbPort)
}

await ensureDependencies(log)

await ensurePortFree(CMS_PORT, 'cms', log)
await ensurePortFree(VITE_PORT, 'vite', log)

log('')
log(`Open the editor at:  http://localhost:${VITE_PORT}`)
log(`CMS API runs on:     http://localhost:${CMS_PORT} (you usually don't open this directly)`)
log('')

// --- spawn cms + vite -----------------------------------------------------

interface DevProcess {
  name: string
  command: string[]
  env?: Record<string, string>
}

const processes: DevProcess[] = [
  {
    name: 'cms',
    command: bunCommand('--watch', 'server/index.ts'),
    env: {
      PORT: String(CMS_PORT),
      DATABASE_URL,
      STATIC_DIR: process.env.STATIC_DIR ?? './dist',
      UPLOADS_DIR: process.env.UPLOADS_DIR ?? './uploads',
    },
  },
  {
    name: 'vite',
    command: viteCommand('--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'),
    // vite.config.ts reads PORT for both the proxy target and the collab
    // socket's dev port. Inheriting it from the developer's shell happened to
    // work only because CMS_PORT's default matches the config's — pass it
    // explicitly so the two can't drift. `scripts/e2e-dev.ts` already does.
    env: { PORT: String(CMS_PORT) },
  },
]

const children: Bun.Subprocess[] = []
let shuttingDown = false

function stopChildren(signal: NodeJS.Signals = 'SIGTERM'): void {
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal)
  }
}

for (const cfg of processes) {
  const child = Bun.spawn(cfg.command, {
    env: { ...process.env, ...cfg.env },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  children.push(child)
  void child.exited.then((code) => {
    if (shuttingDown) return
    shuttingDown = true
    stopChildren()
    process.exit(code)
  })
}

process.on('SIGINT', () => {
  shuttingDown = true
  stopChildren('SIGINT')
})

process.on('SIGTERM', () => {
  shuttingDown = true
  stopChildren('SIGTERM')
})
