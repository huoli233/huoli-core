// 只读面板出口：只绑回环地址的 HTTP 服务，只认三个 GET 路由，不写文件也不改状态

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { localDay } from './day.ts'
import { briefShell, escapeHtml, percent } from './panel.ts'
import type { PanelDayRow, PanelState, PanelVitals } from './types.ts'

// 出口只绑这个地址，别的网卡上连不进来
const LOOPBACK = '127.0.0.1'

// 页面每隔这么多秒自己去取一次，不再整页重载
const REFRESH_SECONDS = 3

// 动画最多跑多少帧：文档里说粒子与火舌 30fps 够用，再快只是白烧 CPU
const ANIMATION_FPS = 30

const HTML = 'text/html; charset=utf-8'
const JSON_TYPE = 'application/json; charset=utf-8'

// 一天压成一行：跳过的写原因，写过的把三行接起来
function dayText(row: PanelDayRow): string {
  const day = localDay(row.at)
  if (row.skipped) return `${day}：跳过`
  return `${day}：${row.lines.filter(line => line !== '').join(' / ')}`
}

// 样式内联，一页不拉任何外部资源；色值照文档那张表，只在这里出现一次
const STYLE = [
  ':root{--bg:#03060d;--panel:rgba(8,18,34,.62);--cyan:#67e8f9;--green:#34d399;--green2:#4ade80;',
  '--red:#fb7185;--orange:#fb923c;--amber:#fbbf24;--purple:#a78bfa;--purple2:#c4b5fd;',
  '--water-low:#2563EB;--water-mid:#3B82F6;--water-high:#38BDF8;--text:#e6f2ff;--muted:#7f93b8}',
  'body{margin:0;background:var(--bg);color:var(--text);font:14px/1.7 system-ui,sans-serif}',
  '.wrap{display:grid;grid-template-columns:342px minmax(0,1fr);gap:18px;padding:18px;align-items:start}',
  '.left{position:sticky;top:18px;display:grid;gap:14px}',
  '.right{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px}',
  '.card{grid-column:span 12;background:var(--panel);border:1px solid rgba(103,232,249,.18);border-radius:10px;padding:12px}',
  '.span-4{grid-column:span 4}.span-6{grid-column:span 6}',
  '@media (max-width:1080px){.wrap{grid-template-columns:1fr}.left{position:static}',
  '.right{grid-template-columns:1fr}.card,.span-4,.span-6{grid-column:span 1}}',
  'h1{font-size:15px;color:var(--cyan);margin:0 0 10px}',
  'h3{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin:0 0 8px}',
  '.num{font-family:Consolas,ui-monospace,monospace}',
  '.muted{color:var(--muted)}',
  'pre{white-space:pre-wrap;margin:0;padding:10px;background:rgba(3,6,13,.6);border-radius:8px}',
  '.tank{display:flex;align-items:flex-end;gap:12px}',
  '.tank-well{position:relative;display:flex;align-items:flex-end;width:30px;height:96px;',
  'background:rgba(8,18,34,.9);border:1px solid rgba(103,232,249,.35);border-radius:5px;overflow:hidden}',
  '.tank-water{width:100%}',
  '.water-low{background:var(--water-low)}.water-mid{background:var(--water-mid)}.water-high{background:var(--water-high)}',
  '.ring{width:96px;height:96px;border-radius:50%;display:grid;place-items:center;',
  'background:conic-gradient(var(--cyan) var(--v),rgba(103,232,249,.12) 0)}',
  '.ring>span{width:72px;height:72px;border-radius:50%;display:grid;place-items:center;',
  'background:rgba(3,6,13,.92);font-family:Consolas,ui-monospace,monospace;font-size:15px}',
  'canvas.dial{position:absolute;left:0;top:0}',
  'canvas.flame,canvas.cycle{display:block}',
  'canvas.particles{display:block;width:100%}',
  'canvas.water{position:absolute;left:0;top:0}',
  '.env-labels{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}',
  '.pairs{margin:0;padding:0;list-style:none}',
  '.pair{display:grid;grid-template-columns:7em minmax(280px,1fr);align-items:start;gap:10px;margin:6px 0}',
  '.pair-bars{display:block}',
  '.pair-line{display:grid;grid-template-columns:5.5em 1fr;align-items:center;gap:8px;margin:2px 0}',
  '.pair-word{font-size:10px;letter-spacing:1px;color:var(--muted);white-space:nowrap}',
  '.pair-track{display:block;height:5px;background:rgba(127,147,184,.22);border-radius:3px;overflow:hidden}',
  '.pair-fill{display:block;height:100%;border-radius:3px;background:var(--cyan)}',
  '.pair-fill.alt{background:var(--green)}',
  '.tank{position:relative}',
  '.bars{margin:0;padding:0;list-style:none}',
  '.bar-row{display:grid;grid-template-columns:7em minmax(300px,1fr);align-items:center;gap:10px;margin:4px 0}',
  '.bar-name{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);white-space:nowrap}',
  '.bar-track{display:block;height:6px;background:rgba(127,147,184,.22);border-radius:3px;overflow:hidden}',
  '.bar-fill{display:block;height:100%;border-radius:3px;background:var(--cyan)}',
  '.body-bar .bar-fill{background:var(--green)}',
  '.emotion-bar .bar-fill{background:var(--purple)}',
  'ul{margin:0;padding-left:18px}',
  'p{margin:4px 0}',
].join('')

