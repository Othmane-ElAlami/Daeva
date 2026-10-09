class AnalysisError extends Error {
  constructor(message, retryable = false) {
    super(message);
    this.name = "AnalysisError";
    this.retryable = retryable;
  }
}

// A terminal SSE event is the checkpoint. Do not wait for a clean socket close
// after receiving it: an edge connection can close abruptly after valid data.
export async function readAnalysisStream(response, onEvent = () => {}) {
  if (!response.body) throw new AnalysisError("The connection was interrupted.", true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  function frame(text) {
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return null;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new AnalysisError("The connection returned incomplete data.", true);
    }
    if (event.type === "error") throw new AnalysisError(event.message || "Analysis unavailable.");
    if (event.type === "done" || event.type === "continue") return event;
    onEvent(event);
    return null;
  }
  try {
    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        throw new AnalysisError("The connection was interrupted.", true);
      }
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      // Normalize CRLF only when complete frames are available; a CR/LF pair
      // can itself straddle network chunks.
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop();
      for (const part of parts) {
        const terminal = frame(part.replace(/\r\n/g, "\n"));
        if (terminal) return terminal;
      }
      if (chunk.done) {
        const terminal = buffer.trim() ? frame(buffer.replace(/\r\n/g, "\n")) : null;
        if (terminal) return terminal;
        throw new AnalysisError("The connection was interrupted.", true);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function requestBatch(config, continuation, fetcher, onEvent, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 90000);
  try {
    let response;
    try {
      response = await fetcher("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, ...(continuation ? { continuation } : {}) }),
        signal: controller.signal,
      });
    } catch {
      throw new AnalysisError("The connection was interrupted.", true);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new AnalysisError(
        body.error || "The server is temporarily unavailable.",
        response.status === 429 || response.status >= 500
      );
    }
    return await readAnalysisStream(response, onEvent);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

// Retry only transport failures, keeping the last completed batch intact.
// Discovery/source errors remain explicit and cannot switch the population.
export async function runAnalysis(
  config,
  {
    onEvent = () => {},
    fetcher = fetch,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    continuation = null,
    signal,
  } = {}
) {
  let checkpoint = continuation;
  try {
    for (let batch = 0; batch < 120; batch++) {
      let terminal;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) throw new AnalysisError("Analysis cancelled.");
        try {
          terminal = await requestBatch(config, checkpoint, fetcher, onEvent, signal);
          break;
        } catch (error) {
          if (!error.retryable || attempt === 2 || signal?.aborted) throw error;
          onEvent({ type: "retry", message: "Connection interrupted. Reconnecting…" });
          await wait(1000 * 2 ** attempt);
        }
      }
      if (terminal.type === "done") {
        onEvent(terminal);
        return terminal;
      }
      if (
        !terminal.identity ||
        !terminal.sourceMeta ||
        !Array.isArray(terminal.players) ||
        !Array.isArray(terminal.processedPlayers) ||
        terminal.processedCount !== terminal.processedPlayers.length ||
        terminal.processedCount > config.limit ||
        (checkpoint &&
          (terminal.identity !== checkpoint.identity ||
            terminal.processedCount < checkpoint.processedCount ||
            (terminal.processedCount === checkpoint.processedCount &&
              terminal.players.length >= checkpoint.players.length)))
      )
        throw new AnalysisError("Analysis could not advance. Please try again later.");
      checkpoint = Object.fromEntries(
        ["identity", "sourceMeta", "players", "processedPlayers", "processedCount"].map((key) => [
          key,
          terminal[key],
        ])
      );
      onEvent(terminal);
    }
    throw new AnalysisError("Analysis reached its batch limit. Your completed builds are saved.");
  } catch (error) {
    error.continuation = checkpoint;
    throw error;
  }
}
