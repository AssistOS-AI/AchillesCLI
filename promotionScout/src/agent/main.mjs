#!/usr/bin/env node
// Agent daemon entry, started by scripts/startAgent.sh beside AgentServer. It holds the lifecycle lock of the data
// directory for its whole life and stops the services it started on exit.
import { checkRuntime } from '../runtime.mjs';
import { resolveDataDir } from '../app/paths.mjs';
import { withLifecycleLock } from '../app/processes.mjs';
import { stopServers } from '../app/services.mjs';
import { loadSiteCatalog, syncCatalog } from '../app/sites.mjs';
import { openContext } from './context.mjs';
import { Daemon, shutdownSignal } from './daemon.mjs';

const safe = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
const report = message => console.error(`[promotionScout] ${safe(message)}`);
const agentClientModule = process.env.SCOUT_AGENT_CLIENT ?? '/Agent/client/AgentMcpClient.mjs';

try {
  checkRuntime();
  const dataDir = resolveDataDir();
  const stopped = shutdownSignal();
  await withLifecycleLock(dataDir, async () => {
    const context = await openContext({ dataDir });
    try {
      // A cycle that was running when the agent stopped cannot finish its run record.
      context.store.closeInterruptedRuns();
      syncCatalog(context.store, await loadSiteCatalog());
      const { createAgentClient } = await import(agentClientModule);
      const client = await createAgentClient(process.env.AGENT_NAME || 'promotionScout');
      const daemon = new Daemon({ store: context.store, settings: context.settings, dataDir, client, report });
      report(`Daemon running for ${dataDir}`);
      const { reason, error } = await daemon.run(stopped);
      report(reason === 'error' ? `SCOUT_ERROR: ${error?.message ?? error}; shutting down` : `Received ${reason}; shutting down`);
      if (reason === 'error') process.exitCode = 1;
      await client.close?.();
    } finally {
      try { await stopServers(dataDir, report); } finally { context.close(); }
    }
  }, report);
} catch (error) {
  report(`${error.code ?? 'SCOUT_ERROR'}: ${error.message}`);
  process.exitCode = 1;
}
