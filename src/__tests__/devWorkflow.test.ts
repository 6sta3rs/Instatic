import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { bunCommand, bunRunCommand, viteCommand } from '../../scripts/lib/bunCommand'
import { isLoopbackHost, parsePublishedPort } from '../../scripts/lib/composePort'

const root = new URL('../../', import.meta.url)

function readSiteFile(path: string) {
  return readFileSync(new URL(path, root), 'utf-8')
}

describe('development workflow', () => {
  it('`bun run dev` is the one-command launcher for cms + vite', () => {
    const pkg = JSON.parse(readSiteFile('package.json')) as {
      scripts: Record<string, string>
    }

    expect(pkg.scripts['dev']).toBe('bun run scripts/dev.ts')
    expect(pkg.scripts['dev:server']).toBe('bun --watch server/index.ts')
    expect(pkg.scripts['dev:vite']).toBe('bun run scripts/vite.ts')
    expect(pkg.scripts['build']).toBe('tsc -b && bun run scripts/vite.ts build')
    expect(pkg.scripts['preview']).toBe('bun run scripts/vite.ts preview')
    expect(pkg.scripts['dev:all']).toBeUndefined()
    expect(existsSync(new URL('scripts/dev.ts', root))).toBe(true)
    expect(existsSync(new URL('scripts/vite.ts', root))).toBe(true)
    expect(existsSync(new URL('scripts/dev-all.ts', root))).toBe(false)

    const script = readSiteFile('scripts/dev.ts')
    // Spawns cms + vite without a recursive `bun run dev` call.
    expect(script).toContain("bunCommand('--watch', 'server/index.ts')")
    expect(script).toContain("viteCommand('--host', '127.0.0.1'")
    expect(script).not.toContain('command: `vite')
    expect(script).not.toContain('command.split')
    // Derives the postgres host/port from DATABASE_URL rather than hardcoding it.
    expect(script).toContain("new URL(DATABASE_URL)")
    expect(script).not.toContain('5433')
    // Manages the docker postgres + app containers.
    expect(script).toContain('compose')
    expect(script).toContain('postgres')
    expect(script).toContain('app')
    // Forwards signals to children.
    expect(script).toContain('SIGINT')
    expect(script).toContain('SIGTERM')
  })

  it('development launchers route local Vite binaries through Bun on Windows', () => {
    const devScript = readSiteFile('scripts/dev.ts')
    const e2eScript = readSiteFile('scripts/e2e-dev.ts')
    const startScript = readSiteFile('scripts/start.ts')
    const viteScript = readSiteFile('scripts/vite.ts')

    expect(bunCommand('--watch', 'server/index.ts')).toEqual([
      process.execPath,
      '--watch',
      'server/index.ts',
    ])
    const viteDevCommand = viteCommand('--host', '127.0.0.1')
    expect(viteDevCommand[0]).toBe(process.execPath)
    expect(viteDevCommand[1].replaceAll('\\', '/')).toEndWith('/node_modules/vite/bin/vite.js')
    expect(viteDevCommand.slice(2)).toEqual(['--host', '127.0.0.1'])
    expect(existsSync(viteDevCommand[1])).toBe(true)

    expect(devScript).toContain("viteCommand('--host', '127.0.0.1'")
    expect(devScript).not.toContain("bunRunCommand('dev:vite'")
    expect(devScript).not.toContain("bunRunCommand('vite'")
    expect(devScript).not.toContain('command: `vite')
    expect(devScript).not.toContain('command.split')
    expect(e2eScript).toContain("viteCommand('--host', '127.0.0.1'")
    expect(e2eScript).not.toContain("bunRunCommand('dev:vite'")
    expect(e2eScript).not.toContain("bunRunCommand('vite'")
    expect(e2eScript).not.toContain("['vite'")
    expect(e2eScript).not.toContain("['bun'")
    expect(viteScript).toContain('viteCommand(...Bun.argv.slice(2))')
    expect(viteScript).not.toContain("['vite'")
    expect(startScript).toContain("bunRunCommand('build')")
    expect(startScript).toContain("bunRunCommand('server/index.ts')")
    expect(startScript).not.toContain("['bun'")
  })

  it('Vite proxies CMS API and uploaded media to the local Bun server', () => {
    const viteConfig = readSiteFile('vite.config.ts')

    // `/admin/api` covers both the CMS endpoints (`/admin/api/cms/...`) and
    // the agent endpoints (`/admin/api/agent`, `/admin/api/agent/tool-result`).
    // The shared `/admin/` prefix is required so the session cookie (scoped
    // to `Path=/admin`) is sent on every request to the Bun backend.
    expect(viteConfig).toContain("'/admin/api'")
    expect(viteConfig).toContain("'/uploads'")
    expect(viteConfig).toContain("const CMS_DEV_SERVER_ORIGIN = `http://localhost:${process.env.PORT ?? '3001'}`")
    expect(viteConfig).toContain('target: CMS_DEV_SERVER_ORIGIN')
    expect(viteConfig).toContain('changeOrigin: true')
    expect(viteConfig).toContain('largeBodyDevProxyPlugin()')
    expect(viteConfig).toContain('shouldBufferLargeDevProxyRequest(req)')
  })

  it('Vite never forwards WebSocket upgrades, and the collab socket gets the CMS port instead', () => {
    const viteConfig = readSiteFile('vite.config.ts')
    const devScript = readSiteFile('scripts/dev.ts')

    // Vite runs inside Bun (scripts/vite.ts), and Bun's node:http client never
    // emits 'upgrade'. Enabling `ws` forwarding makes the browser socket hang
    // and then kills the dev process via `socket.destroySoon()`. The collab
    // socket dials the CMS port directly instead — never re-enable this.
    expect(viteConfig).not.toMatch(/^\s*ws:\s*true/m)

    // The dialled port must come from the same source as the proxy target so
    // they cannot drift, and dev.ts must actually hand PORT to the Vite child
    // (it previously relied on both defaults happening to be 3001).
    expect(viteConfig).toContain("'import.meta.env.VITE_CMS_DEV_PORT': JSON.stringify(process.env.PORT ?? '3001')")
    expect(devScript).toContain('env: { PORT: String(CMS_PORT) }')
  })

  it('Vite forwards public page routes to the CMS server instead of the admin SPA', () => {
    const viteConfig = readSiteFile('vite.config.ts')

    expect(viteConfig).toContain('function publicSiteDevProxyPlugin')
    expect(viteConfig).toContain('publicSiteDevProxyPlugin()')
    expect(viteConfig).toContain("pathname === '/admin'")
    expect(viteConfig).toContain("pathname.startsWith('/admin/')")
    expect(viteConfig).toContain("pathname === '/'")
    expect(viteConfig).toContain('proxyPublicSiteRequest')
  })

  it('Vite forwards published runtime assets to the CMS server in local dev', () => {
    const viteConfig = readSiteFile('vite.config.ts')

    expect(viteConfig).toContain("pathname.startsWith('/_instatic/assets/')")
  })

  it('Docker Postgres uses a non-default, overridable host port for local dev', () => {
    const compose = readSiteFile('docker-compose.yml')

    // docker-compose.yml is dev-only and exposes the Postgres container on a
    // non-default host port (5433) to avoid clashing with a local Postgres
    // install. The port stays overridable because 5433 is itself not free on
    // every machine — an unrelated project's postgres holding it made the app
    // connect there and report an authentication failure. The DATABASE_URL the
    // app uses to reach the container lives in compose.prod.yml — not here.
    expect(compose).toContain('"${POSTGRES_HOST_PORT:-5433}:5432"')
    expect(compose).toContain('image: postgres:16')
  })

  it('`bun run dev` recreates the postgres container instead of reviving a stale one', () => {
    const script = readSiteFile('scripts/dev.ts')

    // `docker compose start` revives a container built from an older compose
    // config forever — including one created before the host port was
    // published, which is unreachable from the host. `up -d` reconciles it.
    expect(script).toContain("['compose', 'up', '-d', 'postgres']")
    expect(script).not.toContain("['compose', 'start', 'postgres']")
  })

  it('`bun run dev` proves it reached OUR database, not just an open port', () => {
    const script = readSiteFile('scripts/dev.ts')

    // A TCP probe (or an in-container `pg_isready`) passes even when a foreign
    // postgres owns the host port, or when the port is not published at all.
    // Only a real query distinguishes those from a healthy stack.
    expect(script).toContain('assertPublishedPortMatches')
    expect(script).toContain('assertDatabaseUsable')
    expect(script).toContain('await sql`select 1`')
    expect(script).not.toContain('pg_isready')
  })

  it('parses the host port out of `docker compose port` output', () => {
    expect(parsePublishedPort('0.0.0.0:5434\n[::]:5434\n')).toBe(5434)
    expect(parsePublishedPort('[::]:5434')).toBe(5434)
    // No publish, or a container compose cannot describe.
    expect(parsePublishedPort('')).toBeNull()
    expect(parsePublishedPort('\n  \n')).toBeNull()
    expect(parsePublishedPort('0.0.0.0:notaport')).toBeNull()
  })

  it('only provisions docker postgres for a database on this machine', () => {
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('[::1]')).toBe(true)
    expect(isLoopbackHost('db.example.com')).toBe(false)
  })
})
