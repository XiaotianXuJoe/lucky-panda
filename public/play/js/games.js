/* 幸運熊貓 · 三個小遊戲（原生 Canvas，邏輯解析度 960x600）
 *
 * ★ 玩法嚴格對齊原小程序源碼（LuckPandaGame/assets/Script/）：
 *
 * 遊戲一「跳躍水晶」Game_UI_One —— 色塊匹配下墜：
 *   一顆有顏色的水晶受重力下落，玩家點按左/右（或 ←/→）彈射它
 *   （原版 zuoClick/youClick：vx=∓200, vy=250），讓它落到底部與水晶
 *   同顏色的色塊上；每 5 秒新出一排色塊（timeOver）；對上 +1 層，
 *   集滿 15 層過關（cengNum>=15 → winShow）；色塊數隨關卡 2/3/4/5/6。
 *   對不上 / 落空 → 原彈出 ShiBai_UI 後點關閉繼續（本版按需求 Q9
 *   弱化為溫和提示 + 彈回，不扣分、不打斷）。
 *
 * 遊戲二「記憶翻牌」Game_UI_Two —— 先記憶後配對：
 *   卡片先全部亮出一段時間（記憶時長隨關卡遞增：第 1~5 關 5/10/15/20/25 秒，
 *   需求2；原版 chushiTime>=10 統一翻面），之後憑記憶翻牌配對；
 *   配對錯誤 500ms 後翻回。牌數隨關卡 4/8/12/16/20（2/4/6/8/10 對）。
 *   每次進關：隨機符號子集 + 全量洗牌，且與同關上局逐位比對、不同才收（需求3）。
 *
 * 遊戲三「推箱子」Game_UI_Three —— 原版 7x8 地圖：
 *   地圖編碼 0空 1對的箱子 2水泥牆 3箱子 4圓圈 5角色 6土地，
 *   boxArr0..4 原樣照抄；步數統計（每次成功移動計 1 步）+
 *   最優步數（BFS 求解器覆核值 18/16/23/18/17，需求4 口徑統一）；
 *   每檔 3 張地圖（A=原圖 / B=180° 旋轉 / C=左右鏡像），洗牌袋隨機抽取（需求5）；
 *   全部箱子推上圓圈過關。
 *
 * 統一接口：create(level) -> {
 *   update(dt), draw(ctx, W, H), key(code, down), pointer(x, y),
 *   status: 'playing' | 'win',
 *   touchButtons: [{ label, key, wide }],
 *   hudText(): string,
 * }
 */
