import path from 'node:path'
import { Context } from '@huoli/cordis'
import { apply, qqMemoryOf } from '@huoli/huoli-qq-memory'

const ctx = new Context()
ctx.accessor('tools', {
  get: () => ({ register: () => () => {} }),
})
const data = path.join(process.cwd(), 'data')
apply(ctx, {
  home: process.cwd(),
  file: path.join(data, 'qq-memory.json'),
  ledgerFile: path.join(data, 'qq-memory-ledger.json'),
  healthLogFile: path.join(data, 'qq-memory-health.log'),
  queueFile: path.join(data, 'qq-memory-queue.json'),
  vectorStore: 'pglite',
  vectorDir: path.join(data, 'vectors'),
  embedding: {
    baseURL: 'http://127.0.0.1:11434/v1',
    model: 'bge-m3',
    timeoutMs: 8000,
  },
})

const memory = qqMemoryOf(ctx)
if (memory === undefined) throw new Error('qq-memory 没装上')
const indexed = await memory.vectorReindex()
process.stdout.write(`memory_vector_reindex indexed=${indexed}\n`)
await ctx.fiber.dispose()
process.exit(0)
