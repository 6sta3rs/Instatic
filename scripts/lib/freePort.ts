/**
 * Interactive port pre-flight for local dev/start scripts.
 *
 * `ensurePortFree(port, name)` probes the port. If something is already
 * listening, it looks up the holder(s), prints them, and asks the user
 * (via `prompt`) whether to kill them and take over. Default answer is
 * "yes" — `Enter` accepts. Anything else cancels and exits 1.
 *
 * Unix uses `lsof` + `ps`; Windows uses `netstat -ano` + `tasklist`.
 */

const decoder = new TextDecoder()

interface PortHolder {
  pid: number
  command: string
}

/**
 * Returns the PID(s) currently listening on `port` along with the
 * holding process's `comm` name. Empty array when the port is free.
 */
function findPortHolders(port: number): PortHolder[] {
  if (process.platform === 'win32') return findPortHoldersWindows(port)
  const lsof = Bun.spawnSync(
    ['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
    { stdout: 'pipe', stderr: 'ignore' },
  )
  if (lsof.exitCode !== 0) return []

  const pids = decoder
    .decode(lsof.stdout)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0)

  const holders: PortHolder[] = []
  for (const pid of pids) {
    const ps = Bun.spawnSync(['ps', '-p', String(pid), '-o', 'comm='], {
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const command =
      ps.exitCode === 0 ? decoder.decode(ps.stdout).trim() : '<unknown>'
    holders.push({ pid, command })
  }
  return holders
}

/** Windows counterpart: `netstat -ano` for the pid, `tasklist` for the name. */
function findPortHoldersWindows(port: number): PortHolder[] {
  const netstat = Bun.spawnSync(['netstat', '-ano', '-p', 'TCP'], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  if (netstat.exitCode !== 0) return []

  const pids = new Set<number>()
  for (const line of decoder.decode(netstat.stdout).split('\n')) {
    const parts = line.trim().split(/\s+/)
    // TCP  <local>  <remote>  LISTENING  <pid>
    if (parts.length < 5 || parts[3] !== 'LISTENING') continue
    if (!parts[1].endsWith(`:${port}`)) continue
    const pid = Number(parts[4])
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }

  const holders: PortHolder[] = []
  for (const pid of pids) {
    const tasklist = Bun.spawnSync(
      ['tasklist', '/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'],
      { stdout: 'pipe', stderr: 'ignore' },
    )
    const name = decoder.decode(tasklist.stdout).trim().split(',')[0] ?? ''
    holders.push({ pid, command: name.replace(/"/g, '') || '<unknown>' })
  }
  return holders
}

function probePort(port: number): 'free' | 'busy' {
  try {
    const probe = Bun.serve({ port, fetch: () => new Response() })
    probe.stop(true)
    return 'free'
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    if (code === 'EADDRINUSE') return 'busy'
    throw err
  }
}

function killHolder(holder: PortHolder, log: (msg: string) => void): boolean {
  try {
    process.kill(holder.pid, 'SIGTERM')
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    if (code === 'ESRCH') return true // already gone
    log(`failed to SIGTERM pid ${holder.pid}: ${String(err)}`)
    return false
  }
  // Wait briefly for graceful exit, then escalate.
  for (let i = 0; i < 20; i++) {
    Bun.sleepSync(100)
    try {
      process.kill(holder.pid, 0)
    } catch {
      return true // gone
    }
  }
  try {
    process.kill(holder.pid, 'SIGKILL')
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    if (code === 'ESRCH') return true
    log(`failed to SIGKILL pid ${holder.pid}: ${String(err)}`)
    return false
  }
  return true
}

/**
 * Ensure `port` is free. If something is listening, prompt the user
 * whether to kill the holder(s) and take over. Exits the process with
 * code 1 if the user declines or if killing fails.
 *
 * `log` lets callers control the prefix ("[dev]" / "[start]") so output
 * stays consistent with the surrounding script.
 */
export async function ensurePortFree(
  port: number,
  name: string,
  log: (msg: string) => void,
): Promise<void> {
  if (probePort(port) === 'free') return

  const holders = findPortHolders(port)
  if (holders.length === 0) {
    if (process.platform === 'win32') {
      // netstat found nothing — the holder is likely a previous dev server
      // still shutting down (or a socket in TIME_WAIT). Wait and re-probe.
      for (let i = 0; i < 30; i++) {
        if (probePort(port) === 'free') return
        Bun.sleepSync(1000)
      }
    }
    log(`Port ${port} (${name}) is in use, but the holding process could not be identified.`)
    log(
      process.platform === 'win32'
        ? `Run \`netstat -ano -p TCP | findstr :${port}\` to inspect it manually.`
        : `Run \`lsof -i :${port} -P -n\` to inspect it manually.`,
    )
    process.exit(1)
  }

  log(`Port ${port} (${name}) is in use by:`)
  for (const h of holders) {
    log(`  pid ${h.pid}  (${h.command})`)
  }

  const answer = prompt(`Kill ${holders.length === 1 ? 'it' : 'them'} and take over? [Y/n]`)
  const decision = (answer ?? '').trim().toLowerCase()
  const yes = decision === '' || decision === 'y' || decision === 'yes'

  if (!yes) {
    log('Aborted — leaving the existing process in place.')
    process.exit(1)
  }

  for (const h of holders) {
    log(`Killing pid ${h.pid} (${h.command})...`)
    if (!killHolder(h, log)) {
      log(`Could not free pid ${h.pid}. Aborting.`)
      process.exit(1)
    }
  }

  // Re-probe to confirm the OS has released the socket.
  for (let i = 0; i < 20; i++) {
    if (probePort(port) === 'free') return
    Bun.sleepSync(100)
  }
  log(`Port ${port} is still busy after killing its holders. Aborting.`)
  process.exit(1)
}
