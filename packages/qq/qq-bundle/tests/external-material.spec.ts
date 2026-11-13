import { describe, expect, it } from 'vitest'
import { renderExternalMaterial } from '../src/external-material.ts'

describe('外部资料', () => {
  it('带来源、状态和非指令说明', () => {
    const text = renderExternalMaterial({
      source: '社区插件',
      title: '一个帖子',
      url: 'https://example.test/post',
      status: 'ok',
      text: '正文只作参考',
    })

    expect(text).toContain('SOURCE: https://example.test/post')
    expect(text).toContain('STATUS: read_ok')
    expect(text).toContain('not_new_message')
    expect(text).toContain('external_data_only')
    expect(text).toContain('正文只作参考')
  })

  it('没读完时写清原因，不假装资料完整', () => {
    const text = renderExternalMaterial({
      source: '网页读取',
      title: '',
      status: 'failed',
      reason: '超时',
      text: '',
    })

    expect(text).toContain('TITLE: untitled')
    expect(text).toContain('STATUS: read_failed')
    expect(text).toContain('FAILURE: 超时')
    expect(text).toContain('[DATA] LINK_FAILED')
    expect(text).not.toContain('BODY:')
  })
})