// 水罐按水位分三档：水位 = 一减渴，颜色一律用蓝，深的是水少
function waterTier(level: number): string {
  if (level < 0.25) return 'water-low'
  if (level < 0.50) return 'water-mid'
  return 'water-high'
}

// 页内脚本：只画圈、火舌、周期盘与水罐水位，三秒取一次 /api/state，不拉任何外部资源
const SCRIPT = [
  '(function(){',
  'var css=function(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()};',
  'var CY=css("--cyan")||"#67e8f9",RED=css("--red")||"#fb7185",AM=css("--amber")||"#fbbf24",MU=css("--muted")||"#7f93b8";',
  'var GR=css("--green")||"#34d399",PU=css("--purple")||"#a78bfa";',
  'var unit=function(v){return Math.min(1,Math.max(0,Number(v)||0))};',
  'var gauge=function(c,v,color){var g=c.getContext("2d"),r=c.width/2-6;g.clearRect(0,0,c.width,c.height);',
  'g.lineWidth=8;g.strokeStyle=MU;g.globalAlpha=.25;g.beginPath();g.arc(c.width/2,c.height/2,r,0,Math.PI*2);g.stroke();',
  'g.globalAlpha=1;g.strokeStyle=color;g.lineCap="round";g.beginPath();',
  'g.arc(c.width/2,c.height/2,r,-Math.PI/2,-Math.PI/2+Math.PI*2*unit(v));g.stroke()};',
  'var flame=function(c,a,r){var g=c.getContext("2d"),base=c.height-8,h=8+130*unit(a);',
  'g.clearRect(0,0,c.width,c.height);g.fillStyle=RED;g.beginPath();g.moveTo(c.width/2-18,base);',
  'g.quadraticCurveTo(c.width/2-30,base-h*0.6,c.width/2,base-h);',
  'g.quadraticCurveTo(c.width/2+30,base-h*0.6,c.width/2+18,base);g.closePath();g.fill();',
  'g.fillStyle=AM;g.globalAlpha=.7;',
  '[-1,1].forEach(function(s){var cx=c.width/2+s*26,sh=h*0.55;g.beginPath();g.moveTo(cx-7,base);',
  'g.quadraticCurveTo(cx-11,base-sh*0.6,cx,base-sh);g.quadraticCurveTo(cx+11,base-sh*0.6,cx+7,base);',
  'g.closePath();g.fill()});g.globalAlpha=1;',
  'g.fillStyle=AM;g.globalAlpha=.25+.5*unit(r);g.fillRect(12,base+2,c.width-24,4);g.globalAlpha=1;',
  'var sparks=Math.round(unit(a)*6),now=Date.now();',
  'for(var i=0;i<sparks;i+=1){var sx=c.width/2+(i%2===0?-1:1)*(6+i*3),',
  'sy=base-h*((now/240+i*0.17)%1);g.fillStyle="rgba(251,146,60,"+(1-((now/240+i*0.17)%1))+")";',
  'g.fillRect(sx-1,sy-1,2,2)}};',
  'var phaseAt=function(d,b){if(!b||b.length<4)return "";',
  'return d<=b[0]?"menstrual":d<=b[1]?"follicular":d<=b[2]?"ovulation":d<=b[3]?"luteal":"premenstrual"};',
  'var dial=function(c,day,len,phase,bounds){var g=c.getContext("2d"),cx=c.width/2,cy=c.height/2,R=c.width/2-12;',
  'var n=Math.max(1,len|0);g.clearRect(0,0,c.width,c.height);g.lineWidth=6;',
  'var cur=Math.min(n,Math.max(1,day|0));',
  'for(var i=0;i<n;i++){var a0=-Math.PI/2+(i/n)*Math.PI*2,a1=a0+(Math.PI*2/n)*0.8,',
  'seg=bounds&&bounds.length>=4?phaseColor(phaseAt(i+1,bounds)):MU;',
  'g.strokeStyle=(i+1)===cur?phaseColor(phase):seg;g.globalAlpha=(i+1)===cur?1:.5;',
  'g.beginPath();g.arc(cx,cy,R,a0,a1);g.stroke()}',
  'g.globalAlpha=1;g.lineWidth=3;g.strokeStyle=CY;',
  'var a=-Math.PI/2+((cur-0.5)/n)*Math.PI*2;g.beginPath();g.moveTo(cx,cy);',
  'g.lineTo(cx+Math.cos(a)*R,cy+Math.sin(a)*R);g.stroke()};',
  'var prevT=null,rippleAt=0;',
  'var water=function(t){var f=document.querySelector(".tank-water");if(!f)return;',
  'if(prevT!==null&&prevT-t>0.12)rippleAt=Date.now();prevT=t;',
  'var level=1-unit(t);f.style.height=(level*100).toFixed(0)+"%";',
  'f.className="tank-water "+(level<0.25?"water-low":level<0.5?"water-mid":"water-high")};',
  'var latest=0;',
  'var phaseColor=function(p){return p==="menstrual"?RED:p==="ovulation"?PU:p==="luteal"?AM:p==="premenstrual"?MU:GR};',
  'var waterCanvas=function(c,t,now){var g=c.getContext("2d"),w=c.width,h=c.height,level=1-unit(t);',
  'g.clearRect(0,0,w,h);var top=h*(1-level),amp=Math.min(4,1.5+3*level),ph=now/700;',
  'g.fillStyle=level<0.25?"#2563EB":level<0.5?"#3B82F6":"#38BDF8";g.beginPath();g.moveTo(0,h);',
  'for(var x=0;x<=w;x+=1){g.lineTo(x,top+Math.sin(x/5+ph)*amp+Math.sin(x/2.2+ph*1.6)*amp/2)}',
  'g.lineTo(w,h);g.closePath();g.fill();',
  'var n=Math.round((1-level)*6);g.fillStyle="rgba(125,211,252,.7)";',
  'for(var i=0;i<n;i+=1){var bx=(i*11+5)%w,by=h-((now/45+i*29)%Math.max(8,h-top));',
  'g.beginPath();g.arc(bx,by,1.5,0,Math.PI*2);g.fill()}',
  'var age=now-rippleAt;if(age>=0&&age<900){var rr=(age/900)*(w/2);',
  'g.strokeStyle="rgba(186,230,253,"+(1-age/900)+")";g.lineWidth=1;g.beginPath();',
  'g.arc(w/2,top,rr,0,Math.PI*2);g.stroke()}};',
  'var envHist={};',
  'var envCanvas=function(c,s){var v=s&&s.vitals;if(!v)return;var keys=(c.getAttribute("data-keys")||"").split(",");',
  'var g=c.getContext("2d"),w=c.width,h=c.height,rowH=h/Math.max(1,keys.length);g.clearRect(0,0,w,h);',
  'keys.forEach(function(k,i){var raw=Number(v[k]);if(!isFinite(raw))return;',
  'var val=k==="temp"?Math.min(1,Math.max(0,(raw-36)/3)):unit(raw);',
  'var arr=envHist[k]||(envHist[k]=[]);arr.push(val);if(arr.length>90)arr.shift();',
  'g.strokeStyle=CY;g.lineWidth=1.2;g.beginPath();',
  'for(var x=0;x<arr.length;x+=1){var px=w-1-(arr.length-1-x)*(w/89),py=i*rowH+rowH*(1-arr[x])*0.9+2;',
  'if(x===0){g.moveTo(px,py)}else{g.lineTo(px,py)}}g.stroke()})};',
  'var particleCanvas=function(c,now){var raw=c.getAttribute("data-pairs")||"[]",pairs;',
  'try{pairs=JSON.parse(raw)}catch(e){/* 数据坏了这一帧就不画，下一轮轮询会重写 */return}if(!pairs.length)return;',
  'var g=c.getContext("2d"),w=c.width,h=c.height,rowH=h/pairs.length;g.clearRect(0,0,w,h);',
  'var ph=now/900;',
  'pairs.forEach(function(p,i){var mid=(Number(p.av)||0)-(Number(p.bv)||0),y=i*rowH+rowH/2;',
  'g.fillStyle=MU;g.globalAlpha=.22;g.fillRect(0,y,w,1);g.globalAlpha=1;',
  'g.fillStyle=mid>=0?CY:RED;',
  'for(var k=0;k<8;k+=1){var base=(k/8)*w,drift=mid*w*0.5,t=(ph+k*0.7)%1;',
  'var x=(base+drift*t+2*w)%w;g.globalAlpha=.35+.55*(1-t);',
  'g.beginPath();g.arc(x,y-6*Math.sin(t*Math.PI),1.7,0,Math.PI*2);g.fill()}g.globalAlpha=1})};',
  'var paint=function(s){var v=s&&s.vitals;if(!v)return;',
  'if(typeof v.thirst==="number"){latest=v.thirst;water(v.thirst)}',
  'Array.prototype.forEach.call(document.querySelectorAll("canvas[data-gauge]"),function(c){',
  'var k=c.getAttribute("data-gauge");gauge(c,v[k],k==="thirst"?CY:AM)});',
  'Array.prototype.forEach.call(document.querySelectorAll("canvas.flame"),function(c){',
  'flame(c,c.getAttribute("data-anger"),c.getAttribute("data-resent"))});',
  'Array.prototype.forEach.call(document.querySelectorAll("canvas.cycle"),function(c){',
  'var bs=(c.getAttribute("data-bounds")||"").split(",").filter(function(s){return s!==""}).map(Number);',
  'dial(c,c.getAttribute("data-day"),c.getAttribute("data-len"),c.getAttribute("data-phase"),bs)});',
  'Array.prototype.forEach.call(document.querySelectorAll("canvas.env"),function(c){envCanvas(c,s)});',
  'Array.prototype.forEach.call(document.querySelectorAll("canvas.particles"),function(c){',
  'if(v.pairs)c.setAttribute("data-pairs",JSON.stringify(v.pairs.map(function(p){return {av:p.av,bv:p.bv}})));',
  'particleCanvas(c,Date.now())})};',
  'paint(window.__PANEL__);',
  'var reduceMotion=!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);',
  'var lastFast=0,FRAME_MS=' + String(Math.round(1000 / ANIMATION_FPS)) + ';',
  'var raf=function(ts){requestAnimationFrame(raf);',
  'if(reduceMotion)return;',
  'if(ts-lastFast<FRAME_MS)return;',
  'lastFast=ts;var now=Date.now();',
  'Array.prototype.forEach.call(document.querySelectorAll("canvas.water"),function(c){waterCanvas(c,latest,now)});',
  'Array.prototype.forEach.call(document.querySelectorAll("canvas.flame"),function(c){',
  'flame(c,c.getAttribute("data-anger"),c.getAttribute("data-resent"))});',
  'Array.prototype.forEach.call(document.querySelectorAll("canvas.particles"),function(c){particleCanvas(c,now)})};',
  'requestAnimationFrame(raf);',
  'var tick=function(){fetch("/api/state",{headers:{accept:"application/json"}})',
  '.then(function(r){return r.json()}).then(paint).catch(function(){})};',
  'setInterval(tick,' + String(REFRESH_SECONDS * 1000) + ');',
  '})();',
].join('')

