// 向量仓：把每条记忆的向量存进进程内的 Postgres，按相似度从 SQL 里取回来

/** 一条要放进向量仓的记录 */
export interface VectorRecord {
  /** 记忆编号 */
  id: string
  /** 向量，长度要一致 */
  embedding: readonly number[]
  /** 属于哪个会话 */
  scope: string
  /** 什么时候的事 */
  at: number
}

/** 一次查回来的一条 */
export interface VectorHit {
  /** 记忆编号 */
  id: string
  /** 相似度，越大越像，零到一 */
  score: number
}

/** 向量仓 */
export interface VectorStore {
  /** 放进去或覆盖同编号的那条 */
  upsert(records: readonly VectorRecord[]): Promise<void>
  /** 按相似度查最近的几条 */
  search(embedding: readonly number[], options?: { scope?: string; limit?: number }): Promise<VectorHit[]>
  /** 删掉一条 */
  remove(id: string): Promise<void>
  /** 现在存了多少条 */
  count(): Promise<number>
  /** 关掉，把数据落盘 */
  close(): Promise<void>
}

/** 默认一次取几条 */
export const VECTOR_DEFAULTS = {
  /** 最多取几条 */
  limit: 8,
}

// 建表与算相似度的那几句只在这里出现一次
const SCHEMA = `
  create table if not exists memory_vectors (
    id text primary key,
    scope text not null,
    at bigint not null,
    embedding real[] not null
  );
  create index if not exists memory_vectors_scope on memory_vectors (scope);
`

// 余弦相似度：两个向量越长越像，零到一
const COSINE = `
  create or replace function memory_cosine(a real[], b real[])
  returns double precision language sql immutable as $fn$
    select coalesce(
      sum(x * y) / nullif(sqrt(sum(x * x)) * sqrt(sum(y * y)), 0),
      0
    )
    from unnest(a, b) as t(x, y)
  $fn$;
`

/**
 * 打开一个向量仓
 * @param options - 数据放哪个目录，给 memory:// 就只在内存里
 * @returns 可以用的向量仓
 */
export async function openVectorStore(options: { dir: string }): Promise<VectorStore> {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = await PGlite.create({ dataDir: options.dir })
  await db.exec(SCHEMA)
  await db.exec(COSINE)
  return {
    async upsert(records) {
      if (records.length === 0) return
      for (const record of records) {
        await db.query(
          'insert into memory_vectors (id, scope, at, embedding) values ($1, $2, $3, $4) on conflict (id) do update set scope = $2, at = $3, embedding = $4',
          [record.id, record.scope, record.at, [...record.embedding]],
        )
      }
    },
    async search(embedding, searchOptions = {}) {
      const limit = Math.max(1, Math.floor(searchOptions.limit ?? VECTOR_DEFAULTS.limit))
      const scope = searchOptions.scope ?? ''
      const rows = scope === ''
        ? await db.query('select id, memory_cosine(embedding, $1::real[]) as score from memory_vectors order by score desc limit $2', [[...embedding], limit])
        : await db.query('select id, memory_cosine(embedding, $1::real[]) as score from memory_vectors where scope = $3 order by score desc limit $2', [[...embedding], limit, scope])
      const out: VectorHit[] = []
      for (const row of rows.rows as { id: string; score: number }[]) {
        out.push({ id: row.id, score: row.score })
      }
      return out
    },
    async remove(id) {
      await db.query('delete from memory_vectors where id = $1', [id])
    },
    async count() {
      const rows = await db.query('select count(*)::int as total from memory_vectors')
      const first = (rows.rows as { total: number }[])[0]
      return first === undefined ? 0 : first.total
    },
    async close() {
      await db.close()
    },
  }
}
