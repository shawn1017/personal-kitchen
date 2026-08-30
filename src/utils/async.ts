export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let nextIndex = 0
  let firstError: unknown
  const workerCount = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length && firstError === undefined) {
      const index = nextIndex
      nextIndex += 1
      try {
        await worker(items[index], index)
      } catch (error) {
        if (firstError === undefined) firstError = error
      }
    }
  }))
  if (firstError !== undefined) throw firstError
}