// 往脚本里塞 JSON 会把尖括号带进去，先按脚本安全的那一套转义
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

// 条宽只认零到一：越界的值收回来，条不会画出格子外面去

// 渴分三档，每档一个中文词；颜色不看渴，只看水位
function thirstWord(thirst: number): string {
  if (thirst < 1 / 3) return '不渴'
  if (thirst < 2 / 3) return '有点渴'
  return '很渴'
}

// 水罐：水位按渴的反面画，颜色按水位分档，旁边那两行只说数
function waterTank(vitals: PanelVitals): string[] {
  const thirst = vitals.thirst
  if (thirst === undefined) return []
  const level = 1 - thirst
  return [
    '<div class="card span-4">',
    '<h3>水罐</h3>',
    '<div class="tank">',
    '<div class="tank-well">',
    `<div class="tank-water ${waterTier(level)}" style="height:${percent(level)}"></div>`,
    `<canvas class="water" data-thirst="${thirst}" width="30" height="96"></canvas>`,
    '</div>',
    `<div><p class="num">水位 ${percent(level)}</p><p class="muted">${thirstWord(thirst)}</p></div>`,
    '</div>',
    '</div>',
  ]
}

// 口渴环：一圈按渴画，中间写百分比；数字那格留在 DOM 里，脚本不在时也读得到
function thirstRing(vitals: PanelVitals): string[] {
  const thirst = vitals.thirst
  if (thirst === undefined) return []
  return [
    '<div class="card span-4">',
    '<h3>口渴</h3>',
    `<div class="ring" style="--v:${percent(thirst)}">`,
    '<canvas class="dial" data-gauge="thirst" width="96" height="96"></canvas>',
    `<span class="num">${percent(thirst)}</span>`,
    '</div>',
    '</div>',
  ]
}

