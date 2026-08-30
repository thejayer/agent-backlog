function cleanList(value) {
  const entries = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  return [...new Set(entries.map((entry) => String(entry || "").trim()).filter(Boolean))];
}

export const initiativeTemplates = [
  {
    id: "delivery-program",
    label: "Coordinated delivery",
    title: "Coordinate a multi-packet delivery outcome",
    objective: "Deliver a connected outcome across related work packets with explicit ownership, sequencing, and completion evidence.",
    completionCriteria: [
      "Every linked packet is completed or explicitly dispositioned.",
      "Cross-packet dependencies and release evidence are recorded.",
      "The combined operator outcome is verified before the initiative is closed.",
    ],
    labels: ["delivery", "initiative"],
    groupingGuidance: "Group packets that contribute to one operator-visible outcome and can be reviewed against a shared completion gate.",
  },
  {
    id: "platform-hardening",
    label: "Platform hardening",
    title: "Harden a shared platform workflow",
    objective: "Reduce operational risk across a related workflow while preserving established product behavior and deployment paths.",
    completionCriteria: [
      "The targeted failure modes have direct regression coverage.",
      "Affected repositories pass their required validation commands.",
      "Any deferred risks have owners and follow-up packets.",
    ],
    labels: ["hardening", "reliability"],
    groupingGuidance: "Group packets by shared failure mode or platform boundary rather than by incidental file ownership.",
  },
  {
    id: "launch-readiness",
    label: "Launch readiness",
    title: "Prepare a product capability for release",
    objective: "Bring a connected capability to release readiness with validated behavior, operator documentation, and a clear rollout decision.",
    completionCriteria: [
      "Required product behavior and edge cases are validated.",
      "Release, rollback, and operator guidance are recorded.",
      "The initiative owner confirms readiness to ship.",
    ],
    labels: ["launch", "readiness"],
    groupingGuidance: "Group only the packets required for the same release decision; move later enhancements to a follow-up initiative.",
  },
];

export function findInitiativeTemplate(templateId) {
  return initiativeTemplates.find((template) => template.id === templateId) || null;
}

function selectedPackets(packetKeys, packets) {
  const byKey = new Map((packets || []).map((packet) => [String(packet?.key || "").toUpperCase(), packet]));
  return cleanList(packetKeys).map((key) => byKey.get(key.toUpperCase())).filter(Boolean);
}

function packetGroup(packets) {
  const projects = cleanList(packets.map((packet) => packet.project));
  if (projects.length === 1) return projects[0];
  const repos = cleanList(packets.map((packet) => packet.repo));
  if (repos.length === 1) return repos[0];
  return packets.length ? "cross-platform" : "selected";
}

function contextualTitle(packets) {
  if (packets.length === 1) return `Advance: ${packets[0].title}`;
  if (packets.length > 1) return `${packetGroup(packets)} delivery initiative`;
  return "";
}

function contextualObjective(packets) {
  const outcomes = cleanList(packets.map((packet) => packet.desiredOutcome)).slice(0, 3);
  if (!outcomes.length) return "";
  return `Coordinate the selected work so that ${outcomes.join(" ")}`;
}

export function buildInitiativeSuggestion({ templateId = "", packetKeys = [], packets = [] } = {}) {
  const template = findInitiativeTemplate(templateId);
  const selected = selectedPackets(packetKeys, packets);
  const selectedKeys = selected.map((packet) => packet.key);
  const contextLabels = cleanList(selected.flatMap((packet) => packet.labels || [])).sort((a, b) => a.localeCompare(b));
  const contextCriterion = selectedKeys.length
    ? `Close or explicitly disposition ${selectedKeys.join(", ")} with completion evidence.`
    : "";
  const contextGuidance = selectedKeys.length
    ? `Selected context: ${selectedKeys.join(", ")} (${packetGroup(selected)}).`
    : "";

  return {
    title: template?.title || contextualTitle(selected),
    objective: template?.objective || contextualObjective(selected),
    completionCriteria: cleanList([...(template?.completionCriteria || []), contextCriterion]),
    labels: cleanList([...(template?.labels || []), ...contextLabels]),
    groupingGuidance: [template?.groupingGuidance, contextGuidance].filter(Boolean).join(" "),
    packetKeys: selectedKeys,
  };
}
