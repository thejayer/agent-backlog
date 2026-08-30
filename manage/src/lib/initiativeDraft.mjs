export function completionCriteriaText(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean).join("\n");
  }

  return value == null ? "" : String(value).trim();
}

export function initiativeLabelsText(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean).join(", ");
  }

  return value == null ? "" : String(value).trim();
}

export function initiativeDraft(initiative = {}) {
  return {
    ...initiative,
    completionCriteria: completionCriteriaText(initiative.completionCriteria),
    labels: initiativeLabelsText(initiative.labels),
    groupingGuidance: String(initiative.groupingGuidance || ""),
  };
}