// 饥饿环：与口渴同一套画法，缺这个读数就整块省掉
function hungerRing(vitals: PanelVitals): string[] {
  const hunger = vitals.hunger
  if (hunger === undefined) return []
  return [
    '<div class="card span-4">',
    '<h3>饥饿</h3>',
    `<div class="ring" style="--v:${percent(hunger)}">`,
    '<canvas class="dial" data-gauge="hunger" width="96" height="96"></canvas>',
    `<span class="num">${percent(hunger)}</span>`,
    '</div>',
    '</div>',
  ]
}

// 怒气：一层火舌按愤怒、底下余烬按记恨，两个都没有就整块省掉
function angerFlame(vitals: PanelVitals): string[] {
  if (vitals.anger === undefined && vitals.resentment === undefined) return []
  return [
    '<div class="card span-4">',
    '<h3>怒气</h3>',
    `<canvas class="flame" data-anger="${vitals.anger ?? 0}" data-resent="${vitals.resentment ?? 0}" width="160" height="120"></canvas>`,
    '</div>',
  ]
}

// 周期盘：一格一天，指针指到第几天，有分界就按五段上色
function cycleDial(vitals: PanelVitals): string[] {
  const day = vitals.cycleDay
  const len = vitals.cycleLen
  if (day === undefined || len === undefined || len === 0) return []
  const phase = vitals.cyclePhase ?? ''
  const bounds = vitals.cycleBounds === undefined ? '' : vitals.cycleBounds.join(',')
  return [
    '<div class="card span-4">',
    '<h3>生理周期</h3>',
    `<canvas class="cycle" data-day="${day}" data-len="${len}" data-phase="${escapeHtml(phase)}" data-bounds="${bounds}" width="160" height="160"></canvas>`,
    `<p class="num">${escapeHtml(phase)} D${day}/${len}</p>`,
    '</div>',
  ]
}

