/** Superseded reads cannot publish results or errors, even if fetch ignores abort. */
export function latestRequest() {
  let current: AbortController | null = null;
  return {
    cancel() {
      current?.abort();
      current = null;
    },
    async run<T>(read: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      try {
        const result = await read(controller.signal);
        return controller.signal.aborted ? null : result;
      } catch (error) {
        if (controller.signal.aborted) return null;
        throw error;
      } finally {
        if (current === controller) current = null;
      }
    },
  };
}
