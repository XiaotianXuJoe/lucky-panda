/* 幸運熊貓 · 中文朗讀（TTS）共用小工具
 *
 * 教學講解與故事旁白共用同一套「音色優選」邏輯，避免兩處各寫一遍。
 * 瀏覽器不支持語音合成時靜默降級：speak() 返回 false，調用方自己用定時器接管節奏。
 */
(function (global) {
  'use strict'

  var VOICE = null

  /** 優選自然中文音色（Windows/Edge 的 小曉 等神經網絡音色排在前面） */
  function pickVoice() {
    try {
      if (!global.speechSynthesis) return null
      var vs = global.speechSynthesis.getVoices() || []
      var zh = vs.filter(function (v) { return /^zh\b|Chinese|Mandarin/i.test(v.lang + ' ' + v.name) })
      if (!zh.length) return null
      var prefer = [
        /xiaoxiao/i, /yunxia/i, /xiaoyi/i, /yunyang/i, /yunxi/i, /xiaoqi/i,
        /natural/i, /neural/i, /online/i, /xiaohan/i, /yunjian/i,
        /huihui/i, /tingting/i, /meijia/i, /yaoyao/i, /lili/i, /sichuan/i,
      ]
      for (var i = 0; i < prefer.length; i++) {
        for (var j = 0; j < zh.length; j++) if (prefer[i].test(zh[j].name)) return zh[j]
      }
      return zh[0]
    } catch (e) { return null }
  }

  if (global.speechSynthesis) {
    VOICE = pickVoice()
    try {
      // 部分瀏覽器首次 getVoices() 為空，等音色列表就緒後再補一次
      global.speechSynthesis.onvoiceschanged = function () { VOICE = VOICE || pickVoice() }
    } catch (e) { /* ignore */ }
  }

  function available() {
    return !!(global.speechSynthesis && typeof global.SpeechSynthesisUtterance === 'function')
  }

  function cancel() {
    SEQ++ // 讓所有在飛的配音鏈作廢（變量定義在文件後半，此處運行時必然已初始化）
    try { if (SHARED) SHARED.pause() } catch (e) { /* ignore */ } // 停掉正在播的 MP3 配音
    try { if (global.speechSynthesis) global.speechSynthesis.cancel() } catch (e) { /* ignore */ }
  }

  /**
   * 朗讀一段中文。
   * @returns {boolean} true = 已交給語音引擎（朗讀結束後回調 opts.done）；false = 環境不支持，調用方自行降級
   * @param {string} text
   * @param {{minMs?:number, rate?:number, pitch?:number, done?:function}} [opts]
   *        minMs 最短停留時間：讀得再快也不馬上切下一句，給孩子反應時間
   */
  function speak(text, opts) {
    opts = opts || {}
    var minMs = opts.minMs == null ? 1200 : opts.minMs
    var done = opts.done
    var fired = false
    var t0 = Date.now()

    function fire() {
      if (fired) return
      fired = true
      if (!done) return
      var wait = Math.max(0, minMs - (Date.now() - t0)) + 350
      setTimeout(done, wait)
    }

    if (!available()) return false
    try {
      cancel() // 上一句沒讀完就先掐掉，避免疊音
      var u = new global.SpeechSynthesisUtterance(text)
      u.lang = 'zh-CN'
      if (VOICE) u.voice = VOICE
      u.rate = opts.rate == null ? 0.98 : opts.rate
      u.pitch = opts.pitch == null ? 1.08 : opts.pitch
      u.volume = 1
      u.onend = fire
      u.onerror = fire
      global.speechSynthesis.speak(u)
      // 兜底：個別瀏覽器/長文本不觸發 onend，按字數估時強制收尾（正常路徑下 fire 已被 fired 擋住）
      setTimeout(fire, 1500 + String(text).length * 260)
      return true
    } catch (e) {
      return false
    }
  }

  global.Speech = { speak: speak, cancel: cancel, available: available, pickVoice: pickVoice }

  /* ---------------- 預生成配音（minimax-h3 生成，見 gen_narration.py） ----------------
   * 平臺沒有 TTS，但 minimax-h3 生成的視頻帶原生音頻，抽成 MP3 後音色比瀏覽器 TTS 好。
   * 前端優先播 MP3；文件不存在 / 加載失敗 → 自動回退瀏覽器 TTS。
   *
   * 移動端自動播放策略的兩條硬約束（iOS / 微信 X5 實測）：
   *   1) play() 只能在「用戶手勢」裡解鎖媒體元素；手勢不跨頁面跳轉傳遞
   *   2) 已解鎖的元素本頁內後續 play() 都放行 → 所以全程復用同一個 Audio 元素（SHARED），
   *      由調用方在第一次點擊（加載閘門的「開始冒險」按鈕）裡調 unlock() 完成解鎖
   *
   * 取消語義（修「再聽一次」疊音）：
   *   SEQ 是全局朗讀令牌：speakAudio/unlock/cancel 任意一個啟動都會 ++SEQ，
   *   舊鏈的所有回調在兌現時發現 mySeq !== SEQ → 以 done(null) 靜默作廢，
   *   調用方只對 done(false) 回退 TTS，done(null) 什麼都不做（否則新配音 + 舊回退 TTS 疊音）。 */
  var AUDIO_BASE = '/play/assets/audio/'
  var LINES_MAP = null
  var LINES_PROMISE = null
  var MISSING = {} // 已知不存在的段，避免每次重複請求
  var SHARED = null // 全局唯一 Audio 元素：一次手勢解鎖，全程復用
  var SEQ = 0      // 朗讀令牌：新請求/取消時遞增，舊鏈回調一律作廢

  function sharedAudio() {
    if (!SHARED && typeof Audio !== 'undefined') {
      SHARED = new Audio()
      SHARED.preload = 'auto'
    }
    return SHARED
  }

  /** 在用戶手勢裡解鎖共享 Audio 元素（靜音播一小段；失敗無妨，播放側還有兜底）
   *  ⚠️ 歸位（pause/取消靜音）必須檢查 SEQ：如果 300ms 內旁白已經接管同一元素，
   *  就絕不能再 pause——否則故事第一句旁白被靜默掐停（線上實測：intro-1 無聲，
   *  後續句正常；與視頻 _lpPark 同家族的時序競態）。 */
  function unlock() {
    var a = sharedAudio()
    if (!a) return
    var mySeq = ++SEQ
    try {
      a.onerror = a.onended = a.onplaying = null
      var PL = global.LPPreload
      var url = AUDIO_BASE + 'num-0.mp3'
      a.muted = true
      a.src = (PL && typeof PL.src === 'function') ? PL.src(url) : url
      var p = a.play()
      var restore = function () {
        if (SEQ === mySeq) { // 令牌沒變 = 旁白還沒接管，才允許歸位
          try { a.pause() } catch (e) { }
        }
        a.muted = false
      }
      if (p && p.then) p.then(function () { setTimeout(restore, 300) }, restore)
      else setTimeout(restore, 300)
    } catch (e) {
      try { a.muted = false } catch (e2) { }
    }
  }

  function loadLinesMap() {
    if (LINES_PROMISE) return LINES_PROMISE
    LINES_PROMISE = (typeof fetch === 'function'
      ? fetch(AUDIO_BASE + 'lines.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null })
        .catch(function () { return null })
      : Promise.resolve(null)
    ).then(function (d) { LINES_MAP = d || {}; return LINES_MAP })
    return LINES_PROMISE
  }
  loadLinesMap() // 頁面加載就開始拉，故事開場時通常已就緒

  /** 某句臺詞的音頻段列表。
   *  映射表值有兩種形態（lines.json）：
   *   - 數組：按順序連播的段 id 列表
   *   - 字符串：含 {c1}/{c2}/{total} 佔位符的整句 id 模板（水晶顆數句已是整句預生成，
   *     不再三段拼接——舊方案在「了/數字/顆」接縫處有明顯卡頓）
   *  沒有映射表或該句無條目時返回 null。 */
  function segmentsFor(lineKey, ctx) {
    if (!LINES_MAP) return null
    var list = LINES_MAP[lineKey]
    if (!list) return null
    if (typeof list === 'string') list = [list]
    if (!list.length) return null
    ctx = ctx || {}
    var c1 = ctx.c1 == null ? 0 : ctx.c1
    var c2 = ctx.c2 == null ? 0 : ctx.c2
    var total = ctx.total == null ? 0 : ctx.total
    return list.map(function (s) {
      return String(s)
        .split('{c1}').join(c1)
        .split('{c2}').join(c2)
        .split('{total}').join(total)
    })
  }

  /** 播放一段 MP3 配音（復用 SHARED 元素）。done(ok)：true=播完 / false=失敗走 TTS / null=被頂掉作廢 */
  function playClip(id, done, seq) {
    if (!id || MISSING[id] || typeof Audio === 'undefined') { if (done) done(false); return false }
    var a = sharedAudio()
    if (!a) { if (done) done(false); return false }
    var mySeq = seq == null ? SEQ : seq
    var PL = global.LPPreload
    var url = AUDIO_BASE + id + '.mp3'
    var settled = false
    var timer = null
    var finish = function (ok, blacklist) {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      a.onerror = a.onended = a.onplaying = null
      if (mySeq !== SEQ) { if (done) done(null); return } // 已被新朗讀/取消頂掉：靜默作廢，不回退 TTS
      if (!ok && blacklist !== false) MISSING[id] = true
      if (done) done(ok)
    }
    try {
      a.onerror = a.onended = a.onplaying = null
      a.pause()              // 同一元素：換源前先停掉上一段（根治「兩段語音同時播」）
      a.muted = false
      a.src = (PL && typeof PL.src === 'function') ? PL.src(url) : url
      a.onerror = function () { finish(false) }
      a.onended = function () { finish(true) }
      a.onplaying = function () {
        if (timer) clearTimeout(timer)
        timer = setTimeout(function () { finish(true) }, (Number(a.duration) || 4) * 1000 + 3000)
      }
      // 4s 內沒播起來 → 認為這段不可用（文件不存在 / 網絡問題）
      timer = setTimeout(function () { finish(false) }, 4000)
      // ⚠️ 必須顯式 play()：只 load 不播，事件永不觸發 → 4s 超時誤判為「文件缺失」，
      // 整句回退瀏覽器 TTS（線上實測症狀：聲音永遠是舊版）
      var pr = a.play()
      if (pr && typeof pr.catch === 'function') {
        pr.catch(function (err) {
          var msg = String(err && (err.name || err.message) || '')
          var policyBlock = /NotAllowed/i.test(msg)
          // 策略攔截：本句失敗但不拉黑；用戶點過頁面後後續段落照常播
          finish(false, !policyBlock)
        })
      }
    } catch (e) {
      finish(false)
    }
    return true
  }

  /** 按順序播放一段臺詞的配音；任一段真的失敗 → done(false)（調用方回退 TTS）。
   *  被新的朗讀請求頂掉 → done(null)，調用方**不得**回退 TTS。 */
  function speakAudio(ids, done) {
    if (!ids || !ids.length || typeof Audio === 'undefined') { if (done) done(false); return false }
    var mySeq = ++SEQ // 新請求：舊鏈全部作廢
    try { if (SHARED) SHARED.pause() } catch (e) { } // 立即掐掉正在播的上一段
    var i = 0
    var next = function () {
      if (mySeq !== SEQ) { if (done) done(null); return }
      if (i >= ids.length) { if (done) done(true); return }
      var id = ids[i++]
      if (MISSING[id]) { if (done) done(false); return }
      playClip(id, function (ok) {
        if (ok === true) next()
        else if (ok === false) { if (done) done(false) }
        else { if (done) done(null) }
      }, mySeq)
    }
    next()
    return true
  }

  global.Speech.segmentsFor = segmentsFor
  global.Speech.speakAudio = speakAudio
  global.Speech.playClip = playClip
  global.Speech.unlock = unlock
  global.Speech.loadLinesMap = loadLinesMap
  global.Speech._setLinesMap = function (m) { LINES_MAP = m || {} } // 供測試注入映射表
})(window)
