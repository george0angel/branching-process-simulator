import { simulateBranchingProcess } from "./core.js";

self.addEventListener("message", (event) => {
  const { requestId, parameters } = event.data ?? {};

  try {
    const result = simulateBranchingProcess(parameters);

    self.postMessage({
      requestId,
      result,
    });
  } catch (error) {
    self.postMessage({
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
