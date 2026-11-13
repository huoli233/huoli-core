import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const port = Number(process.env.QQ_EMBEDDING_PORT ?? 11434)
const model = process.env.QQ_EMBEDDING_MODEL ?? 'bge-m3'
const here = path.dirname(fileURLToPath(import.meta.url))
const recallPath = path.join(here, '..', 'packages', 'qq', 'qq-memory', 'src', 'recall.ts')

const VECTOR_BUCKETS = 1024
const HASH_OFFSET = 0x811c9dc5
const HASH_PRIME = 0x01000193

function plain(text) {
  return String(text ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function keyGrams(text, size = 2) {
  const body = plain(text)
  const width = Math.max(1, Math.floor(size))
  if (body === '') return []
  if (body.length <= width) return [body]
  const grams = new Set()
  for (let at = 0; at + width <= body.length; at += 1) grams.add(body.slice(at, at + width))
  return [...grams]
}

function bucket(feature) {
  let hash = HASH_OFFSET
  for (let at = 0; at < feature.length; at += 1) {
    hash ^= feature.charCodeAt(at)
    hash = Math.imul(hash, HASH_PRIME)
  }
  return (hash >>> 0) % VECTOR_BUCKETS
}

function encodeVector(text) {
  const vector = new Array(VECTOR_BUCKETS).fill(0)
  for (const gram of keyGrams(text)) vector[bucket(gram)] += 1
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  return magnitude === 0 ? vector : vector.map(value => value / magnitude)
}

function json(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  response.end(text)
}

const server = createServer((request, response) => {
  if (request.url === '/v1/embeddings' && request.method === 'POST') {
    let raw = ''
    request.on('data', chunk => { raw += String(chunk) })
    request.on('end', () => {
      try {
        const body = JSON.parse(raw)
        const inputs = Array.isArray(body.input) ? body.input : [body.input]
        const data = inputs.map((input, index) => ({ object: 'embedding', index, embedding: encodeVector(input) }))
        json(response, 200, { object: 'list', model, data, usage: { prompt_tokens: 0, total_tokens: 0 } })
      } catch {
        json(response, 400, { error: { message: 'invalid embedding request' } })
      }
    })
    return
  }
  if (request.url === '/health') {
    json(response, 200, { ok: true, model, vectorBuckets: VECTOR_BUCKETS })
    return
  }
  json(response, 404, { error: { message: 'not found' } })
})

await readFile(recallPath, 'utf8')
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`qq-local-embedding-server listening on http://127.0.0.1:${port}/v1 (${model})\n`)
})
