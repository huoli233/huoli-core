// 视频真看口径钉在规矩文件里：模型看到的 qq:rules 就是这份文件

import { describe, expect, it } from 'vitest'
import { defaultRulesPath, readRules } from '../src/facts.ts'

// 与装配入口同一份读法，读不到或换了文件会在这里直接露出来
const rules = readRules(defaultRulesPath())
// 只取「视频和逛站」这一段，别命中别处的同词
const section = rules.split('## 视频和逛站')[1]?.split('\n## ')[0] ?? ''

describe('视频真看口径', () => {
  it('规矩读得到，且视频和逛站段在场', () => {
    expect(rules.startsWith('# 和群友说话')).toBe(true)
    expect(section).not.toBe('')
  })

  it('链接或分享卡先真看一眼，一次只看一个最要紧的', () => {
    expect(section).toContain('群里出现视频链接或分享卡')
    expect(section).toContain('`bili_look`')
    expect(section).toContain('看一眼开头一小段再说话')
    expect(section).toContain('一次只挑一个最要紧的')
    expect(section).toContain('不刷屏')
  })

  it('单次失败只是这条链接坏了，不是能力没有', () => {
    expect(section).toContain('啥都木有')
    expect(section).toContain('链接失效')
    expect(section).toContain('是**这一个视频**没看成')
    expect(section).toContain('不是「我不会看视频」')
    expect(section).toContain('别把一次失败说成能力没有')
  })

  it('真看过才说看过，说得出画面台词弹幕并对上群里那句', () => {
    expect(section).toContain('真看过才说看过')
    expect(section).toContain('画面里具体有什么')
    expect(section).toContain('哪句台词或弹幕')
    expect(section).toContain('跟群里刚才那句怎么对上')
    expect(section).toContain('只看了标题就别装看过')
    expect(section).toContain('直接说「没看」')
    expect(section).toContain('看不出来就说看不出来')
    expect(section).toContain('画面冲击力拉满')
  })

  it('不新增重复的能力事实段', () => {
    expect(rules).not.toContain('QQ_VIDEO_ABILITY')
  })
})
