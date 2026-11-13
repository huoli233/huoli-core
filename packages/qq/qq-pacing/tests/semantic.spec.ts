import { describe, expect, it } from 'vitest'
import { resolveSemanticSplit, SEMANTIC_DEFAULTS, splitSemantically } from '../src/semantic.ts'

const TUNING = { ...SEMANTIC_DEFAULTS, maxParts: 3 }

describe('按分句切气泡', () => {
  it('带分句标点的短话也能切成几个气泡', () => {
    expect(splitSemantically('叫什么叫，链接打开了吗', TUNING)).toEqual(['叫什么叫', '链接打开了吗'])
  })

  it('中文之间的空格当分句切点，切完段内没有空格', () => {
    const parts = splitSemantically('两亿年没改过设计 咬合力逆天 张嘴却没劲 全靠省电活着', TUNING)

    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part).not.toMatch(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/u)
    expect(parts.join('')).toBe('两亿年没改过设计咬合力逆天张嘴却没劲全靠省电活着')
  })

  it('逗号顿号当切点，正常句号留在气泡末尾', () => {
    const parts = splitSemantically('装逼是态度问题，干的那些事都是事实，这两码事啊', TUNING)

    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('')).not.toMatch(/[，,；;：:]/u)
  })

  it('分段不会把模型写出的句号删掉', () => {
    expect(splitSemantically('查到了，刚看完。', TUNING)).toEqual(['查到了', '刚看完。'])
  })

  it('问号感叹号不被当切点丢掉，短反应并进后面那句', () => {
    const parts = splitSemantically('真的假的？我还以为你在开玩笑呢 后来想想也确实是', TUNING)

    expect(parts.join('')).toContain('真的假的？')
    expect(parts.join('')).not.toMatch(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/u)
  })

  it('模型写的换行不并回一条', () => {
    expect(splitSemantically('第一行。\n第二行？\n第三句', TUNING))
      .toEqual(['第一行。', '第二行？', '第三句'])
  })

  it('行内分句多过上限时先同行合并，不把两行拼成一个气泡', () => {
    const parts = splitSemantically('第一件事说完了，第二件事也办妥了，第三件慢慢来\n第四件先记下来', { ...SEMANTIC_DEFAULTS, maxParts: 2 })

    expect(parts).toHaveLength(2)
    expect(parts[1]).toContain('第四件先记下来')
    expect(parts[0]).not.toContain('第四件先记下来')
  })

  it('数字时间保持完整，后面的中文仍按空格分段', () => {
    expect(splitSemantically('我大概 07:04 醒 你先别吵我', TUNING)).toEqual(['我大概 07:04 醒', '你先别吵我'])
  })

  it('网址和 markdown 链接整段不切', () => {
    const parts = splitSemantically('先看[wttr.in](https://wttr.in/Hong+Kong)这个地址，回头再说别的', TUNING)

    expect(parts.join('')).toContain('https://wttr.in/Hong+Kong')
  })

  it('网址后面的中文标点仍然算切点，不把后文并进链接', () => {
    const parts = splitSemantically('看这个https://example.com/a/b，然后说别的，最后再补一句', TUNING)

    expect(parts.join('')).toContain('https://example.com/a/b')
    expect(parts.length).toBeGreaterThan(1)
    expect(parts[0]).toContain('看这个')
  })

  it('条数超上限时并进相邻的短段，顺序不变', () => {
    const parts = splitSemantically('第一件事说完了，第二件事也办妥了，第三件慢慢来吧，第四件先记下来', { ...SEMANTIC_DEFAULTS, maxParts: 2 })

    expect(parts).toHaveLength(2)
    expect(parts.join('')).toBe('第一件事说完了第二件事也办妥了第三件慢慢来吧第四件先记下来')
  })

  it('门槛全部可配，空配置取默认值表', () => {
    expect(resolveSemanticSplit()).toEqual(SEMANTIC_DEFAULTS)
    expect(resolveSemanticSplit({ minChars: 4, minPieces: 2, minPartChars: 1 }))
      .toEqual({ minChars: 4, minPieces: 2, minPartChars: 1 })
  })
})
