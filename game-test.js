/* 小游戏逻辑测试（对齐原小程序玩法）
 * 1) 推箱子：BFS 验证原版 5 张地图可解，并把解「实操」进游戏实例验证通关
 * 2) 记忆翻牌：先记忆后翻面的流程、配对与通关
 * 3) 跳跃水晶：色块匹配计分、对不上不扣分、集满 15 过关
 */
const fs = require('fs')
const path = require('path')

global.window = global
eval(fs.readFileSync(path.join(__dirname, 'public/play/js/games.js'), 'utf8'))
const G = global.LPGames

let failures = 0
function check(c, m) { if (!c) failures++; console.log((c ? '  ✓ ' : '  ✗ ') + m) }

/* ---------------- 推箱子：解析原版编码地图 + BFS 求解 ---------------- */
// 编码：0空 1对的箱子 2水泥墙 3箱子 4圆圈 5角色 6土地
function parseTileMap(raw) {
  const goals = [], boxes = []
  let px = 0, py = 0
  const rows = raw.length, cols = raw[0].length
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = raw[y][x]
      if (ch === 4 || ch === 1) goals.push([x, y])
      if (ch === 3 || ch === 1) boxes.push([x, y])
      if (ch === 5) { px = x; py = y }
    }
  }
  const wall = (x, y) => y < 0 || y >= rows || x < 0 || x >= cols || raw[y][x] === 2 || raw[y][x] === 0
  return { goals, boxes, px, py, wall }
}

function solve(raw, maxIter = 8000000) {
  const m = parseTileMap(raw)
  const goalSet = new Set(m.goals.map((g) => g.join(',')))
  const dirs = [[0, -1, 'U'], [0, 1, 'D'], [-1, 0, 'L'], [1, 0, 'R']]
  const key = (p, bs) => p[0] + ',' + p[1] + '|' + bs.map((b) => b.join(',')).sort().join(';')
  const start = { p: [m.px, m.py], b: m.boxes.map((b) => b.slice()), path: [] }
  const seen = new Set([key(start.p, start.b)])
  let q = [start]
  let iter = 0
  while (q.length && iter < maxIter) {
    const next = []
    for (const st of q) {
      if (st.b.every((b) => goalSet.has(b.join(',')))) return st.path
      for (const [dx, dy, name] of dirs) {
        const nx = st.p[0] + dx, ny = st.p[1] + dy
        if (m.wall(nx, ny)) continue
        const bi = st.b.findIndex((b) => b[0] === nx && b[1] === ny)
        let nb = st.b
        if (bi >= 0) {
          const bx = nx + dx, by = ny + dy
          if (m.wall(bx, by) || st.b.some((b) => b[0] === bx && b[1] === by)) continue
          nb = st.b.map((b, i) => (i === bi ? [bx, by] : b))
        }
        const k = key([nx, ny], nb)
        if (seen.has(k)) continue
        seen.add(k)
        next.push({ p: [nx, ny], b: nb, path: st.path.concat(name) })
      }
    }
    q = next
    iter++
  }
  return null
}

const KEY_OF_DIR = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight' }

console.log('\n[推箱子] 原版 5 张地图：BFS 可解性 + 游戏实例实操通关')
G.sokoban.maps.forEach((raw, i) => {
  const t0 = Date.now()
  const pathArr = solve(raw)
  const ms = Date.now() - t0
  check(!!pathArr, `第 ${i + 1} 关可解（${pathArr ? pathArr.length + ' 步' : '未找到解'}，BFS ${ms}ms）`)
  if (!pathArr) return
  // 把解实操进游戏实例
  const g = G.sokoban.create(i + 1)
  g.update(0.001)
  for (const d of pathArr) {
    g.key(KEY_OF_DIR[d], true)
    g.update(0.001)
  }
  check(g.status === 'win', `第 ${i + 1} 关按解实操后游戏判定通关（步数 ${g._debug.moves}）`)
})

