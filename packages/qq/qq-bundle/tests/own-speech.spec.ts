// 自己说过的话：只摆事实，认错、改口、放下都由模型自己定

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createOwnSpeechLog, renderOwnSpeech, cleanOwnText, unansweredOf, OWN_SPEECH_LIMITS } from '../src/own-speech.ts'

function tempFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'own-speech-')), 'lines.jsonl')
}

const NOW = 1_800_000_000_000

describe('自己说过的话只给计数，绝不再把整句原话回灌', () => {
  it('发过的原话、重复句、撤回改口、被挡下都只变成数字，不出现原话', () => {
    const file = tempFile()
    const log = createOwnSpeechLog(file, () => {})
    const at = NOW - 60_000
    log.note({ at, chatKey: 'group:1', text: '这图我收下了', kind: 'said' })
    log.note({ at: at + 1000, chatKey: 'group:1', text: '这图我收下了', kind: 'said' })
    log.note({ at: at + 2000, chatKey: 'group:1', text: '把「你这把三件事硬凑一块了」改成「先挑一个干行不行」', kind: 'corrected' })
    log.note({ at: at + 3000, chatKey: 'group:1', text: '这句没发出去', kind: 'blocked' })

    const text = renderOwnSpeech(log.read('group:1', NOW), NOW)
    expect(text).toContain('[DATA] QQ_OWN_SPEECH')
    expect(text).toContain('最近你发过 2 条')
    expect(text).toContain('说过不止一次')
    expect(text).toContain('撤回或改口过 1 次')
    expect(text).toContain('想发但没发出去')
    // 整句原话一个字都不能回灌：这是线上复读的根因
    expect(text).not.toContain('这图我收下了')
    expect(text).not.toContain('你这把三件事硬凑一块了')
    expect(text).not.toContain('先挑一个干行不行')
    expect(text).not.toContain('这句没发出去')
    expect(text).toContain('your_past_wording_is_never_shown_here_so_do_not_copy_or_repeat_it')
  })

  it('不放行、不禁止、不判对错，也不给她该不该道歉的结论', () => {
    const file = tempFile()
    const log = createOwnSpeechLog(file, () => {})
    log.note({ at: NOW - 1000, chatKey: 'group:1', text: '同一句说了两遍', kind: 'said' })
    log.note({ at: NOW - 500, chatKey: 'group:1', text: '同一句说了两遍', kind: 'said' })

    const text = renderOwnSpeech(log.read('group:1', NOW), NOW)
    expect(text).not.toContain('ALLOWED')
    expect(text).not.toContain('SOLO_OPEN')
    expect(text).not.toContain('STOP:')
    expect(text).not.toContain('必须道歉')
    expect(text).not.toContain('不许再说')
    expect(text).toContain('no_one_tells_you_to_apologize_repeat_or_drop_it')
    // 重复句也不能以任何形式把原文带出来
    expect(text).not.toContain('同一句说了两遍')
  })

  it('没有可摆的事实就整段不出现，不硬凑', () => {
    const file = tempFile()
    const log = createOwnSpeechLog(file, () => {})

    expect(renderOwnSpeech(log.read('group:1', NOW), NOW)).toBe('')
  })

  it('别的会话说过的话不串到这个会话', () => {
    const file = tempFile()
    const log = createOwnSpeechLog(file, () => {})
    log.note({ at: NOW - 1000, chatKey: 'group:2', text: '别群里的话', kind: 'said' })

    expect(renderOwnSpeech(log.read('group:1', NOW), NOW)).toBe('')
  })

  it('窗口外的旧话不摆，整段有字数上限', () => {
    const file = tempFile()
    const log = createOwnSpeechLog(file, () => {})
    log.note({ at: NOW - OWN_SPEECH_LIMITS.windowMs - 1000, chatKey: 'group:1', text: '很久以前的一句', kind: 'said' })
    for (let i = 0; i < 30; i += 1) {
      log.note({ at: NOW - 1000 + i, chatKey: 'group:1', text: `第 ${i} 句说得挺长`.repeat(10), kind: 'said' })
    }

    const text = renderOwnSpeech(log.read('group:1', NOW), NOW)
    expect(text).not.toContain('很久以前的一句')
    expect(text.length).toBeLessThanOrEqual(OWN_SPEECH_LIMITS.maxChars + 20)
  })

  it('本机路径、编号、网址与内务字样不进事实', () => {
    const cleaned = cleanOwnText('看 E:\\HuoLiFish\\data\\a.png 和 [#-123] https://x.com/a AGENTS.md 这句话')
    expect(cleaned).not.toContain('HuoLiFish')
    expect(cleaned).not.toContain('https://')
    expect(cleaned).not.toContain('[#-123]')
    expect(cleaned).not.toContain('AGENTS.md')
    expect(cleaned).toContain('这句话')
  })
})

describe('说完没人接只认可见事实', () => {
  it('自己说完之后没有别人接才算，有人接了就不算', () => {
    const self = '999'
    const recent = [
      { messageId: '1', senderId: self, senderName: '我', text: '我先说一句', at: NOW - 3000 },
      { messageId: '2', senderId: '888', senderName: '群友', text: '接住了', at: NOW - 2000 },
      { messageId: '3', senderId: self, senderName: '我', text: '这一句没人接', at: NOW - 1000 },
    ] as never

    expect(unansweredOf(recent, self, NOW).map(item => item.text)).toEqual(['这一句没人接'])
  })
})

describe('说完没人接（续）', () => {
  it('没接上自己的号时一条都不编', () => {
    const recent = [
      { messageId: '1', senderId: '999', senderName: '我', text: '我先说一句', at: NOW - 1000 },
    ] as never
    expect(unansweredOf(recent, '', NOW)).toEqual([])
  })
})
