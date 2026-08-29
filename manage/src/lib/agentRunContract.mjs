export const AGENT_RUN_DEFAULT_LEASE_MINUTES = 90;
export const AGENT_RUN_EXTEND_LEASE_MINUTES = 60;
export const AGENT_RUN_RECLAIM_LEASE_MINUTES = AGENT_RUN_DEFAULT_LEASE_MINUTES;

export const MANAGE_AGENT_API_CONTRACT_VERSION = 1;
export const MANAGE_AGENT_MINIMUM_CLI_CONTRACT_VERSION = 1;
export const MANAGE_AGENT_CLI_CONTRACT_VERSION = 1;
export const MANAGE_AGENT_MINIMUM_SERVER_CONTRACT_VERSION = 1;

export function evaluateAgentCompatibility(bootstrap = {}) {
  const compatibility = bootstrap?.compatibility;

  if (
    !compatibility
    || !Number.isInteger(compatibility.contractVersion)
    || !Number.isInteger(compatibility.minimumCliContractVersion)
  ) {
    throw new Error(
      "The server did not publish agent compatibility metadata. "
        + "The server may be older than this CLI; upgrade Agent Backlog before changing tokens.",
    );
  }

  const serverContractVersion = compatibility.contractVersion;
  const minimumCliContractVersion = compatibility.minimumCliContractVersion;

  if (minimumCliContractVersion > MANAGE_AGENT_CLI_CONTRACT_VERSION) {
    throw new Error(
      `CLI contract ${MANAGE_AGENT_CLI_CONTRACT_VERSION} is outdated; `
        + `the server requires ${minimumCliContractVersion}. Update the Agent Backlog CLI.`,
    );
  }

  if (serverContractVersion < MANAGE_AGENT_MINIMUM_SERVER_CONTRACT_VERSION) {
    throw new Error(
      `Server contract ${serverContractVersion} is outdated; `
        + `this CLI requires at least ${MANAGE_AGENT_MINIMUM_SERVER_CONTRACT_VERSION}.`,
    );
  }

  return {
    ok: true,
    cliContractVersion: MANAGE_AGENT_CLI_CONTRACT_VERSION,
    serverContractVersion,
    minimumCliContractVersion,
    lifecycleBasePath: compatibility.lifecycleBasePath,
    createTaskPath: compatibility.createTaskPath,
  };
}
