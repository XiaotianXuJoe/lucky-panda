/* 幸運熊貓 · 訓練流程主控
 *
 * 流程（總時長約 21 分鐘）：
 *   開場動畫 40s → 第1階段遊戲 6min → 轉場動畫 55s → 第2階段遊戲 6min
 *   → 轉場動畫 55s → 第3階段遊戲 6min → 結束動畫 40s → 謝謝參與
 *
 * 計時規則：
 *   - 只有「遊戲進行中」才累加訓練時長（動畫、講解期間計時器暫停）
 *   - 切到後臺自動暫停，該段時間不計入訓練時長，並記入 Time.pauses
 *   - 計時基於真實時鐘 Date.now() / performance.now()，不受後臺標籤頁節流影響
 */
(function () {
  'use strict'

  var W = 960, H = 600
  var BLOCK_MS = 6 * 60 * 1000

  /* ---------------- 測試直達模式（需求8，契約見技術架構規格 Q1） ----------------
   * /play/?mode=test&stage=N&level=M&minutes=&tutorial=
   *   mode=test 跳過登錄跳轉、跳過故事/開場，直達指定階段關卡，且會話不上報；
   *   minutes 覆蓋 6 分鐘閘門（<=0 視為無閘門，QA 逐關驗收不被自動推進打斷）；
   *   tutorial=1 時仍播放玩法講解。query 傳輸，不用 localStorage，不汙染正常訓練。 */
  var qs = null
  try { qs = new URLSearchParams(location.search) } catch (e) { qs = null }
  var testMode = !!(qs && qs.get('mode') === 'test')
  function qNum(name) {
    if (!qs) return NaN
    var v = qs.get(name)
    if (v == null || v === '') return NaN
    return Number(v)
  }
  var minutesQ = qNum('minutes')
  if (Number.isFinite(minutesQ)) {
    BLOCK_MS = minutesQ > 0 ? minutesQ * 60000 : Infinity // <=0 無閘門
  }

  var canvas = document.getElementById('gameCanvas')
  var ctx = canvas.getContext('2d')
  canvas.width = W
  canvas.height = H

  /* ---------------- 豎屏 / 橫屏 邏輯解析度 ----------------
   * 橫屏（aw >= ah）：保持 960×600 原解析度，桌面/橫屏觀感不變（等比 contain + 留邊）。
   * 豎屏：改用 600 寬 × 按視口比例算出的高，畫布正好鋪滿 HUD 以下的可用區域，
   *       三個小遊戲按新 W/H 自動重排（卡片、棋盤、障礙區尺寸都由 W/H 推導）。
   * 每關開局時對齊一次；關卡中途旋轉只做等比縮放，不打斷當前進度。 */
  function viewportFor(aw, ah) {
    if (!aw || !ah || aw >= ah) return { w: 960, h: 600 }
    var w = 600
    var h = Math.round((w * ah) / aw)
    h = Math.max(760, Math.min(1500, h))
    return { w: w, h: h }
  }
  /* 豎屏時把遊戲舞臺壓到 HUD 下方，避免畫布內容被頂部信息條蓋住 */
  function applyStageInset() {
    var box = document.getElementById('gameStage')
    var hud = document.querySelector('.hud')
    var portrait = window.innerHeight >= window.innerWidth
    var off = 0
    if (portrait && hud) {
      var r = hud.getBoundingClientRect()
      if (r.height > 0) off = Math.ceil(r.height) + 4
    }
    box.style.top = off + 'px'
  }
  function syncViewport() {
    applyStageInset()
    var box = document.getElementById('gameStage')
    var vp = viewportFor(box.clientWidth, box.clientHeight)
    if (vp.w === W && vp.h === H) return false
    W = vp.w; H = vp.h
    if (LPGames.setViewport) LPGames.setViewport(W, H)
    canvas.width = W; canvas.height = H
    return true
  }

  /* ---------------- 登錄檢查（testMode 免登錄） ---------------- */
  var token = ''
  try { token = localStorage.getItem('luckyPanda.userToken') || '' } catch { token = '' }
  if (!token && !testMode) {
    location.href = '/#/login'
    return
  }

  /* ---------------- DOM ---------------- */
  var elStageLabel = document.getElementById('stageLabel')
  var elTimer = document.getElementById('timer')
  var elCrystals = document.getElementById('crystals')
  var elLevel = document.getElementById('levelTag')
  var elStory = document.getElementById('storyLayer')
  var elTut = document.getElementById('tutorialLayer')
  var elPause = document.getElementById('pauseLayer')
  var elFinish = document.getElementById('finishLayer')
  var elTouch = document.getElementById('touchPad')

  // 15 顆水晶位（3 階段 × 5 關）
  for (var i = 0; i < 15; i++) {
    var d = document.createElement('span')
    d.className = 'crystal-dot'
    elCrystals.appendChild(d)
  }
  var dots = elCrystals.querySelectorAll('.crystal-dot')

  /* ---------------- 流程定義 ---------------- */
  var FLOW = [
    { type: 'story', kind: 'intro', ms: 40000 },
    { type: 'play', stage: 1, game: 'jump' },
    { type: 'story', kind: 'story1', ms: 55000 },
    { type: 'play', stage: 2, game: 'memory' },
    { type: 'story', kind: 'story2', ms: 55000 },
    { type: 'play', stage: 3, game: 'sokoban' },
    { type: 'story', kind: 'ending', ms: 40000 },
  ]

  var TUTORIALS = {
    jump: {
      title: '跳躍水晶',
      img: '/play/assets/panda/panda-pose-wave.jpeg',
      bg: '/play/assets/bg/bg-crystal-forest.jpeg',
      say: '這一關叫跳躍水晶。你看，不同顏色的板子會從上面慢慢往下落。點屏幕的左邊或者右邊，就能控制水晶往那邊跳。讓水晶穿過和它一樣顏色的板子，穿過去以後，水晶還會換一種顏色哦。一共穿對 15 塊板子就過關啦。要是碰到不一樣的顏色也沒關係，它只是輕輕提醒你一下，不扣分的，再來一次就好。',
      rules: [
        '電腦按 ← / →（或 A / D）鍵；手機點屏幕左半邊 / 右半邊，控制水晶跳躍',
        '不同顏色的板子從上往下落，引導水晶穿過和它一樣顏色的板子',
        '每穿過一塊同色板子 +1，水晶會換一種顏色；集滿 15 次過關',
        '碰到不同顏色的板子只會彈開提示，不扣分，繼續試就好',
        '一共 5 關，越往後板子越多',
      ],
    },
    memory: {
      title: '記憶翻牌',
      img: '/play/assets/panda/panda-pose-thinking.jpeg',
      bg: '/play/assets/bg/bg-starry-night.jpeg',
      say: '這一關叫記憶翻牌。等一會兒，卡片會先全部亮出來，給你一點時間記住它們的位置。關卡越往後，給的時間越長：第一關 5 秒，之後每過一關多 5 秒，第五關有 25 秒。時間到了卡片會翻過去，接下來就要靠你的記憶力，找出兩張一樣的圖案。全部配對成功就過關啦。',
      rules: [
        '卡片先全部亮出，屏幕上有倒計時，請仔細看並記住位置',
        '記憶時間隨關卡遞增：第 1 關 5 秒、第 2 關 10 秒、第 3 關 15 秒、第 4 關 20 秒、第 5 關 25 秒',
        '倒計時結束後卡片統一翻面，憑記憶點擊兩張相同的圖案',
        '配對成功卡片會保持翻開；圖案不同會自動蓋回去，可以再試',
        '每次進入關卡卡片排布都會重新打亂；全部配對成功即過關',
      ],
    },
    sokoban: {
      title: '推箱子',
      img: '/play/assets/panda/panda-pose-focus.jpeg',
      bg: '/play/assets/bg/bg-bamboo-yard.jpeg',
      say: '這一關叫推箱子。點小熊貓的上、下、左、右，它就會往那個方向走一格。把所有的箱子都推到綠色的圓圈上，就過關啦。箱子只能推、不能拉，要是不小心推錯了，就點右下角的重來，重新開始，沒關係的。',
      rules: [
        '電腦用方向鍵或 W A S D 移動；手機點小熊貓的上 / 下 / 左 / 右方向，一次走一格',
        '把所有箱子推到綠色圓圈上',
        '箱子只能推不能拉；推錯了可以點右下角「重來」',
        '全部箱子都推到圓圈上即過關；一共 5 關',
      ],
    },
  }

  /* ---------------- 狀態 ---------------- */
  var rec = new Recorder()
  if (testMode) rec.log.mode = 'test' // 需求8：測試會話不上報正式訓練集（前端攔截 + 服務端二道防線）
  if (Number.isFinite(minutesQ)) rec.setBlockLimit(minutesQ)
  var step = 0          // 當前 FLOW 索引
  var phase = 'idle'    // idle | story | tutorial | playing | paused | finished
  var game = null       // 當前遊戲實例
  var gameName = ''
  var level = 1
  var levelStartMs = 0
  var lastFrameMs = 0
  var paused = false
  var uploadTimer = null

  /* ---------------- 畫布自適應 ---------------- */
  function fit() {
    var box = document.getElementById('gameStage')
    var aw = box.clientWidth, ah = box.clientHeight
    if (!aw || !ah) return
    var scale = Math.min(aw / W, ah / H)
    canvas.style.width = Math.round(W * scale) + 'px'
    canvas.style.height = Math.round(H * scale) + 'px'
  }
  /* D2：視口方向變化時必須重新對齊邏輯解析度（syncViewport），不能只做等比縮放——
   * 否則豎屏進關後旋轉到橫屏，邏輯解析度停在 600×994，畫布被壓成豎條。
   * 尺寸真的變了且正在遊戲中 → 重建當前關（startLevel(false)：保持 level、不播講解；
   * rec.reach 只取 max，冪等，重複調用無副作用）。 */
  function onViewportChange() {
    var changed = syncViewport()
    fit()
    if (changed && game && phase === 'playing') startLevel(false)
  }
  var resizeTimer = null
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(onViewportChange, 200) // 去抖 200ms
  })
  window.addEventListener('orientationchange', function () {
    setTimeout(onViewportChange, 260) // iOS 旋轉後尺寸才穩定
  })
  syncViewport()
  fit()
  /* D3：字體/布局未穩時 HUD 實測高度可能偏大（曾實測 72px，穩定後 42px），
   * 導致 stage 頂部多出深色橫帶。字體就緒與 400ms 後各補一次對齊（走
   * onViewportChange：尺寸變化且遊戲中會自動重建關卡），保證 stage 頂邊
   * 始終等於當前 HUD 實測高度 + 4。 */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(onViewportChange)
  }
  setTimeout(onViewportChange, 400)
  /* D1 配套：豎屏 HUD 允許換行，其高度隨內容變化（開局「準備中」一行 →
   * 進入關卡後「第 N 階段 · 遊戲名 + 第 N 關 + 水晶 + 計時」兩行，stage 可
   * 用高度隨之變化 ~20px）。用 ResizeObserver 監聽 HUD 高度並走
   * onViewportChange 全量重對齊——不只做 inset+fit：否則 stage 變矮後
   * 邏輯解析度不更新，畫布兩側會出現留邊（fill<1）。穩定性：重對齊/重建
   * 不改變 HUD 高度，syncViewport 尺寸沒變時返回 false 不重建，不會振蕩。 */
  var hudEl = document.querySelector('.hud')
  if (window.ResizeObserver && hudEl) {
    new ResizeObserver(onViewportChange).observe(hudEl)
  }

  /* ---------------- 熊貓陪伴（按真實世界時間觸發） ---------------- */
  var pandaEl = document.getElementById('panda')
  var PANDA_ACTS = ['stretch', 'yawn', 'blink', 'wave', 'nod']
  var nextPandaMs = Date.now() + 20000
  function pandaTick() {
    if (Date.now() >= nextPandaMs) {
      var act = PANDA_ACTS[Math.floor(Math.random() * PANDA_ACTS.length)]
      pandaEl.classList.remove('stretch', 'yawn', 'blink', 'wave', 'nod')
      // 強制重排以重啟動畫
      void pandaEl.offsetWidth
      pandaEl.classList.add(act)
      setTimeout(function () { pandaEl.classList.remove(act) }, 3200)
      nextPandaMs = Date.now() + 20000 + Math.floor(Math.random() * 6000)
    }
  }

  /* ---------------- HUD ---------------- */
  function updateHud() {
    var cur = FLOW[step]
    if (cur && cur.type === 'play') {
      var used = rec.blockSeconds(cur.stage) * 1000
      if (Number.isFinite(BLOCK_MS)) {
        var left = Math.max(0, BLOCK_MS - used)
        elTimer.textContent = fmtMMSS(left)
      } else {
        elTimer.textContent = '∞' // 測試模式無閘門：不顯示倒計時
      }
      elStageLabel.textContent = '第 ' + cur.stage + ' 階段 · ' + LPGames[cur.game].name
      elLevel.textContent = '第 ' + level + ' 關'
      elLevel.classList.remove('hidden')
    } else {
      elStageLabel.textContent = cur && cur.type === 'story' ? '故事時間' : '準備中'
      elLevel.classList.add('hidden')
      elTimer.textContent = '--:--'
    }
    var total = rec.log.Crystal.total
    for (var k = 0; k < dots.length; k++) {
      dots[k].classList.toggle('on', k < total)
    }
  }
  function fmtMMSS(ms) {
    var s = Math.ceil(ms / 1000)
    var m = Math.floor(s / 60)
    return m + ':' + String(s % 60).padStart(2, '0')
  }

  /* ---------------- 觸屏按鍵 ---------------- */
  function renderTouchButtons(buttons) {
    elTouch.innerHTML = ''
    buttons.forEach(function (b) {
      var btn = document.createElement('button')
      btn.className = 'tbtn' + (b.wide ? ' wide' : '')
      btn.textContent = b.label
      var fire = function (down) {
        return function (e) {
          e.preventDefault()
          if (game && game.key) game.key(b.key, down)
        }
      }
      btn.addEventListener('pointerdown', fire(true))
      btn.addEventListener('pointerup', fire(false))
      btn.addEventListener('pointerleave', fire(false))
      btn.addEventListener('pointercancel', fire(false))
      elTouch.appendChild(btn)
    })
  }

  /* ---------------- 鍵盤 ---------------- */
  window.addEventListener('keydown', function (e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault()
    if (game && phase === 'playing' && !paused) game.key(e.code, true)
  })
  window.addEventListener('keyup', function (e) {
    if (game && phase === 'playing') game.key(e.code, false)
  })

  /* ---------------- 指針 ---------------- */
  canvas.addEventListener('pointerup', function (e) {
    if (!game || phase !== 'playing' || paused) return
    var r = canvas.getBoundingClientRect()
    var x = (e.clientX - r.left) / r.width * W
    var y = (e.clientY - r.top) / r.height * H
    game.pointer(x, y)
  })

  /* ---------------- 切後臺：暫停且不計訓練時長 ---------------- */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      paused = true
      rec.openPause('hidden')
      elPause.classList.remove('hidden')
    } else {
      if (rec._openPause) rec.closePause()
      paused = false
      elPause.classList.add('hidden')
      lastFrameMs = performance.now() // 丟棄暫停期間的時間
    }
  })
  window.addEventListener('blur', function () {
    if (!paused) { paused = true; rec.openPause('hidden'); elPause.classList.remove('hidden') }
  })
  window.addEventListener('focus', function () {
    if (paused) {
      rec.closePause(); paused = false; elPause.classList.add('hidden')
      lastFrameMs = performance.now()
    }
  })

  /* ---------------- 教學講解（語音 + 文字，可跳過） ---------------- */
  function showTutorial(key, done) {
    var t = TUTORIALS[key]
    if (!t) { done(); return }
    rec.openRest('tutorial', FLOW[step].stage || 0)
    var stageNo = FLOW[step].stage || 1
    elTut.innerHTML =
      '<div class="tut-bg" style="background-image:url(' + t.bg + ')"></div>' +
      '<div class="tut-card">' +
      '<img class="tut-panda" src="' + t.img + '" alt="幸運熊貓">' +
      '<div class="tut-tag">第 ' + stageNo + ' 階段 · 玩法講解</div>' +
      '<h3>' + t.title + '</h3>' +
      '<ol class="rules">' + t.rules.map(function (r) { return '<li>' + r + '</li>' }).join('') + '</ol>' +
      '<div class="btn-row" style="justify-content:center">' +
      '<button class="btn btn-lg" id="tutStart">開始遊戲</button>' +
      '<button class="btn btn-ghost" id="tutReplay">再聽一遍</button>' +
      '</div>' +
      '</div>'
    elTut.classList.remove('hidden')
    phase = 'tutorial'

    /* 朗讀規則說明：優先預生成的 MP3 配音（minimax-h3 出品），失敗回退瀏覽器 TTS。
     * ⚠️ ok 有三種取值：true=播完 / false=真失敗（回退 TTS）/ null=被新朗讀頂掉。
     * null 時**不得**回退 TTS——否則「再聽一次」會變成新舊兩段語音疊著放。 */
    function speak() {
      var sp = window.Speech
      if (!sp) return
      var segs = typeof sp.segmentsFor === 'function' ? sp.segmentsFor('tutorial-' + key, null) : null
      if (segs && segs.length && typeof sp.speakAudio === 'function') {
        var started = sp.speakAudio(segs, function (ok) {
          if (ok === false && sp.speak) sp.speak(t.say)
        })
        if (started) return
      }
      if (sp.speak) sp.speak(t.say)
    }
    speak()

    function close() {
      if (window.Speech) window.Speech.cancel()
      rec.closeRest()
      elTut.classList.add('hidden')
      done()
    }
    document.getElementById('tutStart').addEventListener('click', close)
    document.getElementById('tutReplay').addEventListener('click', speak)
  }

  /* ---------------- 流程推進 ---------------- */
  function startStep() {
    var cur = FLOW[step]
    if (!cur) { finishSession(); return }

    if (cur.type === 'story') {
      phase = 'story'
      rec.openRest('story', cur.stage || 0)
      var ctxData = {
        crystal1: rec.log.Crystal.byStage[0] || 0,
        crystal2: rec.log.Crystal.byStage[1] || 0,
        crystalTotal: rec.log.Crystal.total || 0,
      }
      /* 含水晶顆數的旁白是「按顆數整句預生成」的變體文件（不在全量預載裡），
       * 故事開場前按真實顆數轉成本次需要的那一個 blob；失敗/超時無妨，
       * 播放側會自動回退在線拉流（文件僅 ~45KB） */
      var begin = function () {
        Story.play(elStory, cur.kind, ctxData, cur.ms, function (skipped) {
          rec.story(cur.kind, true, skipped)
          rec.closeRest()
          step++
          startStep()
        })
        updateHud()
      }
      var urls = storyVariantUrls(cur.kind, ctxData)
      if (window.LPPreload && urls.length) {
        window.LPPreload.blob(urls, { concurrency: 1, timeoutMs: 2500, retries: 0 }).then(begin, begin)
      } else {
        begin()
      }
      return
    }

    // 遊戲階段
    phase = 'tutorial'
    gameName = cur.game
    level = 1
    startLevel(true)
  }

  /* ---------------- 背景音樂 & 激勵音效（需求：輕快 BGM + 右上角開關 + 答對「叮」） ---------------- */

  /** 故事開場的「顆數整句變體」URL（這些不進全量預載，共 128 個/約 5MB，按需取本次那一個） */
  function storyVariantUrls(kind, ctxData) {
    var base = '/play/assets/audio/'
    if (kind === 'story1') return [base + 'story1-1-n' + (ctxData.crystal1 || 0) + '.mp3']
    if (kind === 'story2') return [base + 'story2-1-c' + (ctxData.crystal2 || 0) + 't' + (ctxData.crystalTotal || 0) + '.mp3']
    if (kind === 'ending') return [base + 'ending-1-n' + (ctxData.crystalTotal || 0) + '.mp3']
    return []
  }

  var BGM_URL = '/play/assets/audio/bgm-loop.mp3' // 《你在暮色中·兜圈》（管弦樂版），FLAC 轉 160k MP3
  var bgm = null
  var soundOff = false
  try { soundOff = localStorage.getItem('luckyPanda.soundOff') === '1' } catch (e) { soundOff = false }

  function bgmEl() {
    if (!bgm) {
      bgm = new Audio()
      bgm.loop = true           // 循環播放，直到完成全部遊戲
      bgm.volume = 0.22         // 輕音樂墊底，不蓋過旁白與講解
      var PL = window.LPPreload
      bgm.src = (PL && typeof PL.src === 'function') ? PL.src(BGM_URL) : BGM_URL
    }
    return bgm
  }
  function startBgm() {
    if (typeof Audio === 'undefined') return
    var a = bgmEl()
    a.muted = soundOff
    var p = null
    try { p = a.play() } catch (e) { p = null }
    if (p && p.catch) {
      p.catch(function () {
        // 極端環境（無任何手勢記錄）被攔：下一次觸控螢幕幕時再啟動
        document.addEventListener('pointerdown', function kick() { startBgm() }, { once: true })
      })
    }
  }
  function stopBgm() { if (bgm) { try { bgm.pause() } catch (e) { } } }
  function applySoundPref() {
    if (bgm) bgm.muted = soundOff
    if (window.LPSfx && typeof window.LPSfx.setOff === 'function') window.LPSfx.setOff(soundOff)
    var btn = document.getElementById('btnSound')
    if (btn) {
      btn.textContent = soundOff ? '🔇' : '🔊'
      btn.title = soundOff ? '打開音樂和音效' : '關閉音樂和音效'
    }
  }
  (function initSoundButton() {
    var btn = document.getElementById('btnSound')
    if (!btn) return
    btn.addEventListener('click', function () {
      soundOff = !soundOff
      try { localStorage.setItem('luckyPanda.soundOff', soundOff ? '1' : '0') } catch (e) { }
      applySoundPref()
      if (!soundOff) startBgm() // 打開聲音時若音樂還沒響，就勢啟動
    })
    applySoundPref()
  })()

  function startLevel(withTutorial) {
    var cur = FLOW[step]
    syncViewport() // 每關開局對齊一次邏輯解析度（豎屏/橫屏），保證新關卡按當前視口重排
    fit()
    var mk = LPGames[cur.game]
    var g = mk.create(level)
    var boot = function () {
      game = g
      levelStartMs = performance.now()
      rec.reach(cur.stage, level)
      renderTouchButtons(g.touchButtons || [])
      phase = 'playing'
      lastFrameMs = performance.now()
      updateHud()
    }
    if (withTutorial) showTutorial(cur.game, boot)
    else boot()
  }

  function onLevelWin() {
    var cur = FLOW[step]
    var secs = (performance.now() - levelStartMs) / 1000
    rec.passLevel(cur.stage, level, secs, null) // 水晶已去重；重複通過第 5 關由 recorder 打 repeat 標記（需求7）
    level++
    if (level > 5) level = 5 // 需求7：到頂不再 nextStep，循環打第 5 關（重複最高級）
    // 唯一階段結束條件：滿 6 分鐘（loop() 裡的 blockDone 檢查保留，允許關卡中途切段）
    if (rec.blockDone(cur.stage)) { nextStep(); return }
    game = null
    startLevel(false) // level 保持 5 → 重複第 5 關；每次進關重新洗牌/抽圖（需求3/5 聯動）
  }

  function nextStep() {
    game = null
    elTouch.innerHTML = ''
    step++
    startStep()
  }

  /* ---------------- 測試直達入口（需求8） ----------------
   * enterStage(stage, level, opts)：step 定位到 FLOW 中該 stage 的 play 下標，
   * level 夾到 1~5，跳過 story 步，直接 startLevel(opts.tutorial)。 */
  function enterStage(stageNo, levelNo, opts) {
    opts = opts || {}
    var idx = -1
    for (var i = 0; i < FLOW.length; i++) {
      if (FLOW[i].type === 'play' && FLOW[i].stage === Number(stageNo)) { idx = i; break }
    }
    if (idx < 0) return false
    step = idx
    gameName = FLOW[step].game
    level = Math.min(Math.max(Number(levelNo) || 1, 1), 5)
    game = null
    startLevel(!!opts.tutorial)
    return true
  }
  window.LPPlay = { enterStage: enterStage }

  function finishSession() {
    phase = 'finished'
    game = null
    elTouch.innerHTML = ''
    stopBgm() // 完成全部遊戲：背景音樂到此為止
    rec.finish()
    var c = rec.log.Crystal.total
    elFinish.innerHTML =
      '<img class="finish-panda" src="/play/assets/panda/panda-pose-celebrate.jpeg" alt="幸運熊貓慶祝">' +
      '<h2>謝謝參與！</h2>' +
      '<div class="crystal-big">' + c + ' / 15</div>' +
      '<div>你一共找回了 ' + c + ' 顆水晶</div>' +
      '<div class="muted" style="opacity:.8">第1段 ' + Math.round(rec.blockSeconds(1)) + 's · 第2段 ' + Math.round(rec.blockSeconds(2)) + 's · 第3段 ' + Math.round(rec.blockSeconds(3)) + 's</div>' +
      '<div class="btn-row" style="justify-content:center;margin-top:10px">' +
      '<button class="btn" id="btnBackHome">回到首頁</button>' +
      '</div>'
    elFinish.classList.remove('hidden')
    document.getElementById('btnBackHome').addEventListener('click', function () { location.href = '/#/home' })
    rec.upload(true)
    if (uploadTimer) clearInterval(uploadTimer)
  }

  /* ---------------- 主循環 ---------------- */
  function loop(nowMs) {
    requestAnimationFrame(loop)
    var dt = (nowMs - lastFrameMs) / 1000
    lastFrameMs = nowMs
    if (!Number.isFinite(dt) || dt <= 0) return
    if (dt > 0.25) dt = 0.25 // 長時間卡頓按 250ms 計，防止時間跳變

    pandaTick()

    if (phase === 'playing' && game && !paused) {
      var cur = FLOW[step]
      // 累加本階段訓練時長（真實時鐘）
      rec.tick(cur.stage, dt)
      game.update(dt)
      if (game.status === 'win') { onLevelWin(); return }
      // 6 分鐘到了自動切下一段
      if (rec.blockDone(cur.stage)) { nextStep(); return }
      updateHud()
      game.draw(ctx, W, H)
    } else if (phase === 'playing' && !game) {
      // 關卡切換瞬間
      ctx.fillStyle = '#16281f'; ctx.fillRect(0, 0, W, H)
    } else if (phase === 'story' || phase === 'tutorial' || phase === 'idle') {
      ctx.fillStyle = '#0b1512'; ctx.fillRect(0, 0, W, H)
    }
  }

  /* ---------------- 退出保護（testMode 豁免彈窗，便於 QA 逐關切換） ---------------- */
  window.addEventListener('pagehide', function () { rec.upload(false) })
  window.addEventListener('beforeunload', function (e) {
    if (phase !== 'finished' && !testMode) {
      rec.upload(false)
      e.preventDefault()
      e.returnValue = '訓練還沒有結束，確定要離開嗎？'
      return e.returnValue
    }
  })

  /* ---------------- 啟動 ---------------- */
  lastFrameMs = performance.now()
  requestAnimationFrame(loop)

  // 每 30 秒增量上報，崩潰/關頁面也不丟數據（服務端按 sessionStart 冪等；測試會話被 upload() 攔截）
  uploadTimer = setInterval(function () { rec.upload(false) }, 30000)

  // 需求8：測試模式不走 startStep()（跳過開場故事），直達指定階段關卡
  if (testMode) {
    var okStage = enterStage(qNum('stage') || 1, qNum('level') || 1, { tutorial: qs && qs.get('tutorial') === '1' })
    if (!okStage) enterStage(1, 1, {})
  } else {
    bootWithPreloadGate()
  }

  /* ---------------- 資源加載閘門 ----------------
   * 微信端弱網下在線拉流視頻「有時黑屏」：先把開場視頻 + 全部配音整段下載
   * 並轉成 blob:URL（story.js / speech.js 經 LPPreload.src 取用，播放零網絡）。
   *
   * 移動端必須留一次真實點擊（「開始冒險」按鈕）：iOS / 微信只允許被手勢激活過的
   * 媒體元素有聲播放，且手勢不跨頁面跳轉傳遞——從首頁跳進來時本頁沒有任何激活態。
   * 這一下點擊同時解鎖共享 Audio（Speech.unlock）與共享 Video（Story.unlockVideo），
   * 之後整頁的視頻/配音播放都不再被自動播放策略攔截。桌面端無此限制，直接放行。
   *
   * 閘門期間第二/三階段視頻已在後臺閒時排隊；60s 看門狗兜底，閘門絕不卡死流程。 */
  function bootWithPreloadGate() {
    var gate = document.getElementById('preloadGate')
    var PL = window.LPPreload
    if (!gate || !PL || typeof fetch !== 'function') { startStep(); return }

    var fill = document.getElementById('pgFill')
    var cnt = document.getElementById('pgCount')
    var go = document.getElementById('pgGo')
    var flowStarted = false
    var goShown = false

    function needGesture() {
      try { return /MicroMessenger|iPhone|iPad|iPod|Android|Mobile|HarmonyOS/i.test(navigator.userAgent) } catch (e) { return false }
    }
    function openGate() {
      if (flowStarted) return
      flowStarted = true
      gate.classList.add('hidden')
      PL.idle(PL.VIDEOS_LATER) // 後兩階段：遊玩過程中後臺持續加載
      startBgm()               // 背景音樂從這裡開始（桌面端：此前的頁面交互已足以放行自動播放）
      startStep()
    }
    function showGo(hint) {
      if (flowStarted) return
      if (cnt) cnt.textContent = hint || '森林準備好了！點一下開始冒險'
      if (!go) { openGate(); return } // 找不到按鈕也別卡死
      if (goShown) return
      goShown = true
      go.classList.remove('hidden')
      go.addEventListener('click', function () {
        // 手勢窗口內完成兩個共享媒體元素的解鎖
        if (window.Speech && typeof window.Speech.unlock === 'function') window.Speech.unlock()
        if (window.Story && typeof window.Story.unlockVideo === 'function') window.Story.unlockVideo()
        if (window.LPSfx && typeof window.LPSfx.unlock === 'function') window.LPSfx.unlock()
        startBgm() // 手勢窗口內啟動背景音樂（移動端只有在這裡啟動才不會被攔）
        openGate()
      }, { once: true })
    }
    function loaded() {
      if (needGesture()) showGo()
      else openGate()
    }
    // 終極兜底：網絡全掛也不能把孩子擋在門外（移動端轉為可點的開始按鈕）
    setTimeout(function () {
      if (needGesture()) showGo('資源加載較慢，也可以直接開始')
      else openGate()
    }, 60000)

    PL.audioUrls().then(function (audio) {
      return PL.blob(audio.concat(PL.VIDEOS_INTRO, [BGM_URL]), {
        concurrency: 2,
        timeoutMs: 25000,
        retries: 1,
        onProgress: function (done, total) {
          if (fill) fill.style.width = Math.round((done / total) * 100) + '%'
          if (cnt) cnt.textContent = '資源 ' + done + ' / ' + total
        },
      })
    }).catch(function () { /* 靜默：加載失敗走原有在線拉流兜底 */ }).then(loaded)
  }
})()
