/** Limita tarefas assíncronas simultâneas (ex.: consultas de metadados). */
export function createLimiter(concurrency: number) {
  let active = 0
  const queue: Array<() => void> = []
  const next = () => {
    if (active >= concurrency) return
    const run = queue.shift()
    if (run) run()
  }
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active += 1
        task()
          .then(resolve, reject)
          .then(() => {
            active -= 1
            next()
          })
      })
      next()
    })
  }
}
