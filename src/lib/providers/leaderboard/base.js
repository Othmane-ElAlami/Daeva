export class ProviderError extends Error {
  constructor(message, source, isPartial = false) {
    super(message);
    this.name = "ProviderError";
    this.source = source;
    this.isPartial = isPartial;
  }
}

export function calculateHealth(successfulServers, expectedServers) {
  if (expectedServers === 0) return "unavailable";
  if (successfulServers === 0) return "unavailable";

  const ratio = successfulServers / expectedServers;
  if (ratio >= 0.9) return "complete";
  if (ratio >= 0.7) return "partial"; // We accept >= 70% as partial data.
  return "unavailable";
}
