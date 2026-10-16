// Qualification-only preparation. These calls are separate from the retrieval
// evaluation budget; the per-batch indexer still owns checksums and authorization.
export const p1KnowledgePreparationLimits = Object.freeze({
  maximumBatches: 4,
  maximumChunksPerBatch: 32,
  maximumEmbeddingCalls: 4,
  minimumIntervalMs: 4000,
});

export async function prepareP1Knowledge({ indexBatch, beforeBatch }) {
  const limits = p1KnowledgePreparationLimits;
  let embeddingSpace = null;
  let indexed = 0;
  let embeddingCalls = 0;
  for (let batch = 1; batch <= limits.maximumBatches; batch++) {
    await beforeBatch();
    // No retry: quota, transport, checksum or concurrent-source failures stop here.
    const result = await indexBatch(limits.maximumChunksPerBatch);
    if (
      !Number.isInteger(result?.indexed) || result.indexed < 0 ||
      result.indexed > limits.maximumChunksPerBatch ||
      typeof result.remainingAfterBatch !== 'boolean' ||
      !/^[a-f0-9]{64}$/.test(result.embeddingSpace ?? '') ||
      result.trace?.calls !== (result.indexed === 0 ? 0 : 1) ||
      result.trace?.error !== null ||
      (result.indexed === 0 && result.remainingAfterBatch)
    ) throw new Error('invalid_preparation_result');
    if (embeddingSpace !== null && embeddingSpace !== result.embeddingSpace)
      throw new Error('embedding_space_changed');
    embeddingSpace = result.embeddingSpace;
    indexed += result.indexed;
    embeddingCalls += result.trace.calls;
    if (!result.remainingAfterBatch) {
      return { status: 'ready', ready: true, batches: batch, indexed, embeddingCalls, embeddingSpace };
    }
  }
  return {
    status: 'incomplete', ready: false, batches: limits.maximumBatches,
    indexed, embeddingCalls, embeddingSpace,
  };
}