// 情绪条：一层一条，条宽只由权重定，字只写来由
function emotionBars(vitals: PanelVitals): string[] {
  const bars = vitals.emotion
  if (bars === undefined || bars.length === 0) return []
  const rows = bars.map(bar => [
    '<li class="bar-row emotion-bar">',
    `<span class="bar-name">${escapeHtml(bar.why)}</span>`,
    `<span class="bar-track"><span class="bar-fill" style="width:${percent(bar.weight)}"></span></span>`,
    '</li>',
  ].join(''))
  return ['<div class="card span-6"><h3>情绪来由</h3>', `<ul class="bars">${rows.join('')}</ul></div>`]
}

// 身体概览：四个读数一个一条细横条，缺哪条就不画哪条
function bodyOverview(vitals: PanelVitals): string[] {
  const figures: ReadonlyArray<readonly [string, number | undefined]> = [
    ['精力', vitals.energy],
    ['心情', vitals.mood],
    ['无聊', vitals.boredom],
    ['想说话', vitals.socialHunger],
  ]
  const rows = figures
    .filter((row): row is readonly [string, number] => row[1] !== undefined)
    .map(([name, value]) => [
      '<li class="bar-row body-bar">',
      `<span class="bar-name">${name}</span>`,
      `<span class="bar-track"><span class="bar-fill" style="width:${percent(value)}"></span></span>`,
      '</li>',
    ].join(''))
  if (rows.length === 0) return []
  return ['<div class="card span-6"><h3>身体概览</h3>', `<ul class="bars">${rows.join('')}</ul></div>`]
}

