/* 渲染与前端逻辑测试：用 Canvas / DOM / localStorage 桩在 Node 中实跑
 * 目的：在无法启动浏览器的环境下，捕获 draw() / story / recorder 的运行时错误
 */
const fs = require('fs')
const path = require('path')

let failures = 0
const check = (c, m) => { if (!c) failures++; console.log((c ? '  ✓ ' : '  ✗ ') + m) }

/* ---------------- Canvas 2D 上下文桩 ---------------- */
function mockCtx() {
  const calls = {}
  const rec = (n) => () => { calls[n] = (calls[n] || 0) + 1 }
  const ctx = {
    calls,
    canvas: { width: 960, height: 600 },
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
    lineWidth: 1, lineCap: '', globalAlpha: 1,
    createLinearGradient: () => ({ addColorStop: rec('addColorStop') }),
    fillRect: rec('fillRect'), clearRect: rec('clearRect'), strokeRect: rec('strokeRect'),
    save: rec('save'), restore: rec('restore'),
    translate: rec('translate'), scale: rec('scale'), rotate: rec('rotate'),
    beginPath: rec('beginPath'), closePath: rec('closePath'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), arc: rec('arc'), arcTo: rec('arcTo'),
    ellipse: rec('ellipse'), setLineDash: rec('setLineDash'), getLineDash: () => [],
    quadraticCurveTo: rec('quadraticCurveTo'), bezierCurveTo: rec('bezierCurveTo'),
    rect: rec('rect'), fill: rec('fill'), stroke: rec('stroke'),
    fillText: rec('fillText'), strokeText: rec('strokeText'),
    measureText: () => ({ width: 10 }),
    setTransform: rec('setTransform'), clip: rec('clip'),
  }
  return ctx
}

/* ---------------- 加载前端脚本 ---------------- */
global.window = global
global.localStorage = {
  _s: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null },
  setItem(k, v) { this._s[k] = String(v) },
  removeItem(k) { delete this._s[k] },
}
global.performance = global.performance || { now: () => Date.now() }

const load = (p) => eval(fs.readFileSync(path.join(__dirname, p), 'utf8'))

console.log('\n[1] 三个小游戏 · 渲染（全部关卡）')
load('public/play/js/games.js')
const G = global.LPGames
for (const key of ['jump', 'memory', 'sokoban']) {
  for (let lv = 1; lv <= 5; lv++) {
    let err = null
    try {
      const g = G[key].create(lv)
      const ctx = mockCtx()
      for (let i = 0; i < 30; i++) { g.update(0.016) }
      g.draw(ctx, 960, 600)
      if (!ctx.calls.fillRect && !ctx.calls.fill) throw new Error('draw 未产生任何绘制调用')
      if (typeof g.hudText() !== 'string') throw new Error('hudText 返回非字符串')
      if (!Array.isArray(g.touchButtons)) throw new Error('touchButtons 非数组')
    } catch (e) { err = e }
    check(!err, `${G[key].name} 第 ${lv} 关 渲染无异常${err ? '：' + err.message : ''}`)
  }
}

console.log('\n[2] 故事动画 · SVG 生成与播放')
load('public/play/js/story.js')
for (const kind of ['intro', 'story1', 'story2', 'ending']) {
  let err = null
  try {
    const svg = global.Story.sceneSVG({ color: kind !== 'intro', place: kind === 'story2' ? 'cave' : (kind === 'ending' ? 'flowers' : 'forest'), wizard: kind === 'intro' })
    if (!svg.startsWith('<svg') || !svg.includes('</svg>')) throw new Error('SVG 结构不完整')
    if (/undefined|NaN/.test(svg)) throw new Error('SVG 中出现 undefined/NaN')
  } catch (e) { err = e }
  check(!err, `场景 ${kind} SVG 生成正常${err ? '：' + err.message : ''}`)
}