(function (global) {
  'use strict'

  var W = 960
  var H = 600

  /* 豎屏適配：邏輯解析度由外部按視口比例設置（main.js 的 syncViewport）。
   * 默認保持 960×600（橫屏/桌面不變），Node 測試不調用時行為完全一致。
   * 三個遊戲的布局均按 W/H 推導尺寸，切換後自動重排。 */
  function setViewport(w, h) {
    W = Math.max(320, Math.round(w || 960))
    H = Math.max(360, Math.round(h || 600))
  }
  function isPortrait() { return H > W }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function text(ctx, str, x, y, size, color, align) {
    ctx.font = '600 ' + size + 'px "PingFang SC","Microsoft YaHei",sans-serif'
    ctx.fillStyle = color || '#fff'
    ctx.textAlign = align || 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(str, x, y)
  }

  function drawPanda(ctx, x, y, s) {
    ctx.save()
    ctx.translate(x, y); ctx.scale(s, s)
    ctx.fillStyle = '#fdfdfd'
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#2c2c2c'
    ctx.beginPath(); ctx.arc(-13, -15, 8, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(13, -15, 8, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(0, 4, 16, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fdfdfd'
    ctx.beginPath(); ctx.arc(-13, -15, 6, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(13, -15, 6, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#1a1a1a'
    ctx.beginPath(); ctx.arc(-13, -15, 3, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(13, -15, 3, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(0, 8, 6, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(-4, 12); ctx.quadraticCurveTo(0, 16, 4, 12); ctx.stroke()
    ctx.restore()
  }

  /** 按顏色畫一顆水晶（type 對應 6 色） */
  function drawGem(ctx, x, y, s, color) {
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(s, s)
    ctx.beginPath()
    ctx.moveTo(0, -17); ctx.lineTo(11, -4); ctx.lineTo(7, 14); ctx.lineTo(-7, 14); ctx.lineTo(-11, -4)
    ctx.closePath()
    ctx.fillStyle = color; ctx.fill()
    ctx.beginPath()
    ctx.moveTo(0, -17); ctx.lineTo(7, -4); ctx.lineTo(4, 14); ctx.lineTo(-7, 14); ctx.lineTo(-11, -4)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill()
    ctx.beginPath()
    ctx.moveTo(0, -17); ctx.lineTo(3, -6); ctx.lineTo(0, 14); ctx.lineTo(-4, -6)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.restore()
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1))
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t
    }
    return arr
  }

  /* ===== AI 生成背景圖（public/play/assets/bg/）=====
   * 懶加載 + 就緒前回退到原漸變；Node 測試環境無 Image 時安全降級 */
  var BG_SRC = {
    crystal: 'assets/bg/bg-crystal-forest.jpeg',
    memory: 'assets/bg/bg-starry-night.jpeg',
    sokoban: 'assets/bg/bg-bamboo-yard.jpeg',
  }
  var BG_CACHE = {}
  function bgImage(name) {
    var e = BG_CACHE[name]
    if (!e) {
      e = BG_CACHE[name] = { ready: false, el: null }
      if (typeof Image !== 'undefined') {
        var el = new Image()
        el.onload = function () { e.ready = true }
        el.src = BG_SRC[name]
        e.el = el
      }
    }
    return e.ready ? e.el : null
  }
  /** 畫背景：圖就緒用圖，否則用兜底漸變（c1 頂 → c2 底） */
  function drawBg(ctx, name, c1, c2) {
    var img = bgImage(name)
    if (img) {
      ctx.drawImage(img, 0, 0, W, H)
      // 輕微壓暗/提亮，保證遊戲元素可讀性
      ctx.fillStyle = 'rgba(255,255,255,.08)'
      ctx.fillRect(0, 0, W, H)
    } else {
      var g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, c1); g.addColorStop(1, c2)
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    }
  }

  /* =========================================================
   * 遊戲一：跳躍水晶（板子下落 + 彈跳穿越同色障礙）
   *
   * 依據原版證據還原（非憑空設計）：
   * - 規則文字（Game_UI_One.prefab 提示面板 + 跳躍文字.png）：
   *   「屏幕上顯示不同顏色的矩形障礙物，玩家可以點擊屏幕的左側或右側來
   *    引導水晶穿過相同顏色的障礙物，同時避開不同顏色的障礙物。
   *    成功通過相同顏色的障礙物後，水晶會改變顏色，障礙物也會移動位置。
   *    他們將不斷上升，直到通過 30 個障礙才能進入下一級別。每個後續級別
   *    都會引入一種額外的顏色。如果玩家觸碰了錯誤的障礙物或未能及時選擇
   *    阻擋方向，則該回合結束，必須重新開始。」
   * - 代碼事實（Game_UI_One.ts）：
   *   playNode=水晶（剛體），zuoClick/youClick → vx=∓200、vy=250（點屏幕左右控制跳躍方向）
   *   lvShow：關卡 1~5 → 色塊數 2/3/4/5/6；moveShow 每 5 秒生成一排障礙物
   *   pzhdShow：按水晶 x 落在哪一格判定，同顏色 +1 層，cengNum>=15 過關
   *   水晶掉到 y<=-870 → 失敗；通過後水晶顏色重roll
   * - prefab 事實：colorItem1~5 為 750×70 的矩形排，每格 750/N 寬；
   *   player 節點 52×90 帶 RigidBody；左右兩側為牆體
   * - 用戶描述：「不同顏色的板子從上往下落下，點擊屏幕的左右控制跳躍方向」
   * ========================================================= */

  // 原版 6 色（colorArr）：藍/紅/黃/綠/橙/紫
  var GEM_COLORS = ['#1671ef', '#ff303c', '#fdf52e', '#45b026', '#ff8e1d', '#be1fec']

  function JumpCrystal(level) {
    var N = level + 1 // 障礙格數：第 1~5 關 → 2/3/4/5/6（lvShow）
    var palette = GEM_COLORS.slice(0, N)
    var TARGET = 15 // 每關目標 15 層（cengNum>=15 → 過關，原版代碼值）

    var ZONE_W = Math.min(720, W - 60) // 障礙區寬（原版 720；豎屏窄畫布時收窄以免溢出）
    var ZONE_X = (W - ZONE_W) / 2
    var SLOT_W = ZONE_W / N
    var ROW_H = 64 // 每排板子高（原版 70）
    var BOARD_VY = 84 // 板子下落速度 px/s（需求1：120 × 0.7 = 84，降速 30%，給孩子更多反應時間）
    var SPAWN_EVERY = 5 // 每 5 秒新出一排（原版 moveShow 間隔，需求1 保持節拍不變）
    // ⚠️ 唯一允許的聯動改動：若實機出現「同屏板子過擠、看不清」，把 SPAWN_EVERY 改為 7.1，
    //    行間距從 420px 還原為 ≈600px（玩法與數值規格 需求1 硬性驗收點）。
    // 本輪不引入「隨關卡加速」曲線，留作後續迭代。

    var G = 1500 // 重力
    var TAP_VX = 300 // 點按水平彈速（原版 200）
    var TAP_VY = -440 // 點按向上彈速（原版 250）
    var MAX_VY = 1150 // 終端速度

    var boards = [] // 下落的板子排
    var spawnT = 0
    var c = { x: W / 2, y: Math.round(H * 0.6), r: 20, vx: 0, vy: 0, type: 0 } // 水晶（豎屏按比例落在下方 60%）
    var passed = 0
    var t = 0
    var msg = ''
    var msgT = 0
    var status = 'playing'

    function spawnBoard() {
      boards.push({
        y: -ROW_H - 12,
        slots: shuffle(palette.map(function (_, i) { return i })), // 每格顏色隨機排列（shuziArr）
        holes: palette.map(function () { return false }), // 穿過的格子變空
        // 碰錯提示的「按格抑制」時間戳（避免同一格每幀刷屏）。
        // ⚠️ 絕不整排作廢：同一排裡其它同色格隨時可以穿，
        //    碰錯後玩家可以立刻改道穿過這一排的同色格（用戶反饋問題 3）。
        missAt: palette.map(function () { return -99 }),
      })
    }

    function rerollType() { c.type = Math.floor(Math.random() * N) } // 通過後水晶改變顏色
    function say(s) { msg = s; msgT = 1.8 }

    function tap(side) {
      if (status !== 'playing') return
      c.vx = side < 0 ? -TAP_VX : TAP_VX // 點左/右控制跳躍方向
      c.vy = TAP_VY
    }

    function respawn() {
      c.x = W / 2; c.y = Math.round(H * 0.2); c.vx = 0; c.vy = 0
    }

    spawnBoard()
    rerollType()

    return {
      status: 'playing',
      // 不顯示屏幕方向按鈕：電腦端用 ←/→，手機端點擊屏幕左/右半區（見 pointer）
      touchButtons: [],
      hudText: function () {
        return '已通過 ' + passed + ' 個（本關目標 ' + TARGET + ' 個）· 板子 ' + N + ' 格'
      },
      key: function (code, down) {
        if (!down) return
        if (code === 'ArrowLeft' || code === 'KeyA') tap(-1)
        if (code === 'ArrowRight' || code === 'KeyD') tap(1)
      },
      pointer: function (x) { tap(x < W / 2 ? -1 : 1) },
      update: function (dt) {
        t += dt
        if (msgT > 0) msgT -= dt
        if (status !== 'playing') return

        // 每 5 秒新下一排板子（timeOver → moveShow）
        spawnT += dt
        if (spawnT >= SPAWN_EVERY) { spawnT = 0; spawnBoard() }

        // 板子從上往下落
        for (var b = 0; b < boards.length; b++) boards[b].y += BOARD_VY * dt
        // 出屏移除
        boards = boards.filter(function (bd) { return bd.y < H + ROW_H })

        // 水晶物理
        c.vy += G * dt
        if (c.vy > MAX_VY) c.vy = MAX_VY
        c.x += c.vx * dt
        c.y += c.vy * dt

        // 左右牆體（prefab 中左/右兩個 RigidBody 牆）
        if (c.x < ZONE_X + c.r) { c.x = ZONE_X + c.r; c.vx = Math.abs(c.vx) * 0.6 }
        if (c.x > ZONE_X + ZONE_W - c.r) { c.x = ZONE_X + ZONE_W - c.r; c.vx = -Math.abs(c.vx) * 0.6 }

        // 穿越判定：水晶與某一排板子在 y 上重疊時，按 x 落在哪一格
        for (var i = 0; i < boards.length; i++) {
          var bd = boards[i]
          if (c.y + c.r > bd.y && c.y - c.r < bd.y + ROW_H) {
            var idx = Math.floor((c.x - ZONE_X) / SLOT_W)
            if (idx < 0) idx = 0
            if (idx > N - 1) idx = N - 1
            if (bd.holes[idx]) {
              // 已通過的格子是空的，直接穿過，不算
              continue
            }
            if (bd.slots[idx] === c.type) {
              // 穿過相同顏色的障礙物：+1 層，該格變空（此後可自由穿過）
              bd.holes[idx] = true
              passed++
              if (window.LPSfx) window.LPSfx.ding() // 激勵音效：水晶穿對顏色
              if (c.vy > -260) c.vy = -260 // 輕彈一下
              say('對啦！已通過 ' + passed + ' 個')
              rerollType() // 水晶會改變顏色
              if (passed >= TARGET) { status = 'win'; break }
            } else {
              // 觸碰了錯誤的障礙物：只提示 + 輕微回彈（弱化失敗）。
              // ⚠️ 關鍵：不做任何「整排作廢 / 整排冷卻」——碰錯後玩家可以立刻改道，
              //    穿過**同一排**裡顏色相同的格子（問題 3）。同一格 1.5s 內只提示一次。
              if (t - (bd.missAt[idx] || -99) > 1.5) {
                bd.missAt[idx] = t
                say('顏色不一樣，再找一找～')
              }
              if (c.vy > -180) c.vy = -180 // 輕微上彈：讓水晶留在這一排附近，方便立刻重試
            }
          }
        }

        // 未能及時選擇阻擋方向、掉出底部：溫和重來
        if (c.y - c.r > H + 30) {
          say('小水晶掉下去了，再來一次～')
          respawn()
        }
        this.status = status
      },
      draw: function (ctx) {
        // 背景（AI 水晶森林圖；未就緒時回退漸變+白雲）
        var bgReady = !!bgImage('crystal')
        drawBg(ctx, 'crystal', '#58aef1', '#dfeee9')
        if (!bgReady) {
          ctx.fillStyle = 'rgba(255,255,255,.5)'
          ctx.beginPath(); ctx.ellipse(150, 80, 70, 22, 0, 0, Math.PI * 2); ctx.fill()
          ctx.beginPath(); ctx.ellipse(760, 130, 60, 18, 0, 0, Math.PI * 2); ctx.fill()
        }

        // 兩側引導線（牆）
        ctx.strokeStyle = 'rgba(255,255,255,.5)'
        ctx.lineWidth = 3
        ctx.setLineDash([8, 10])
        ctx.beginPath(); ctx.moveTo(ZONE_X, 0); ctx.lineTo(ZONE_X, H); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(ZONE_X + ZONE_W, 0); ctx.lineTo(ZONE_X + ZONE_W, H); ctx.stroke()
        ctx.setLineDash([])

        // 下落的板子排（矩形障礙物，已穿過的格子為空）
        for (var i = 0; i < boards.length; i++) {
          var bd = boards[i]
          for (var s = 0; s < N; s++) {
            if (bd.holes[s]) continue // 空位：水晶從這裡穿過
            var sx = ZONE_X + s * SLOT_W
            ctx.fillStyle = GEM_COLORS[bd.slots[s]]
            rr(ctx, sx + 4, bd.y + 4, SLOT_W - 8, ROW_H - 8, 10); ctx.fill()
            ctx.fillStyle = 'rgba(255,255,255,.25)'
            rr(ctx, sx + 4, bd.y + 4, SLOT_W - 8, 16, 10); ctx.fill()
          }
        }

        // 水晶（原版為 52×90 豎向寶石，顏色隨關卡重roll）
        drawGem(ctx, c.x, c.y, c.r / 11, GEM_COLORS[c.type])

        // 提示語
        if (msgT > 0) {
          ctx.globalAlpha = Math.min(1, msgT)
          text(ctx, msg, W / 2, 88, 22, 'rgba(30,50,45,.92)', 'center')
          ctx.globalAlpha = 1
        }

        // 進度（醒目）+ 操作提示（原 hudText 未渲染，這裡直接畫在畫布上）
        text(ctx, '已通過 ' + passed + ' / ' + TARGET + ' 個', W / 2, 34, 24, 'rgba(25,45,40,.92)', 'center')
        text(ctx, '點屏幕左 / 右，讓水晶穿過和它一樣顏色的板子', W / 2, 62, 15, 'rgba(25,45,40,.6)', 'center')
      },
      destroy: function () { },
      _debug: {
        get boards() { return boards },
        spawnBoard: spawnBoard,
        crystal: c,
        get passed() { return passed },
        set passed(v) { passed = v },
        N: N, ZONE_X: ZONE_X, SLOT_W: SLOT_W, ROW_H: ROW_H, BOARD_VY: BOARD_VY,
        rerollType: rerollType, respawn: respawn, tap: tap,
      },
    }
  }

  /* =========================================================
   * 遊戲二：記憶翻牌（先記憶 10 秒再配對）—— 對齊 Game_UI_Two.ts
   * ========================================================= */

  var SYMBOLS = ['🍎', '🐼', '🌈', '⭐', '🍭', '🎈', '🌻', '🍄', '🧸', '🎨', '🚀', '🐟']

  /* 需求3「每次都完全打亂」：
   * ① 隨機挑符號子集（不再永遠取前 pairs 個）② 複製兩份後整副 Fisher–Yates 全量洗牌
   * ③ 與同關卡上一局逐位比對，不完全相同才收（上限 20 次兜底，不會死循環）。
   * 不設「相鄰同值」約束：相鄰兩格同符號反而是一對，禁止相鄰會削弱隨機性。 */
  var LAST_DECK = {} // key: level -> 同關卡上一局的 deck 序列（會話級）

  function sameOrder(a, b) {
    if (!b || a.length !== b.length) return false
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  function buildDeck(level, pairs) {
    var tryN = 0
    var deck
    do {
      var pool = shuffle(SYMBOLS.slice())
      var chosen = pool.slice(0, pairs)
      deck = shuffle(chosen.concat(chosen))
      tryN++
    } while (sameOrder(deck, LAST_DECK[level]) && tryN < 20)
    LAST_DECK[level] = deck.slice()
    return deck
  }

  function Memory(level) {
    // 原版牌數 4/8/12/16/20（sgArr），對應 2/4/6/8/10 對
    // 布局索引雙端夾緊（低端夾到第 1 關布局），與 MEMORIZE_TABLE 的 clamp 口徑對稱（QA 硬化項）
    var cfg = [
      { cols: 2, rows: 2 }, { cols: 4, rows: 2 }, { cols: 4, rows: 3 },
      { cols: 4, rows: 4 }, { cols: 5, rows: 4 },
    ][Math.min(Math.max(level - 1, 0), 4)]

    var cols = cfg.cols, rowsN = cfg.rows
    var total = cols * rowsN
    var pairs = total / 2
    var deck = buildDeck(level, pairs) // 需求3：每局重新隨機，且與同關上局不同

    // 豎屏（H > W）畫布更窄更高：放寬卡片上限、收窄左右留白，牌少時能放大；橫屏數值與原先完全一致
    var pt = isPortrait()
    var capW = pt ? Math.min(140, Math.round(W * 0.42)) : 120
    var capH = pt ? capW + 20 : 150
    var cardW = Math.min(capW, Math.floor((W - (pt ? 80 : 160)) / cols) - 12)
    var cardH = Math.min(capH, Math.floor((H - (pt ? 360 : 240)) / rowsN) - 12)
    var gridW = cols * (cardW + 12) - 12
    var gridH = rowsN * (cardH + 12) - 12
    var ox = Math.round((W - gridW) / 2)
    var oy = Math.round((H - gridH) / 2) + 16

    var cards = deck.map(function (s, idx) {
      return { sym: s, flipped: true, matched: false, idx: idx } // 初始全部亮出（記憶階段）
    })
    // 需求2：記憶時長隨關卡遞增（第 1~5 關 5/10/15/20/25 秒）；越界關卡夾到 1~5
    var MEMORIZE_TABLE = [5, 10, 15, 20, 25]
    var lv = Math.min(Math.max(level, 1), 5)
    var MEMORIZE_S = MEMORIZE_TABLE[lv - 1]
    var memorize = MEMORIZE_S
    var phase = 'memorize' // memorize | play
    var opened = []
    var lock = 0
    var moves = 0
    var foundPairs = 0
    var t = 0
    var status = 'playing'

    function rectOf(i) {
      var c = i % cols, r = Math.floor(i / cols)
      return { x: ox + c * (cardW + 12), y: oy + r * (cardH + 12), w: cardW, h: cardH }
    }

    function flipAllDown() {
      cards.forEach(function (c) { c.flipped = false })
      phase = 'play'
    }

    function check() {
      if (opened.length !== 2) return
      var a = cards[opened[0]], b = cards[opened[1]]
      moves++
      if (a.sym === b.sym) {
        a.matched = true; b.matched = true; opened = []
        foundPairs++
        if (window.LPSfx) window.LPSfx.ding() // 激勵音效：翻牌配對成功
        if (foundPairs >= pairs) status = 'win'
      } else {
        lock = 0.5 // 原版 500ms 後翻回
      }
    }

    return {
      status: 'playing',
      touchButtons: [],
      hudText: function () {
        if (phase === 'memorize') {
          return '記住圖案位置！' + Math.ceil(memorize) + ' 秒後翻面'
        }
        return '憑記憶配對（已找到 ' + foundPairs + '/' + pairs + ' 對）'
      },
      key: function () { },
      pointer: function (x, y) {
        if (phase !== 'play' || lock > 0 || status === 'win') return
        for (var i = 0; i < cards.length; i++) {
          var c = cards[i]
          if (c.flipped || c.matched) continue
          var r = rectOf(i)
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            c.flipped = true
            opened.push(i)
            if (opened.length === 2) check()
            return
          }
        }
      },
      update: function (dt) {
        t += dt
        if (phase === 'memorize') {
          memorize -= dt
          if (memorize <= 0) { memorize = 0; flipAllDown() }
        }
        if (lock > 0) {
          lock -= dt
          if (lock <= 0) {
            lock = 0
            opened.forEach(function (i) { cards[i].flipped = false })
            opened = []
          }
        }
        this.status = status
      },
      draw: function (ctx) {
        drawBg(ctx, 'memory', '#2a4a6b', '#123024')

        if (phase === 'memorize') {
          // 記憶階段：醒目的倒計時提醒（頂部進度條 + 秒數膠囊 + 說明）
          var secLeft = Math.max(0, Math.ceil(memorize))
          var ratio = Math.max(0, Math.min(1, memorize / MEMORIZE_S))
          var col = ratio > 0.3 ? '#ffd75e' : '#ff7a7a'
          ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, 0, W, 10)
          ctx.fillStyle = col; ctx.fillRect(0, 0, W * ratio, 10)
          var bw = 320, bh = 62, bx = (W - bw) / 2, by = 30
          ctx.fillStyle = 'rgba(0,0,0,.4)'; rr(ctx, bx, by, bw, bh, 31); ctx.fill()
          ctx.strokeStyle = col; ctx.lineWidth = 3; rr(ctx, bx, by, bw, bh, 31); ctx.stroke()
          text(ctx, secLeft + ' 秒後翻面', W / 2, by + bh / 2, 28, col, 'center')
          text(ctx, '記住卡片的位置', W / 2, by + bh + 24, 18, 'rgba(255,255,255,.85)', 'center')
        } else {
          text(ctx, '憑記憶找出兩張一樣的圖案', W / 2, oy - 36, 18, 'rgba(255,255,255,.6)', 'center')
        }

        for (var i = 0; i < cards.length; i++) {
          var c = cards[i]
          var r = rectOf(i)
          var show = c.flipped || c.matched
          ctx.save()
          if (show) {
            ctx.fillStyle = c.matched ? '#e9f8ec' : '#ffffff'
            rr(ctx, r.x, r.y, r.w, r.h, 12); ctx.fill()
            ctx.font = Math.floor(cardH * 0.5) + 'px sans-serif'
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
            ctx.fillText(c.sym, r.x + r.w / 2, r.y + r.h / 2 + 4)
          } else {
            ctx.fillStyle = '#3f9a5f'
            rr(ctx, r.x, r.y, r.w, r.h, 12); ctx.fill()
            ctx.fillStyle = 'rgba(255,255,255,.18)'
            rr(ctx, r.x + 8, r.y + 8, r.w - 16, r.h - 16, 8); ctx.fill()
            ctx.font = Math.floor(cardH * 0.34) + 'px sans-serif'
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
            ctx.fillStyle = 'rgba(255,255,255,.85)'
            ctx.fillText('?', r.x + r.w / 2, r.y + r.h / 2)
          }
          ctx.restore()
        }
      },
      destroy: function () { },
      _debug: {
        cards: cards, rectOf: rectOf,
        get phase() { return phase },
        skipMemorize: function () { memorize = 0 },
        get memorize() { return memorize },
        MEMORIZE_S: MEMORIZE_S,
      },
    }
  }

  /* =========================================================
   * 遊戲三：推箱子（原版 7x8 地圖）—— 對齊 Game_UI_Three.ts
   * 編碼：0空 1對的箱子 2水泥牆 3箱子 4圓圈 5角色 6土地
   * ========================================================= */

  var SOKO_MAPS = [
    [[0, 2, 2, 2, 2, 2, 0],
     [0, 2, 1, 6, 4, 2, 0],
     [0, 2, 6, 6, 6, 2, 0],
     [0, 2, 6, 3, 6, 2, 0],
     [0, 2, 6, 3, 6, 2, 0],
     [0, 2, 6, 3, 6, 2, 0],
     [0, 2, 4, 5, 4, 2, 0],
     [0, 2, 2, 2, 2, 2, 0]],
    [[0, 0, 0, 0, 0, 0, 0],
     [0, 0, 2, 2, 2, 2, 0],
     [2, 2, 2, 6, 4, 2, 0],
     [2, 6, 3, 6, 4, 2, 0],
     [2, 6, 5, 3, 6, 2, 0],
     [2, 2, 6, 6, 2, 2, 0],
     [0, 2, 2, 2, 2, 0, 0],
     [0, 0, 0, 0, 0, 0, 0]],
    [[0, 0, 0, 0, 0, 0, 0],
     [0, 2, 2, 2, 2, 2, 0],
     [0, 2, 4, 6, 5, 2, 0],
     [0, 2, 4, 3, 6, 2, 0],
     [0, 2, 6, 3, 6, 2, 0],
     [0, 2, 6, 3, 4, 2, 0],
     [0, 2, 2, 2, 2, 2, 0],
     [0, 0, 0, 0, 0, 0, 0]],
    [[2, 2, 2, 2, 2, 2, 0],
     [2, 5, 6, 6, 6, 2, 0],
     [2, 6, 3, 1, 6, 2, 0],
     [2, 6, 3, 4, 6, 2, 0],
     [2, 6, 3, 4, 6, 2, 0],
     [2, 6, 1, 4, 6, 2, 0],
     [2, 6, 6, 6, 6, 2, 0],
     [2, 2, 2, 2, 2, 2, 0]],
    [[0, 0, 0, 0, 0, 0, 0],
     [0, 2, 2, 2, 2, 2, 0],
     [2, 2, 4, 6, 1, 2, 2],
     [2, 4, 3, 3, 6, 4, 2],
     [2, 3, 5, 6, 3, 6, 2],
     [2, 4, 3, 3, 3, 4, 2],
     [2, 2, 4, 6, 4, 2, 2],
     [0, 2, 2, 2, 2, 2, 0]],
  ]

  // 最優步數（需求4：與 moves 同口徑 = 每次成功移動計 1 步，BFS 求解器覆核值。
  // 舊 zuiKuaiArr 第 1 關為 22，覆核後真實最少移動步數為 18，按求解器重算值為準。）
  var BEST_STEPS = [18, 16, 23, 18, 17]

  /* 需求5（保底方案）：每檔 3 張地圖 —— A=原圖，B=A 的 180° 旋轉，C=A 的左右鏡像。
   * 對稱變換保持 7×8 維度、可解性與最優步數（best 直接沿用 A），共 5 檔 × 3 張 = 15 張。
   * 後續迭代應逐步把 B/C 替換為手工設計的真·不同圖（替換後必須用求解器重算 best）。 */
  function rot180(rows) {
    return rows.slice().reverse().map(function (r) { return r.slice().reverse() })
  }
  function mirrorX(rows) {
    return rows.map(function (r) { return r.slice().reverse() })
  }
  var SOKO_TIERS = SOKO_MAPS.map(function (rows, i) {
    return [
      { rows: rows, best: BEST_STEPS[i] },
      { rows: rot180(rows), best: BEST_STEPS[i] },
      { rows: mirrorX(rows), best: BEST_STEPS[i] },
    ]
  })

  /* 需求5 洗牌袋（shuffle bag）：同一檔連續兩次不抽到同一張，每玩 3 次必覆蓋 3 張；
   * 袋空重洗 [0,1,2] 且新袋首張 ≠ 上袋末張（防跨袋連續重複）。會話級，頁面刷新即重置。 */
  var SOKO_BAG = {} // tier -> 待抽隊列（數組，附加 .last 記錄本袋末張）
  function pickMapIdx(tier) {
    var bag = SOKO_BAG[tier]
    if (!bag || bag.length === 0) {
      var fresh = shuffle([0, 1, 2])
      if (bag && bag.last != null && fresh[0] === bag.last) {
        var j = -1
        for (var i = 1; i < fresh.length; i++) {
          if (fresh[i] !== bag.last) { j = i; break }
        }
        if (j > 0) { var t = fresh[0]; fresh[0] = fresh[j]; fresh[j] = t }
      }
      bag = fresh
      SOKO_BAG[tier] = bag
    }
    var pick = bag.shift()
    bag.last = pick
    return pick
  }

  function Sokoban(level) {
    // 需求5：每次進關（含第 5 關的每次重複）都按洗牌袋抽 1 張；最優步數 = 當前抽中地圖的 best
    var tier = Math.min(Math.max(level, 1), 5) - 1
    var mapIdx = pickMapIdx(tier)
    var card = SOKO_TIERS[tier][mapIdx]
    var best = card.best
    var raw = card.rows
    var rowsN = raw.length
    var colsN = raw[0].length
    var map = raw.map(function (r) { return r.slice() })

    var px = 0, py = 0
    var goals = []
    var boxes = []
    for (var y = 0; y < rowsN; y++) {
      for (var x = 0; x < colsN; x++) {
        var ch = map[y][x]
        if (ch === 4 || ch === 1) goals.push({ x: x, y: y })
        if (ch === 3 || ch === 1) boxes.push({ x: x, y: y })
        if (ch === 5) { px = x; py = y }
        if (ch !== 2) map[y][x] = ch === 4 || ch === 1 ? 4 : 6 // 6=土地, 4=圓圈, 2=水泥
      }
    }

    // 豎屏（H > W）：收窄左右留白、放寬 tile 上限，讓棋盤佔滿手機寬度；橫屏數值與原先完全一致
    var pt = isPortrait()
    var tile = Math.min(pt ? 74 : 60, Math.floor(Math.min((W - (pt ? 90 : 180)) / colsN, (H - (pt ? 300 : 210)) / rowsN)))
    var ox
    /* 視覺居中：按「實際佔用格子」的包圍盒居中，而不是整張 colsN 寬的網格。
     * 原因：個別地圖一側多留一列空地（第 4 關原圖右側第 6 列為空、第 2 關右側同樣為空），
     * 按整張網格居中會讓畫面整體偏左半格；180° 旋轉 / 左右鏡像變體把空列換到另一側，就變成偏右。
     * 包圍盒居中後 A/B/C 三種變體視覺上都對稱；對稱地圖算出的 ox 與原先一致（橫屏觀感不變）。 */
    var minC = colsN, maxC = -1
    for (var by = 0; by < rowsN; by++) {
      for (var bx = 0; bx < colsN; bx++) {
        if (raw[by][bx] !== 0) { if (bx < minC) minC = bx; if (bx > maxC) maxC = bx }
      }
    }
    if (maxC < minC) { minC = 0; maxC = colsN - 1 }
    var spanCols = maxC - minC + 1
    ox = Math.round((W - spanCols * tile) / 2) - minC * tile
    var oy = Math.round((H - rowsN * tile) / 2) + 26
    // D4：豎屏底部至少預留 170 邏輯 px 給右下熊貓陪伴卡（104 CSS px ≈ 166 邏輯 px + 邊距），
    // 避免熊貓卡壓住棋盤底排；極端矮畫布時 oy 夾到 ≥8。僅豎屏生效，橫屏 oy 公式不變。
    if (pt) {
      oy = Math.min(oy, H - rowsN * tile - 170)
      if (oy < 8) oy = 8
    }

    // 初始布局快照：「重來」重置回同一張圖（需求5 的抽取時機僅為「進關」，重來不重新抽圖）
    var initBoxes = boxes.map(function (b) { return { x: b.x, y: b.y } })
    var initPx = px, initPy = py

    var moves = 0 // 步數口徑：每成功移動一格記 1（空手走/推箱都算）；撞牆/被箱擋住不計；重來歸零
    var t = 0
    var status = 'playing'

    function boxAt(x, y) {
      for (var i = 0; i < boxes.length; i++) if (boxes[i].x === x && boxes[i].y === y) return boxes[i]
      return null
    }
    function isGoal(x, y) { return goals.some(function (g) { return g.x === x && g.y === y }) }
    function isWall(x, y) {
      return y < 0 || y >= rowsN || x < 0 || x >= colsN || map[y][x] === 2
    }
    function tryMove(dx, dy) {
      if (status === 'win') return
      var nx = px + dx, ny = py + dy
      if (isWall(nx, ny)) return
      var b = boxAt(nx, ny)
      if (b) {
        var bx = nx + dx, by = ny + dy
        if (isWall(bx, by) || boxAt(bx, by)) return
        var wasOnGoal = isGoal(b.x, b.y) // 推之前是否已在圓圈上
        b.x = bx; b.y = by
        // 激勵音效：箱子被**新**推上圓圈（本來就在圈上挪到另一個圈不重複響）
        if (!wasOnGoal && isGoal(bx, by) && window.LPSfx) window.LPSfx.ding()
      }
      px = nx; py = ny; moves++
      if (boxes.every(function (bb) { return isGoal(bb.x, bb.y) })) status = 'win'
    }

    return {
      status: 'playing',
      // 不顯示方向按鈕：電腦端用方向鍵 / WASD，手機端直接點小熊貓的上/下/左/右方向（見 pointer）
      touchButtons: [{ label: '重來', key: 'KeyR', wide: true }],
      hudText: function () {
        return '步數 ' + moves + ' · 目標 ' + best + ' 步' // 最優步數 = 當前抽中地圖的 best（需求4）
      },
      key: function (code, down) {
        if (!down) return
        if (code === 'ArrowUp' || code === 'KeyW') tryMove(0, -1)
        if (code === 'ArrowDown' || code === 'KeyS') tryMove(0, 1)
        if (code === 'ArrowLeft' || code === 'KeyA') tryMove(-1, 0)
        if (code === 'ArrowRight' || code === 'KeyD') tryMove(1, 0)
        // 重來：重置回同一張圖的初始布局並步數歸零（不重新抽圖）
        if (code === 'KeyR') {
          px = initPx; py = initPy
          boxes = initBoxes.map(function (b) { return { x: b.x, y: b.y } })
          moves = 0; status = 'playing'
        }
      },
      /** 手機端：點小熊貓的上 / 下 / 左 / 右方向，移動一格 */
      pointer: function (x, y) {
        if (status === 'win') return
        var cx = ox + px * tile + tile / 2
        var cy = oy + py * tile + tile / 2
        var dx = x - cx, dy = y - cy
        var dead = tile * 0.4 // 中心死區：點在小熊貓身上不誤觸
        if (Math.abs(dx) < dead && Math.abs(dy) < dead) return
        if (Math.abs(dx) >= Math.abs(dy)) tryMove(dx > 0 ? 1 : -1, 0)
        else tryMove(0, dy > 0 ? 1 : -1)
      },
      update: function (dt) { t += dt; this.status = status },
      draw: function (ctx) {
        drawBg(ctx, 'sokoban', '#f3e6cf', '#cfe3c2')
        // 提示語下移到 y=112，給步數條（y≈52~99）讓位（界面視覺規格 §1）
        text(ctx, '把所有箱子推到圓圈上', W / 2, 112, 15, 'rgba(90,60,30,.65)', 'center')

        for (var y = 0; y < rowsN; y++) {
          for (var x = 0; x < colsN; x++) {
            var X = ox + x * tile, Y = oy + y * tile
            var v = map[y][x]
            if (v === 0) continue // 空地（圍牆外）
            if (v === 2) {
              // 水泥牆
              ctx.fillStyle = '#8a6a45'
              rr(ctx, X + 1, Y + 1, tile - 2, tile - 2, 5); ctx.fill()
              ctx.fillStyle = 'rgba(255,255,255,.12)'
              rr(ctx, X + 5, Y + 5, tile - 10, tile - 14, 4); ctx.fill()
            } else {
              // 土地
              ctx.fillStyle = 'rgba(255,255,255,.4)'
              rr(ctx, X + 1, Y + 1, tile - 2, tile - 2, 5); ctx.fill()
              if (v === 4) {
                // 圓圈
                ctx.strokeStyle = '#2f7a49'; ctx.lineWidth = 3
                ctx.beginPath(); ctx.arc(X + tile / 2, Y + tile / 2, tile * 0.22, 0, Math.PI * 2); ctx.stroke()
              }
            }
          }
        }
        // 箱子（推上圓圈變「對的箱子」：綠色 + ✓）
        boxes.forEach(function (b) {
          var X = ox + b.x * tile, Y = oy + b.y * tile
          var done = isGoal(b.x, b.y)
          ctx.fillStyle = done ? '#3f9a5f' : '#c58a3d'
          rr(ctx, X + 5, Y + 5, tile - 10, tile - 10, 6); ctx.fill()
          ctx.strokeStyle = done ? '#2f7a49' : '#8a5a22'; ctx.lineWidth = 3
          rr(ctx, X + 5, Y + 5, tile - 10, tile - 10, 6); ctx.stroke()
          if (done) {
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(X + tile * 0.3, Y + tile * 0.52)
            ctx.lineTo(X + tile * 0.45, Y + tile * 0.68)
            ctx.lineTo(X + tile * 0.72, Y + tile * 0.34)
            ctx.stroke()
          } else {
            ctx.beginPath()
            ctx.moveTo(X + 8, Y + tile / 2); ctx.lineTo(X + tile - 8, Y + tile / 2)
            ctx.stroke()
          }
        })
        // 角色（熊貓）
        drawPanda(ctx, ox + px * tile + tile / 2, oy + py * tile + tile / 2, tile / 52)

        // [UI] Sokoban 步數 HUD（目標/現在）：單行雙膠囊、整組居中、豎直中心 y=76
        // （界面視覺規格 §1 參數表；draw() 僅在進行中被調用，win 後 moves 凍結不再 +1）
        var FONT = '"PingFang SC","Microsoft YaHei",sans-serif'
        var tGoal = '目標 ' + best + ' 步'
        var tNow = '現在 ' + moves + ' 步'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = '700 22px ' + FONT
        var wGoal = ctx.measureText(tGoal).width + 20 * 2 // 高 42、橫向內邊距 20
        ctx.font = '700 26px ' + FONT
        var wNow = ctx.measureText(tNow).width + 22 * 2 // 高 46、橫向內邊距 22
        var x0 = (W - (wGoal + 14 + wNow)) / 2 // 兩膠囊間距 14，整組居中
        // 目標膠囊（中性色：目標/參照）
        var hGoal = 42
        ctx.fillStyle = 'rgba(20,38,30,.55)'
        rr(ctx, x0, 76 - hGoal / 2, wGoal, hGoal, hGoal / 2); ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,.30)'; ctx.lineWidth = 2
        rr(ctx, x0, 76 - hGoal / 2, wGoal, hGoal, hGoal / 2); ctx.stroke()
        ctx.font = '700 22px ' + FONT
        ctx.fillStyle = '#eef4f0'
        ctx.fillText(tGoal, x0 + wGoal / 2, 76)
        // 現在膠囊（品牌綠強調：當前/進行中 + 外發光 0 0 0 3px）
        var hNow = 46
        var xNow = x0 + wGoal + 14
        ctx.fillStyle = 'rgba(63,154,95,.28)'
        rr(ctx, xNow - 3, 76 - hNow / 2 - 3, wNow + 6, hNow + 6, hNow / 2 + 3); ctx.fill()
        ctx.fillStyle = '#2f7a49'
        rr(ctx, xNow, 76 - hNow / 2, wNow, hNow, hNow / 2); ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 2
        rr(ctx, xNow, 76 - hNow / 2, wNow, hNow, hNow / 2); ctx.stroke()
        ctx.font = '700 26px ' + FONT
        ctx.fillStyle = '#ffffff'
        ctx.fillText(tNow, xNow + wNow / 2, 76)
      },
      destroy: function () { },
      _debug: { get px() { return px }, get py() { return py }, get boxes() { return boxes }, raw: raw, get moves() { return moves }, get best() { return best }, get mapIdx() { return mapIdx }, get tier() { return tier }, tile: tile, ox: ox, oy: oy, bbox: { minC: minC, maxC: maxC, span: spanCols } },
    }
  }

  global.LPGames = {
    jump: { name: '跳躍水晶', create: JumpCrystal },
    memory: { name: '記憶翻牌', create: Memory },
    // tiers：需求5 的權威結構（5 檔 × 3 張 {rows, best}）；maps/bestSteps 保留為每檔 A 卡的兼容視圖
    sokoban: { name: '推箱子', create: Sokoban, maps: SOKO_MAPS, bestSteps: BEST_STEPS, tiers: SOKO_TIERS },
    helpers: { rr: rr, text: text, drawGem: drawGem, drawPanda: drawPanda },
    setViewport: setViewport,
    getViewport: function () { return { w: W, h: H, portrait: isPortrait() } },
  }
})(window)