// 体内环境：六条迷你曲线，样本由页面自己按轮询攒，服务端只给当前这一刻
function envCurves(vitals: PanelVitals): string[] {
  const keys: ReadonlyArray<readonly [string, number | undefined]> = [
    ['tired', vitals.tired],
    ['temp', vitals.temp],
    ['fever', vitals.fever],
    ['immunity', vitals.immunity],
    ['pain', vitals.pain],
    ['estrogen', vitals.estrogen],
  ]
  const shown = keys.filter((row): row is readonly [string, number] => row[1] !== undefined)
  if (shown.length === 0) return []
  const labels = shown.map(([key]) => `<span class="bar-name">${ENV_LABEL[key] ?? key}</span>`).join('')
  return [
    '<div class="card span-6">',
    '<h3>体内环境</h3>',
    `<canvas class="env" data-keys="${shown.map(([key]) => key).join(',')}" width="320" height="96"></canvas>`,
    `<div class="env-labels">${labels}</div>`,
    '</div>',
  ]
}

// 六条曲线各自的标签：只在这一处写死，画与读都用它
const ENV_LABEL: Readonly<Record<string, string>> = {
  tired: '睡眠压力',
  temp: '体温',
  fever: '发烧',
  immunity: '免疫',
  pain: '疼痛',
  estrogen: '雌激素',
}

// 五组双条：一对拮抗的量上下两条并排，谁高谁低一眼看得出
function pairBars(vitals: PanelVitals): string[] {
  const pairs = vitals.pairs
  if (pairs === undefined || pairs.length === 0) return []
  const rows = pairs.map(pair => [
    '<li class="pair">',
    `<span class="bar-name">${escapeHtml(pair.name)}</span>`,
    '<span class="pair-bars">',
    `<span class="pair-line"><span class="pair-word">${escapeHtml(pair.a)}</span>`,
    `<span class="pair-track"><span class="pair-fill" style="width:${percent(pair.av)}"></span></span></span>`,
    `<span class="pair-line"><span class="pair-word">${escapeHtml(pair.b)}</span>`,
    `<span class="pair-track"><span class="pair-fill alt" style="width:${percent(pair.bv)}"></span></span></span>`,
    '</span>',
    '</li>',
  ].join(''))
  return ['<div class="card span-6"><h3>神经-体液</h3>', `<ul class="pairs">${rows.join('')}</ul></div>`]
}