// 播放器（用假 DOM）
function fakeLayer() {
  const textEl = { style: {}, textContent: '' }
  const btn = { addEventListener: (n, f) => { btn._click = f } }
  return {
    innerHTML: '', classList: { remove() { }, add() { } },
    querySelector: (sel) => (sel === '.story-text' ? textEl : btn),
    _text: textEl, _btn: btn,
  }
}
{
  let err = null
  let doneCalled = false
  try {
    const layer = fakeLayer()
    global.Story.play(layer, 'story1', { crystal1: 5, crystal2: 4, crystalTotal: 9 }, 60000, () => { doneCalled = true })
    if (!layer.innerHTML.includes('<svg')) throw new Error('未写入 SVG')
    layer._btn._click() // 点击跳过
  } catch (e) { err = e }
  check(!err && doneCalled, `故事播放器可跳过并回调${err ? '：' + err.message : ''}`)
}

console.log('\n[3] 会话记录器 Recorder')
load('public/play/js/recorder.js')
{
  const R = global.Recorder
  const r = new R()
  check(r.log.Time.sessionStart && r.log.Time.sessionEnd === null, '会话开始时间已记录，结束时间为空')

  // 三段计时
  r.tick(1, 1.0); r.tick(1, 2.0); r.tick(2, 3.0); r.tick(3, 0.5)
  check(r.blockSeconds(1) === 3 && r.blockSeconds(2) === 3 && r.blockSeconds(3) === 0.5,
    `三段时长分别记录：${r.blockSeconds(1)} / ${r.blockSeconds(2)} / ${r.blockSeconds(3)}`)
  check(!r.blockDone(1) && r.blockSeconds(1) < 360, '6 分钟未到时不判定本段结束')
  r.tick(1, 360)
  check(r.blockDone(1), '累加到 360 秒后判定本段结束')

  // 水晶：首次通过 +1，重复通过不加
  const first = r.passLevel(1, 1, 30)
  const again = r.passLevel(1, 1, 20)
  check(first === true && again === false && r.log.Crystal.total === 1,
    `同一关首次通过 +1 水晶、重复通过不重复计数（水晶=${r.log.Crystal.total}）`)
  r.failLevel(1, 2, 15, 'block_timeout')
  check(r.log.Crystal.total === 1, '未通过关卡不加水晶（水晶不保底）')

  // 阶段/关卡
  r.reach(2, 4); r.reach(3, 2); r.reach(1, 5)
  check(r.log.State.maxStage === 3 && r.log.State.maxLevel === 5,
    `记录到达的阶段与关卡：第 ${r.log.State.maxStage} 阶段 第 ${r.log.State.maxLevel} 关`)

  // 暂停区间
  r.openPause('hidden')
  check(r.log.Time.pauses.length === 1 && r.log.Time.pauses[0].end === null, '切后台开启暂停区间')
  r.closePause()
  check(r.log.Time.pauses[0].end !== null, '回到页面关闭暂停区间（该段时间不计入训练）')

  // 故事区间
  r.openRest('story', 1)
  check(r.log.Time.rests.length === 1, '故事动画开启 rest 区间（动画期间计时器暂停）')
  r.closeRest()
  check(r.log.Time.rests[0].end !== null, '故事结束关闭 rest 区间')

  r.finish()
  check(r.log.Time.sessionEnd !== null && r.log.completed === true, '会话结束时间与完成标记已写入')

  // 幂等 sessionId
  const s1 = R.prototype.constructor
  check(r.log.Followed === null, '不产生本实验无关字段')
}

console.log('\n[4] 上报（无 token 时安全跳过）')
{
  const R = global.Recorder
  const r = new R()
  global.fetch = () => Promise.resolve({ ok: true })
  let err = null
  try { r.upload(false) } catch (e) { err = e }
  check(!err, '未登录时上报静默跳过，不抛异常')
}

console.log('\n' + (failures === 0 ? '全部通过 ✓' : failures + ' 项失败 ✗'))
process.exit(failures === 0 ? 0 : 1)
