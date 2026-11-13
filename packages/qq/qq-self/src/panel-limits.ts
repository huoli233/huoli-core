// 面板上「行为约束」那一组：读一次填控件，改完写回去

import type { LimitsState } from './index.ts'

export type { LimitsState }

/** 面板 HTML 里那一组控件 */
export function panelLimitsHtml(): string[] {
  return [
    '<h4>行为约束</h4>',
    '<p id="limits-status"></p>',
    '<label>静默分钟 <input id="limit-quiet" type="number" min="0" max="4320" step="5" value="0"></label> ',
    '<label>每小时最多主动说 <input id="limit-perhour" type="number" min="0" max="30" step="1" value="3"></label><br>',
    '<label>几点睡 <input id="limit-sleepfrom" type="number" min="0" max="23" step="1" value="23"></label> ',
    '<label>几点醒 <input id="limit-sleepuntil" type="number" min="0" max="23" step="1" value="7"></label> ',
    '<label><input id="limit-proactive" type="checkbox" checked> 允许主动开口</label> ',
    '<button id="limits-save" type="button">保存</button>',
  ]
}

/** 页面脚本：这一段单独成行，都写一行里 */
export const PANEL_LIMITS_SCRIPT = [
  'var lq=document.getElementById("limit-quiet"),lph=document.getElementById("limit-perhour"),',
  'lsf=document.getElementById("limit-sleepfrom"),lsu=document.getElementById("limit-sleepuntil"),',
  'lpa=document.getElementById("limit-proactive"),lsave=document.getElementById("limits-save"),',
  'lstatus=document.getElementById("limits-status");',
  'var fillLimits=function(s){if(!s)return;if(lq)lq.value=s.quietMinutes;if(lph)lph.value=s.proactivePerHour;',
  'if(lsf)lsf.value=s.sleepFrom;if(lsu)lsu.value=s.sleepUntil;if(lpa)lpa.checked=!!s.proactiveAllowed;',
  'if(lstatus)lstatus.textContent="静默 "+s.quietMinutes+" 分 · 每小时 "+s.proactivePerHour+" 次 · "+',
  's.sleepFrom+" 点睡 / "+s.sleepUntil+" 点醒 · 主动开口 "+(s.proactiveAllowed?"开":"关")};',
  'if(lstatus)fetch("/api/limits",{headers:{accept:"application/json"}}).then(function(r){return r.json()}).then(fillLimits).catch(function(){});',
  'if(lsave)lsave.addEventListener("click",function(){',
  'var q=["quietMinutes="+(lq?lq.value:0),"proactivePerHour="+(lph?lph.value:3),',
  '"sleepFrom="+(lsf?lsf.value:23),"sleepUntil="+(lsu?lsu.value:7),',
  '"proactiveAllowed="+((lpa&&lpa.checked)?"1":"0")].join("&");',
  'fetch("/api/limits?"+q,{method:"POST",headers:{accept:"application/json"}})',
  '.then(function(r){return r.json()}).then(fillLimits).catch(function(){})});',
]

/** 把一次 POST 的查询串收成合法约束；认不出来的数返回 undefined */
export function limitsPatchOf(search: URLSearchParams): Partial<LimitsState> | undefined {
  const patch: Partial<LimitsState> = {}
  const number = (key: string): number | undefined => {
    const raw = search.get(key)
    if (raw === null || raw.trim() === '') return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value : Number.NaN
  }
  const quiet = number('quietMinutes')
  const perHour = number('proactivePerHour')
  const sleepFrom = number('sleepFrom')
  const sleepUntil = number('sleepUntil')
  const allowed = search.get('proactiveAllowed')
  if (Number.isNaN(quiet) || Number.isNaN(perHour) || Number.isNaN(sleepFrom) || Number.isNaN(sleepUntil)) return undefined
  if (quiet !== undefined) patch.quietMinutes = quiet
  if (perHour !== undefined) patch.proactivePerHour = perHour
  if (sleepFrom !== undefined) patch.sleepFrom = sleepFrom
  if (sleepUntil !== undefined) patch.sleepUntil = sleepUntil
  if (allowed !== null && allowed.trim() !== '') patch.proactiveAllowed = allowed === '1' || allowed === 'true'
  return patch
}