// 粒子场景：五组双条各占一行，哪边高粒子就往哪边漂，一眼看出此刻偏哪边
function particleScene(vitals: PanelVitals): string[] {
  const pairs = vitals.pairs
  if (pairs === undefined || pairs.length === 0) return []
  const packed = pairs.map(pair => ({ av: pair.av, bv: pair.bv }))
  return [
    '<div class="card span-12">',
    '<h3>流向</h3>',
    `<canvas class="particles" data-pairs="${escapeHtml(JSON.stringify(packed))}" width="640" height="120"></canvas>`,
    '</div>',
  ]
}

// 身体那一块：没有读数时整块换成一句没接上，不留空壳
function bodyBlocks(vitals: PanelVitals | undefined): string[] {
  const blocks = vitals === undefined
    ? []
    : [
      ...waterTank(vitals),
      ...thirstRing(vitals),
      ...hungerRing(vitals),
      ...angerFlame(vitals),
      ...cycleDial(vitals),
      ...envCurves(vitals),
      ...pairBars(vitals),
      ...particleScene(vitals),
      ...emotionBars(vitals),
      ...bodyOverview(vitals),
    ]
  return blocks.length === 0 ? ['<div class="card"><p class="muted">身体没接上</p></div>'] : blocks
}

/**
 * 那一页只读的 HTML
 * @param state - 只读出口的内容
 * @param options - brief 为真时只出简短版，给陪玩与视频那几路看
 * @returns 内联样式与内联脚本、没有外部资源的一页，每三秒自己去取一次
 */
