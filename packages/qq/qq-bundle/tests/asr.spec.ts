import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SpeechProvider, SpeechProviderId, SpeechRequest, SpeechSnapshot, SpeechSpec } from '@huoli/huoli-experimental-speech-to-text/types'
import { createAsrPort, parseAsrText, resolveAsrSettings, transcribePreparedWav, transcribeVoice, type LocalSpeechPort } from '../src/asr.ts'

const settings = {
  enabled: true,
  mode: 'external' as const,
  transport: 'openai-compatible' as const,
  baseURL: 'http://asr.test/v1',
  model: 'FunAudioLLM/SenseVoiceSmall',
  key: 'test-key',
  language: 'zh',
  timeoutMs: 5_000,
  maxSeconds: 30,
  ffmpegPath: '',
  autoStart: false,
  startCommand: [] as readonly string[],
  startWaitMs: 1_000,
}

function localSpeechPort(phase: 'checking' | 'standby' | 'ready' = 'ready'): LocalSpeechPort {
  const id = 'sensevoice-local' as SpeechProviderId
  const provider: SpeechProvider = {
    info: { id, name: 'SenseVoiceSmall', location: 'host-local', languages: ['zh'] },
    transcribe: async () => ({ text: '听到的内容', audioSeconds: 1.25, inferenceSeconds: 0.3 }),
  }
  const snapshot = (preparation: 'checking' | 'standby' | 'ready' | 'unprepared'): SpeechSnapshot => ({
    providers: [{
      ...provider.info,
      preparation: preparation === 'checking' ? { phase: 'checking', startedAt: Date.now() }
        : preparation === 'standby' ? { phase: 'standby' }
          : preparation === 'ready' ? { phase: 'ready' } : { phase: 'unprepared' },
    }],
    selection: { providerId: id, language: 'zh' },
  })
  return {
    snapshot: () => snapshot(phase),
    follow: async function* (signal) {
      signal.throwIfAborted()
      yield snapshot(phase)
      if (phase === 'checking') yield snapshot('unprepared')
    },
    resolve: (request: SpeechRequest): SpeechSpec => ({
      provider,
      audio: request.audio,
      language: request.language ?? 'zh',
    }),
    transcribe: vi.fn(async (spec: SpeechSpec, signal: AbortSignal) => {
      signal.throwIfAborted()
      return await spec.provider.transcribe({ audio: spec.audio, language: spec.language }, signal)
    }),
    prepare: vi.fn(),
  }
}

