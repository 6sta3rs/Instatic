/**
 * Parses the output of `docker compose port <service> <containerPort>`.
 *
 * Compose prints one `host:port` binding per line — usually two, an IPv4 and
 * an IPv6 one:
 *
 *   0.0.0.0:5434
 *   [::]:5434
 *
 * Both name the same host port, so the first parseable line wins. Returns
 * `null` when compose printed nothing usable (no publish, or an old container
 * compose cannot describe).
 */
export function parsePublishedPort(stdout: string): number | null {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const port = Number(trimmed.slice(trimmed.lastIndexOf(':') + 1))
    if (Number.isInteger(port) && port > 0 && port < 65_536) return port
  }
  return null
}

/**
 * True when a DATABASE_URL host refers to this machine — the only case where
 * `bun run dev` owns the postgres and may provision it through compose.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}