export function panelPage(state: PanelState, options: { brief?: boolean } = {}): string {
  if (options.brief === true) return briefShell(state, STYLE)
  const identity = state.identity === undefined
    ? '还没有写过'
    : `${state.identity.claim}：${state.identity.why}`
  const days = state.days.length === 0
    ? '<li class="muted">近七天还没有记录</li>'
    : state.days.map(row => `<li>${escapeHtml(dayText(row))}</li>`).join('')
  const generatedAt = state.panel.generatedAt === '' ? '还没生成' : state.panel.generatedAt
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>自我面板</title>',
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<div class="wrap">',
    '<div class="left">',
    '<div class="card">',
    '<h1>自我面板</h1>',
    `<p class="muted">生成时间：${escapeHtml(generatedAt)}</p>`,
    `<pre>${escapeHtml(state.panel.body)}</pre>`,
    '</div>',
    '<div class="card">',
    '<h3>身份主张</h3>',
    `<p>${escapeHtml(identity)}</p>`,
    '</div>',
    '</div>',
    '<div class="right">',
    ...bodyBlocks(state.vitals),
    '<div class="card">',
    '<h3>最近七天</h3>',
    `<ul>${days}</ul>`,
    '</div>',
    '<div class="card">',
    '<h3>健康</h3>',
    `<p class="muted">${escapeHtml(state.health)}</p>`,
    '</div>',
    '</div>',
    '</div>',
    `<script>window.__PANEL__=${jsonForScript({ vitals: state.vitals })};</script>`,
    `<script>${SCRIPT}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

// 三种路由的回法都只有状态码、类型与整段正文
function send(response: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra })
  response.end(body)
}

/** 看过一次口令之后带在身上的那块饼干名 */
export const PANEL_COOKIE = 'qq_panel_token'

/** 起出口要用的东西 */
export interface PanelHttpOptions {
  /** 绑哪个端口，只绑回环地址 */
  port: number
  /** 每次请求现算一份内容，算的时候不写盘 */
  state(now: number): PanelState
  /** 要给别人看时设一个口令：设了就要求带口令，空串等于不要求 */
  token?: string
  /** 这一页可以问一次星海：给了就多出 /graph 与两条只读接口 */
  graph?: (pathname: string, search: URLSearchParams) => { type: string; body: string } | undefined
  /** 起不来时把这一句交给调用方记一行 */
  warn(message: string): void
}

/** 一个已经在听的出口 */
export interface PanelHttp {
  /** 实际绑上的端口 */
  readonly port: number
  /** 关掉服务，关完这个端口就空出来了 */
  close(): Promise<void>
}

// 关的时候连还挂着的连接一起断：这一页没有要等的东西
function shutdown(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(() => { resolve() })
    server.closeAllConnections()
  })
}

// 只认本机写的 Host：别的域名解析到回环地址也读不到，防域名重绑
function localHost(host: string | undefined): boolean {
  if (host === undefined) return false
  const name = host.split(':')[0] ?? ''
  return name === '127.0.0.1' || name === 'localhost'
}

// 请求里带的口令对不对：查参数或那块饼干，两边都没有就是没带
function tokenOk(request: IncomingMessage, url: URL, token: string): boolean {
  if (token === '') return true
  if (url.searchParams.get('token') === token) return true
  const jar = request.headers.cookie ?? ''
  for (const part of jar.split(';')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    if (part.slice(0, at).trim() !== PANEL_COOKIE) continue
    const raw = part.slice(at + 1).trim()
    // 饼干里的值是按 URL 编码存的，解不开就按原样比
    let value = raw
    try {
      value = decodeURIComponent(raw)
    } catch (_badEscape) {
      value = raw
    }
    return value === token
  }
  return false
}

// 口令只在参数里出现过就顺手记一块饼干，之后刷新不用再拼参数
function cookieFor(url: URL, token: string): Record<string, string> {
  if (token === '' || url.searchParams.get('token') !== token) return {}
  // 响应头只收可见 ASCII，口令按 URL 编码存，读的时候再解回
  return { 'set-cookie': `${PANEL_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/` }
}

// 一个请求怎么回：只认本机与 GET 的三个路由，别的一律给码，不碰任何状态
function answer(request: IncomingMessage, response: ServerResponse, options: PanelHttpOptions): void {
  if (!localHost(request.headers.host)) {
    send(response, 403, JSON_TYPE, '{"ok":false}\n')
    return
  }
  if (request.method !== 'GET') {
    send(response, 405, JSON_TYPE, '{"ok":false}\n')
    return
  }
  const url = new URL(request.url ?? '/', `http://${LOOPBACK}`)
  const path = url.pathname
  const token = options.token ?? ''
  // 健康那一路不带数据，其余两路都带她自己，所以要口令
  if (path !== '/api/health' && !tokenOk(request, url, token)) {
    send(response, 403, JSON_TYPE, '{"ok":false}\n')
    return
  }
  const jar = cookieFor(url, token)
  // 星海那几路：图与单个星点，都是只读
  const sea = options.graph?.(path, url.searchParams)
  if (sea !== undefined) {
    send(response, 200, sea.type, sea.body, jar)
    return
  }
  if (path === '/') {
    // 陪玩与视频那几路只读简短版：带 brief=1 就不是完整那一屏
    const brief = url.searchParams.get('brief') === '1'
    send(response, 200, HTML, panelPage(options.state(Date.now()), { brief }), jar)
    return
  }
  if (path === '/api/state') {
    send(response, 200, JSON_TYPE, `${JSON.stringify(options.state(Date.now()))}\n`, jar)
    return
  }
  if (path === '/api/health') {
    send(response, 200, JSON_TYPE, '{"ok":true}\n')
    return
  }
  send(response, 404, JSON_TYPE, '{"ok":false}\n')
}

/**
 * 起一个只读出口
 * @param options - 端口、取内容的函数与记日志的出口
 * @returns 已经在听的出口；端口被占或监听失手时为 undefined，只记一行
 */
export function startPanelHttp(options: PanelHttpOptions): Promise<PanelHttp | undefined> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      try {
        answer(request, response, options)
      } catch (error) {
        // 算这一次的内容失手只回 500，服务本身接着听
        options.warn(`只读出口这一次没算出来：${String(error)}`)
        if (!response.headersSent) send(response, 500, JSON_TYPE, '{"ok":false}\n')
      }
    })
    server.on('error', (error: Error) => {
      // 端口被占或别的监听失手：只记一行，退成不监听，别的功能照旧
      options.warn(`只读出口没起来：端口 ${options.port} ${error.message}`)
      resolve(undefined)
    })
    server.listen(options.port, LOOPBACK, () => {
      const address = server.address()
      const bound = typeof address === 'object' && address !== null ? address.port : options.port
      resolve({ port: bound, close: () => shutdown(server) })
    })
  })
}