describe('语音转写', () => {
  it('默认走 Huoli 管理的本机识别，不要求 localhost 服务或 API key', () => {
    const settings = resolveAsrSettings({ asrMode: 'local', asrConfigFile: 'missing.asr.json' })

    expect(settings).toMatchObject({ mode: 'local', transport: 'managed', baseURL: '', model: '', key: '' })
  })

  it('profile 显式选择本机识别时忽略旧 asr.json 的失效 localhost 地址', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-asr-config-'))
    const file = path.join(dir, 'asr.json')
    try {
      fs.writeFileSync(file, JSON.stringify({ mode: 'local', baseUrl: 'http://127.0.0.1:8000/v1', model: 'SenseVoiceSmall' }))

      expect(resolveAsrSettings({ asrMode: 'local', asrConfigFile: file }))
        .toMatchObject({ mode: 'local', transport: 'managed', baseURL: '', model: '' })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('profile 明确开启时启动本机模型准备，转写直接进本地 Provider', async () => {
    const speech = localSpeechPort('checking')
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error('unexpected network request') })
    const asr = createAsrPort({
      asrMode: 'local',
      asrPrepareOnStart: true,
      asrConfigFile: 'missing.asr.json',
    }, speech, fetchImpl)

    await vi.waitFor(() => { expect(speech.prepare).toHaveBeenCalledOnce() })
    await expect(asr?.transcribePreparedWav(new Uint8Array([1, 2, 3])))
      .resolves.toMatchObject({ ok: true, text: '听到的内容', seconds: 1.25 })
    expect(speech.transcribe).toHaveBeenCalledOnce()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('本机模型处于 standby 时启动识别进程预热', async () => {
    const speech = localSpeechPort('standby')
    const asr = createAsrPort({
      asrMode: 'local',
      asrPrepareOnStart: true,
      asrConfigFile: 'missing.asr.json',
    }, speech)

    await vi.waitFor(() => { expect(speech.prepare).toHaveBeenCalledOnce() })
    asr?.close()
  })

  it('在首次缓存检查期间提交准备请求，由 Provider 在检查结束后启动', async () => {
    const id = 'sensevoice-local' as SpeechProviderId
    const provider: SpeechProvider = {
      info: { id, name: 'SenseVoiceSmall', location: 'host-local', languages: ['zh'] },
      transcribe: async () => ({ text: '听到的内容', audioSeconds: 1, inferenceSeconds: 0.2 }),
    }
    const snapshot = (preparation: SpeechSnapshot['providers'][number]['preparation']): SpeechSnapshot => ({
      providers: [{ ...provider.info, preparation }],
      selection: { providerId: id, language: 'zh' },
    })
    const snapshots = [
      snapshot({ phase: 'unprepared', steps: [{ kind: 'check', status: 'pending' }, { kind: 'load', status: 'pending' }] }),
      snapshot({ phase: 'checking', step: 'check', startedAt: Date.now(), steps: [{ kind: 'check', status: 'running' }, { kind: 'load', status: 'pending' }] }),
      snapshot({ phase: 'unprepared', steps: [{ kind: 'check', status: 'complete' }, { kind: 'load', status: 'pending' }] }),
    ]
    let observed = -1
    const preparedAt: number[] = []
    const speech: LocalSpeechPort = {
      snapshot: () => snapshots.at(-1)!,
      follow: async function* (signal) {
        for (const [index, value] of snapshots.entries()) {
          signal.throwIfAborted()
          observed = index
          yield value
        }
      },
      resolve: (request: SpeechRequest): SpeechSpec => ({
        provider,
        audio: request.audio,
        language: request.language ?? 'zh',
      }),
      transcribe: vi.fn(async (spec: SpeechSpec, signal: AbortSignal) => {
        signal.throwIfAborted()
        return await spec.provider.transcribe({ audio: spec.audio, language: spec.language }, signal)
      }),
      prepare: vi.fn(() => { preparedAt.push(observed) }),
    }

    const asr = createAsrPort({ asrMode: 'local', asrPrepareOnStart: true }, speech)

    await vi.waitFor(() => { expect(speech.prepare).toHaveBeenCalledOnce() })
    expect(preparedAt).toEqual([0])
    asr?.close()
  })

  it('本机识别服务缺失时给出明确失败，不静默关闭语音识别', async () => {
    const asr = createAsrPort({ asrMode: 'local', asrConfigFile: 'missing.asr.json' }, undefined)

    expect(asr?.status()).toEqual({ transport: 'managed', phase: 'service-unavailable' })
    await expect(asr?.transcribePreparedWav(new Uint8Array([1])))
      .resolves.toEqual({ ok: false, reason: 'Huoli 本机语音识别服务未加载' })
  })

  it('报告选中 Provider 的准备阶段，不暴露 Provider 错误正文', () => {
    const speech = localSpeechPort('checking')
    const asr = createAsrPort({ asrMode: 'local' }, speech)

    expect(asr?.status()).toEqual({ transport: 'managed', providerId: 'sensevoice-local', phase: 'checking' })
    asr?.close()
  })

  it('显式外部 ASR 只显示外部传输模式，不返回接口或密钥', () => {
    const asr = createAsrPort({
      asrMode: 'external',
      asrBaseURL: 'https://asr.example/v1',
      asrModel: 'configured-model',
    }, undefined)

    expect(asr?.status()).toEqual({ transport: 'openai-compatible', phase: 'external' })
  })

  it('本机 HTTP 兼容模式拒绝向外部地址发送音频', () => {
    expect(() => resolveAsrSettings({
      asrMode: 'local',
      asrBaseURL: 'https://asr.example/v1',
      asrModel: 'SenseVoiceSmall',
      asrConfigFile: 'missing.asr.json',
    })).toThrow('本机 ASR 的 HTTP 地址必须指向 localhost、127.0.0.1 或 ::1')
  })

  it('外部 HTTP ASR 必须显式开启并配置模型与地址', () => {
    expect(resolveAsrSettings({
      asrMode: 'external',
      asrBaseURL: 'https://asr.example/v1',
      asrModel: 'configured-model',
      asrKeyRef: '',
      asrConfigFile: 'missing.asr.json',
    })).toMatchObject({ mode: 'external', transport: 'openai-compatible', model: 'configured-model' })
  })

  it('把 SenseVoice 的情绪/事件标签拆出来，正文不留标签', () => {
    const parsed = parseAsrText('<|zh|><|HAPPY|><|LAUGHTER|>你今天作业写完了吗')

    expect(parsed.text).toBe('你今天作业写完了吗')
    expect(parsed.emotion).toBe('HAPPY')
    expect(parsed.event).toBe('LAUGHTER')
    expect(parsed.language).toBe('zh')
  })

  it('走 OpenAI 兼容的 /audio/transcriptions，把转写交给模型', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '<|zh|><|SAD|>我有点累' }),
    }) as unknown as typeof fetch

    const convertImpl = vi.fn(async (data: Uint8Array) => ({ ok: true as const, wav: data }))
    const result = await transcribeVoice(new Uint8Array([1, 2, 3]), 'audio/wav', settings, fetchImpl, convertImpl)

    expect(result).toMatchObject({ ok: true, text: '我有点累', emotion: 'SAD', language: 'zh' })
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toBe('http://asr.test/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect(String((init.headers as Record<string, string>).authorization)).toBe('Bearer test-key')
    expect(init.body).toBeInstanceOf(FormData)
    expect(convertImpl).toHaveBeenCalledWith(expect.any(Uint8Array), 'audio/wav', settings)
  })

  it('已经转换好的 WAV 直接送入 ASR，不再调用音频转码器', async () => {
    const requests: { input: RequestInfo | URL; init?: RequestInit }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push(init === undefined ? { input } : { input, init })
      return new Response(JSON.stringify({ text: '<|zh|>前方有台阶' }), { status: 200 })
    }

    const result = await transcribePreparedWav(new Uint8Array([7, 8]), settings, fetchImpl)

    expect(result).toEqual({ ok: true, text: '前方有台阶', language: 'zh' })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.input).toBe('http://asr.test/v1/audio/transcriptions')
    expect(requests[0]?.init?.body).toBeInstanceOf(FormData)
  })

  it('服务返回空文字时明确失败，不编内容', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '<|zh|>' }),
    }) as unknown as typeof fetch

    await expect(transcribeVoice(new Uint8Array([1]), 'audio/wav', settings, fetchImpl, async data => ({ ok: true, wav: data })))
      .resolves.toEqual({ ok: false, reason: 'ASR 没返回文字' })
  })

  it('转码器抛错时返回失败结果，不让入站处理异常退出', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch

    await expect(transcribeVoice(
      new Uint8Array([1]),
      'audio/wav',
      settings,
      fetchImpl,
      async () => { throw new Error('spawn denied') },
    )).resolves.toEqual({ ok: false, reason: '音频转码失败：spawn denied' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('HTTP 失败时带出服务给的原因', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'bad key' } }),
    }) as unknown as typeof fetch

    await expect(transcribeVoice(new Uint8Array([1]), 'audio/wav', settings, fetchImpl, async data => ({ ok: true, wav: data })))
      .resolves.toEqual({ ok: false, reason: 'ASR 拒绝：bad key' })
  })

  it('本机服务启动命令异步失败时返回普通失败结果', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch
    const convertImpl = async (data: Uint8Array) => ({ ok: true as const, wav: data })
    const result = await transcribeVoice(new Uint8Array([1]), 'audio/wav', {
      ...settings,
      mode: 'local',
      key: '',
      autoStart: true,
      startCommand: ['qq-asr-command-that-does-not-exist'],
    }, fetchImpl, convertImpl)

    expect(result).toMatchObject({ ok: false, reason: 'ASR 没连上：connection refused' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