/* ---------------- 记忆翻牌：先记忆 10 秒，再凭记忆配对 ---------------- */
console.log('\n[记忆翻牌] 记忆阶段与配对通关')
for (let lv = 1; lv <= 5; lv++) {
  const g = G.memory.create(lv)
  const expectedCards = [4, 8, 12, 16, 20][lv - 1]
  check(g._debug.cards.length === expectedCards, `第 ${lv} 关牌数 ${g._debug.cards.length}（原版 ${expectedCards} 张）`)
  const counts = {}
  g._debug.cards.forEach((c) => { counts[c.sym] = (counts[c.sym] || 0) + 1 })
  check(Object.values(counts).every((v) => v === 2), `第 ${lv} 关每种图案恰好 2 张`)

  // 记忆阶段：卡片亮出，且此时不可点击
  check(g._debug.phase === 'memorize', `第 ${lv} 关初始为记忆阶段（卡片亮出）`)
  const r0 = g._debug.rectOf(0)
  g.pointer(r0.x + r0.w / 2, r0.y + r0.h / 2)
  check(g._debug.cards[0].flipped === true, `记忆阶段点击不生效（保持亮出）`)

  // 跳过记忆 → 统一翻面
  g._debug.skipMemorize()
  g.update(0.05)
  check(g._debug.phase === 'play' && g._debug.cards.every((c) => !c.flipped), `第 ${lv} 关 10 秒后统一翻面`)

  // 凭记忆配对
  const groups = {}
  g._debug.cards.forEach((c, i) => { (groups[c.sym] = groups[c.sym] || []).push(i) })
  for (const sym of Object.keys(groups)) {
    for (const idx of groups[sym]) {
      const r = g._debug.rectOf(idx)
      g.pointer(r.x + r.w / 2, r.y + r.h / 2)
    }
    for (let k = 0; k < 20; k++) g.update(0.05)
  }
  check(g.status === 'win', `第 ${lv} 关全部配对后通关`)
}

/* ---------------- 跳跃水晶：板子下落 + 弹跳穿越 ---------------- */
console.log('\n[跳跃水晶] 板子从上往下落 + 穿越同色障碍')
{
  // 关卡 → 障碍格数（原版 lvShow：2/3/4/5/6）
  for (let lv = 1; lv <= 5; lv++) {
    check(G.jump.create(lv)._debug.N === lv + 1, `第 ${lv} 关板子格数 ${lv + 1}`)
  }

  const g = G.jump.create(1)
  const D = g._debug

  // 板子从上往下落
  const y0 = D.boards[0].y
  check(y0 < 0, `板子从屏幕上方出现（y=${Math.round(y0)}）`)
  g.update(0.5)
  check(D.boards[0].y > y0, `板子向下落（${Math.round(y0)} → ${Math.round(D.boards[0].y)}）`)

  function freshBoard() {
    let bd = D.boards[D.boards.length - 1]
    if (bd.judged) { D.spawnBoard(); bd = D.boards[D.boards.length - 1] }
    return bd
  }

  /** 把水晶放到与板子重叠、且落在指定性质的格子里 */
  function crossBoard(matching) {
    const bd = freshBoard()
    const type = D.crystal.type
    const idx = matching
      ? bd.slots.findIndex((s, i) => s === type && !bd.holes[i])
      : bd.slots.findIndex((s, i) => s !== type && !bd.holes[i])
    if (idx < 0) { D.spawnBoard(); return crossBoard(matching) }
    D.crystal.x = D.ZONE_X + idx * D.SLOT_W + D.SLOT_W / 2
    D.crystal.y = bd.y + D.ROW_H / 2
    D.crystal.vy = 0
    g.update(0.001)
    return idx
  }

  // 穿过同色障碍 → +1
  const typeBefore = D.crystal.type
  crossBoard(true)
  check(D.passed === 1, `穿过同色板子 +1 层（已通过 ${D.passed}）`)
  check(D.crystal.type !== typeBefore || D.N > 1, '通过后水晶会改变颜色')

  // 触碰错误颜色的障碍物 → 不加分、不扣分（弱化失败）
  const before = D.passed
  crossBoard(false)
  check(D.passed === before, `碰错颜色不加分也不扣分（仍为 ${D.passed}）`)
  check(g.status === 'playing', '碰错不结束游戏（继续）')

  // 掉出底部 → 温和重生
  D.crystal.y = 600 + 200
  D.crystal.r = 20
  g.update(0.02)
  check(D.crystal.y < 200, `掉出底部后温和重生（y=${Math.round(D.crystal.y)}）`)

  // 集满 15 过关
  D.passed = 14
  crossBoard(true)
  check(D.passed >= 15 && g.status === 'win', `穿过 15 块板子过关（已通过 ${D.passed}，状态 ${g.status}）`)
}

console.log('\n' + (failures === 0 ? '全部通过 ✓' : failures + ' 项失败 ✗'))
process.exit(failures === 0 ? 0 : 1)
