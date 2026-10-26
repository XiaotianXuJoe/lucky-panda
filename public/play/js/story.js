/* 幸運熊貓 · 故事動畫播放器
 * 全部畫面用程序化 SVG 繪製，不依賴任何外部美術素材。
 * 「黑白森林」用 CSS filter: grayscale 實現，找回水晶後逐步恢復色彩。
 */
(function (global) {
  'use strict'

  /* ---------------- 場景繪製 ---------------- */

  function trees(x, y, n, color) {
    var out = ''
    for (var i = 0; i < n; i++) {
      var tx = x + i * 62 + (i % 2) * 12
      var h = 70 + ((i * 37) % 30)
      var leaf = color ? '#3f9a5f' : '#8a8a8a'
      var trunk = color ? '#7a5230' : '#666'
      out += '<g transform="translate(' + tx + ',' + y + ')">' +
        '<rect x="-5" y="' + (-h * 0.35) + '" width="10" height="' + (h * 0.4) + '" fill="' + trunk + '"/>' +
        '<circle cx="0" cy="' + (-h * 0.5) + '" r="' + (h * 0.3) + '" fill="' + leaf + '"/>' +
        '<circle cx="-14" cy="' + (-h * 0.38) + '" r="' + (h * 0.22) + '" fill="' + leaf + '"/>' +
        '<circle cx="14" cy="' + (-h * 0.38) + '" r="' + (h * 0.22) + '" fill="' + leaf + '"/>' +
        '</g>'
    }
    return out
  }

  function flowers(x, y, n, color) {
    var out = ''
    var petal = color ? ['#ef7ba0', '#f5c34b', '#b98ce0', '#7fc8e8'] : ['#999', '#999', '#999', '#999']
    for (var i = 0; i < n; i++) {
      var fx = x + i * 34 + (i % 3) * 8
      var fy = y + ((i * 23) % 18)
      var c = petal[i % 4]
      out += '<g transform="translate(' + fx + ',' + fy + ')">' +
        '<rect x="-1.5" y="0" width="3" height="14" fill="' + (color ? '#4f8f5a' : '#777') + '"/>' +
        '<circle cx="0" cy="-4" r="4.5" fill="' + c + '"/>' +
        '<circle cx="-6" cy="0" r="4.5" fill="' + c + '"/>' +
        '<circle cx="6" cy="0" r="4.5" fill="' + c + '"/>' +
        '<circle cx="0" cy="4" r="4.5" fill="' + c + '"/>' +
        '<circle cx="0" cy="0" r="3" fill="' + (color ? '#ffe08a' : '#bbb') + '"/>' +
        '</g>'
    }
    return out
  }

  function crystal(x, y, s, color) {
    var c = color ? '#2bb3d4' : '#9aa0a2'
    var c2 = color ? '#7fe0f2' : '#c7cccd'
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">' +
      '<polygon points="0,-16 11,-4 7,13 -7,13 -11,-4" fill="' + c + '"/>' +
      '<polygon points="0,-16 7,-4 4,13 -7,13 -11,-4" fill="' + c2 + '" opacity=".85"/>' +
      '<polygon points="0,-16 3,-6 0,13 -4,-6" fill="#ffffff" opacity=".55"/>' +
      '</g>'
  }

  function panda(x, y, s) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">' +
      '<ellipse cx="0" cy="34" rx="30" ry="10" fill="rgba(0,0,0,.18)"/>' +
      '<circle cx="-15" cy="-16" r="9" fill="#2c2c2c"/><circle cx="15" cy="-16" r="9" fill="#2c2c2c"/>' +
      '<circle cx="0" cy="0" r="26" fill="#fdfdfd"/>' +
      '<circle cx="-14" cy="-9" r="10" fill="#2c2c2c"/><circle cx="14" cy="-9" r="10" fill="#2c2c2c"/>' +
      '<circle cx="-14" cy="-9" r="4.5" fill="#fff"/><circle cx="14" cy="-9" r="4.5" fill="#fff"/>' +
      '<circle cx="-13" cy="-8" r="2.2" fill="#1a1a1a"/><circle cx="15" cy="-8" r="2.2" fill="#1a1a1a"/>' +
      '<ellipse cx="0" cy="10" rx="9" ry="7" fill="#fff"/>' +
      '<ellipse cx="0" cy="7" rx="4" ry="3" fill="#1a1a1a"/>' +
      '<path d="M-4 13 Q0 17 4 13" stroke="#1a1a1a" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
      '</g>'
  }

  function wizard(x, y, s) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">' +
      '<ellipse cx="0" cy="40" rx="24" ry="8" fill="rgba(0,0,0,.2)"/>' +
      '<path d="M0 -34 L16 34 L-16 34 Z" fill="#4b3a72"/>' +
      '<path d="M-14 -22 L14 -22 L10 -30 L-10 -30 Z" fill="#5d4a8a"/>' +
      '<circle cx="0" cy="-40" r="12" fill="#f0c9a8"/>' +
      '<path d="M-13 -46 Q0 -62 13 -46 Z" fill="#3b2f5e"/>' +
      '<circle cx="-5" cy="-40" r="2" fill="#222"/><circle cx="5" cy="-40" r="2" fill="#222"/>' +
      '<path d="M-5 -33 Q0 -30 5 -33" stroke="#222" stroke-width="1.5" fill="none"/>' +
      '<rect x="16" y="-24" width="3" height="52" rx="1.5" fill="#6b4f2a"/>' +
      '<circle cx="17.5" cy="-28" r="6" fill="#b98ce0" opacity=".9"/>' +
      '</g>'
  }

  /** 生成一個場景的 SVG 字符串 */
  function sceneSVG(opts) {
    var color = !!opts.color
    var place = opts.place || 'forest'
    var sky1 = color ? '#bfe6f7' : '#d8dadb'
    var sky2 = color ? '#eaf7e6' : '#ececec'
    var ground = color ? '#6fb85f' : '#a3a5a6'
    var ground2 = color ? '#4f9440' : '#8d8f90'
    var g = ''

    g += '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + sky1 + '"/><stop offset="100%" stop-color="' + sky2 + '"/></linearGradient></defs>'
    g += '<rect x="0" y="0" width="560" height="300" fill="url(#sky)"/>'

    if (place === 'cave') {
      g += '<path d="M0 0 L560 0 L560 300 L0 300 Z" fill="#2b2f38"/>'
      g += '<path d="M60 300 Q100 90 280 80 Q460 90 500 300 Z" fill="#151a22"/>'
      g += '<path d="M150 300 Q170 150 280 140 Q390 150 410 300 Z" fill="#0d1116"/>'
      if (color) {
        g += crystal(280, 190, 1.1, true) + crystal(220, 215, 0.8, true) + crystal(345, 210, 0.75, true)
      }
      g += '<path d="M240 120 Q280 96 320 120" stroke="#5a5f6b" stroke-width="6" fill="none" stroke-linecap="round"/>'
      for (var i = 0; i < 5; i++) {
        g += '<path d="M' + (190 + i * 45) + ' 128 L' + (196 + i * 45) + ' 152 L' + (184 + i * 45) + ' 152 Z" fill="#7c8290"/>'
      }
    } else {
      // 天空：太陽 / 雲
      if (color) {
        g += '<circle cx="480" cy="58" r="26" fill="#ffd766"/>'
      } else {
        g += '<circle cx="480" cy="58" r="24" fill="#c9cbcc"/>'
      }
      g += '<ellipse cx="110" cy="62" rx="34" ry="16" fill="' + (color ? '#ffffff' : '#dcdcdc') + '" opacity=".9"/>'
      g += '<ellipse cx="140" cy="56" rx="24" ry="13" fill="' + (color ? '#ffffff' : '#dcdcdc') + '" opacity=".9"/>'
      g += '<ellipse cx="330" cy="44" rx="28" ry="13" fill="' + (color ? '#ffffff' : '#dcdcdc') + '" opacity=".7"/>'

      // 遠山
      g += '<path d="M0 190 L110 110 L200 190 Z" fill="' + (color ? '#8fb98a' : '#b0b2b3') + '"/>'
      g += '<path d="M160 190 L290 96 L420 190 Z" fill="' + (color ? '#7fae7c' : '#a6a8a9') + '"/>'
      g += '<path d="M360 190 L470 118 L560 190 Z" fill="' + (color ? '#8fb98a' : '#b0b2b3') + '"/>'

      // 地面
      g += '<rect x="0" y="190" width="560" height="110" fill="' + ground + '"/>'
      g += '<path d="M0 210 Q140 186 280 208 Q420 230 560 202 L560 300 L0 300 Z" fill="' + ground2 + '"/>'

      g += trees(40, 200, 4, color)
      g += trees(340, 205, 3, color)
      if (place === 'flowers') {
        g += flowers(70, 250, 8, color)
        g += flowers(330, 262, 6, color)
        if (color) {
          for (var b = 0; b < 3; b++) {
            g += '<g transform="translate(' + (150 + b * 60) + ',240)"><circle cx="0" cy="0" r="7" fill="#f5c34b"/>' +
              '<circle cx="-9" cy="-5" r="5" fill="#f5c34b"/><circle cx="9" cy="-5" r="5" fill="#f5c34b"/>' +
              '<circle cx="0" cy="-3" r="3" fill="#3a2f1a"/></g>'
          }
        }
      }
    }

    if (opts.wizard) g += wizard(470, 250, 1)
    g += panda(110, 244, 1.05)
    if (opts.crystals) {
      for (var k = 0; k < opts.crystals; k++) {
        g += crystal(250 + k * 32, 150 - (k % 3) * 16, 0.9, true)
      }
    }
    return '<svg class="story-art" viewBox="0 0 560 300" xmlns="http://www.w3.org/2000/svg">' + g + '</svg>'
  }

  /* ---------------- 劇本 ---------------- */

  /* AI 視頻片段（gen-assets/video → public/play/assets/video）。
   * 整個故事只用視頻呈現（不再有 SVG 畫面）：
   * list[i] 對應臺詞第 i 句的畫面，逐句切換；每句只播 1 遍，絕不重播。 */
  var CLIP_BASE = '/play/assets/video/'
  /* 播放源選擇：預加載器裡已有整段字節就用 blob:URL（微信端零網絡播放，弱網不再黑屏），
   * 否則回退原始路徑在線拉流（舊行為兜底）。LPPreload 不在時等價於不變。 */
  function mediaSrc(url) {
    var PL = window.LPPreload
    return PL && typeof PL.src === 'function' ? PL.src(url) : url
  }

  /* ---------------- 全局共享視頻元素 ----------------
   * iOS / 微信 X5 的硬約束：只有「被用戶手勢激活過」的媒體元素才能有聲播放，
   * 而手勢不跨頁面跳轉傳遞、也不傳給新建的 <video>。所以整頁復用同一個元素：
   * 加載閘門「開始冒險」按鈕的手勢裡 unlockVideo() 激活它，之後每段故事都復用，
   * 6 分鐘後轉場故事不會再變啞巴（否則新建元素又被自動播放策略攔下）。 */
  var SHARED_VID = null
  var VID_STATE = null // 當前進行中的故事掛在共享元素上的回調狀態（見 play()）

  function ensureVid() {
    if (SHARED_VID) return SHARED_VID
    if (typeof document === 'undefined' || !document.createElement) return null
    var v = document.createElement('video')
    v.className = 'story-video'
    v.setAttribute('playsinline', '')
    v.setAttribute('webkit-playsinline', '')
    v.setAttribute('x5-playsinline', '')
    v.preload = 'auto'
    SHARED_VID = v
    return v
  }

  function vidOnShow() { if (VID_STATE && VID_STATE.show) VID_STATE.show() }
  function vidOnEnded() {
    var s = VID_STATE
    if (!s || s.isFinished() || s.endedLine() !== s.lineIdx()) return
    if (!s.lineNarrated()) s.advance()
  }
  function vidOnError() {
    var s = VID_STATE
    if (!s) return
    s.markDead()
    if (SHARED_VID && SHARED_VID.parentNode) SHARED_VID.parentNode.removeChild(SHARED_VID)
    s.hideLoading()
  }

  /** 在用戶手勢裡解鎖共享視頻元素：有聲播一小段開場片段。
   *  調用時機：加載閘門「開始冒險」按鈕的 click（手勢窗口內）。失敗無妨，播放側還有靜音重試兜底。
   *  ⚠️ 250ms 後的「暫停歸位」定時器必須可被故事接管（_lpTaken）取消：
   *  故事開場緊接著就會復用同一元素播放同一個片段——如果定時器照跑，會把
   *  故事第一段掐停（線上實測：第一段有畫面（首幀）但沒音頻，其餘段正常）。 */
  function unlockVideo() {
    var v = ensureVid()
    if (!v || v._lpUnlocked || typeof v.play !== 'function' || !document.body) return
    v._lpUnlocked = true
    v._lpTaken = false // 新一次解鎖：故事還沒接管
    try {
      v.classList.remove('on')
      v.muted = false
      v.src = mediaSrc(CLIP_BASE + videosFor('intro').list[0])
      v.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;'
      document.body.appendChild(v)
      var p = v.play()
      var park = function () { if (v._lpTaken) return; try { v.pause() } catch (e) { } }
      if (p && p.then) p.then(function () { v._lpPark = setTimeout(park, 250) }, park)
      else v._lpPark = setTimeout(park, 250)
    } catch (e) { /* ignore */ }
  }
  /* 故事臺詞是否朗讀（瀏覽器 TTS 中文旁白）。
   * 小孩子識字慢，光看字幕跟不上；若研究條件要求統一靜音，把這裡改成 false 即可。
   * 旁白是翻頁的唯一節拍：旁白念完就切下一句（畫面沒播完也切）；
   * 旁白還沒念完而畫面已播完 → 畫面停在最後一幀等旁白。 */
  var NARRATE = true
  /* 拿不到視頻元數據時的兜底片段時長（現有 AI 片段都是 5s 左右） */
  var CLIP_SEC_FALLBACK = 5.1
  var PREFETCHED = {}
  /** 預取片段到瀏覽器緩存（隱藏 video 元素；assets 為 immutable 長緩存，切鏡頭時直接命中） */
  function prefetchClip(name) {
    if (!name || PREFETCHED[name] || typeof document === 'undefined' || !document.createElement) return
    PREFETCHED[name] = true
    try {
      var pv = document.createElement('video')
      pv.preload = 'auto'
      pv.muted = true
      pv.setAttribute('aria-hidden', 'true')
      pv.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;'
      pv.src = CLIP_BASE + name
      document.body.appendChild(pv)
      var kill = function () { if (pv.parentNode) pv.parentNode.removeChild(pv) }
      // 緩衝完再摘掉元素，確保 HTTP 緩存裡留下完整分片；20s 兜底防止元素常駐
      pv.addEventListener('canplaythrough', function () { setTimeout(kill, 800) })
      setTimeout(kill, 20000)
      pv.load()
    } catch (e) { /* 預取失敗不影響播放 */ }
  }
  function videosFor(kind) {
    if (kind === 'intro') return { list: ['clip01a-forest-wide.mp4', 'clip01b-animals-crystals.mp4', 'clip01c-wizard-appears.mp4', 'clip02-intro-gray.mp4', 'clip01e-panda-asks.mp4'] }
    if (kind === 'story1') return { list: ['clip03-story1-heal.mp4', 'clip03-story1-heal.mp4', 'clip03b-wizard-cave.mp4', 'clip03b-wizard-cave.mp4'] }
    if (kind === 'story2') return { list: ['clip04-story2-cave.mp4', 'clip04-story2-cave.mp4', 'clip04b-wizard-flowers.mp4', 'clip04b-wizard-flowers.mp4'] }
    if (kind === 'ending') return { list: ['clip05a-forest-fullcolor.mp4', 'clip05a-forest-fullcolor.mp4', 'clip05b-animals-return.mp4', 'clip05-ending-celebrate.mp4'] }
    return null
  }

  function script(kind, ctx) {
    var c1 = ctx.crystal1 || 0
    var c2 = ctx.crystal2 || 0
    var total = ctx.crystalTotal || 0
    if (kind === 'intro') {
      return {
        place: 'forest', color: false, wizard: true,
        lines: [
          '在很遠很遠的地方，有一片美麗的森林。',
          '森林裡住著許多小動物，還有閃閃發光的水晶。',
          '有一天，壞巫師出現了！',
          '他把所有的水晶都偷走了，森林變成了黑白色……',
          '小熊貓需要你的幫忙，一起把水晶找回來吧！',
        ],
      }
    }
    if (kind === 'story1') {
      return {
        place: 'forest', color: true, wizard: false,
        lines: [
          '太棒了！你找回了 ' + c1 + ' 顆水晶。',
          '森林的一角，重新有了顏色。',
          '壞巫師逃進了黑漆漆的山洞……',
          '我們追上去！',
        ],
      }
    }
    if (kind === 'story2') {
      return {
        place: 'cave', color: true, wizard: false,
        lines: [
          '又找回了 ' + c2 + ' 顆水晶，一共 ' + total + ' 顆！',
          '山洞裡的水晶也被你找回來了。',
          '壞巫師逃到了遠處的花叢裡。',
          '繼續前進！',
        ],
      }
    }
    return {
      place: 'flowers', color: true, wizard: false, crystals: 5,
      lines: [
        '水晶全部找回來了，一共 ' + total + ' 顆！',
        '壞巫師被打敗了，森林恢復了色彩！',
        '小動物們都回來啦，它們一起說：謝謝你！',
        '謝謝參與！',
      ],
    }
  }

  /* ---------------- 播放器 ---------------- */

  /**
   * @param {HTMLElement} layer  .story-layer 容器
   * @param {string} kind  intro | story1 | story2 | ending
   * @param {object} ctx   { crystal1, crystal2, crystalTotal }
   * @param {number} totalMs  該段動畫總時長（到時自動結束）
   * @param {function} done  (skipped) => void
   */
  function play(layer, kind, ctx, totalMs, done) {
    var sc = script(kind, ctx)
    var vcfg = videosFor(kind)
    var videoTag = ''
    if (vcfg) {
      // 不加 loop 屬性：每句只播一遍，翻頁由旁白驅動（需要 ended 事件）
      // playsinline + webkit-playsinline + x5-playsinline：iOS 與微信（X5 內核）內聯播放三件套
      // ⚠️ 首段用 src 屬性而不是 <source> 子標籤：<source> + blob:URL 在 X5 內核裡不觸發加載（黑屏根因之一）
      videoTag = '<video class="story-video" playsinline webkit-playsinline x5-playsinline preload="auto" src="' + mediaSrc(CLIP_BASE + vcfg.list[0]) + '"></video>'
    }
    layer.innerHTML =
      '<div class="story-art-box">' +
      '<div class="story-loading"><div class="story-spin"></div></div>' +
      videoTag +
      '</div>' +
      '<div class="story-text"></div>' +
      '<button class="story-skip">跳過動畫 ▶▶</button>'
    var textEl = layer.querySelector('.story-text')
    var btn = layer.querySelector('.story-skip')
    var loadingEl = layer.querySelector ? layer.querySelector('.story-loading') : null
    layer.classList.remove('hidden')

    /* 視頻：加載中顯示旋轉指示；就緒後淡入；出錯則移除，保持深色畫面（不再出現 SVG） */
    var vid = layer.querySelector ? layer.querySelector('video.story-video') : null
    /* 優先復用全局共享元素（它已被手勢解鎖→有聲播放）；替換掉剛插入的佔位元素。
     * 測試樁 / 殘缺 DOM（createElement 出來的對象沒有 play）→ 退回佔位元素逐次綁定。 */
    var usingShared = false
    if (vcfg && vid && layer.querySelector) {
      var shared = ensureVid()
      var artBox = layer.querySelector('.story-art-box')
      if (shared && typeof shared.play === 'function' && artBox && artBox.appendChild) {
        if (vid.parentNode) vid.parentNode.removeChild(vid)
        if (shared.parentNode) shared.parentNode.removeChild(shared)
        shared.style.cssText = ''      // 清掉 unlockVideo 時臨時藏起的內聯樣式
        shared.classList.remove('on')
        shared.muted = false           // 每段故事開始時恢復有聲
        if (shared._lpPark) { try { clearTimeout(shared._lpPark) } catch (e) { } shared._lpPark = null }
        shared._lpTaken = true         // 接管解鎖播放：手勢授權延續到故事第一段（勿讓 park 停表掐掉它）
        artBox.appendChild(shared)
        vid = shared
        usingShared = true
        vid.src = mediaSrc(CLIP_BASE + vcfg.list[0])
        try { vid.currentTime = 0 } catch (e) { }
      }
    }
    var hasVid = !!(vid && typeof vid.play === 'function')
    var videoDead = false   // 片段加載失敗 → 退回固定時長節奏，別把整段卡住
    var curLine = -1        // 當前畫面已綁定到哪一句（按「句」去重）

    /* 播放狀態 */
    var speech = global.Speech || null
    var perLine = Math.max(2600, Math.floor(totalMs / (sc.lines.length + 1)))
    // 配音映射表裡的佔位符用的欄位名（{c1}/{c2}/{total} → 實際水晶顆數）
    var segCtx = {
      c1: ctx.crystal1 || 0,
      c2: ctx.crystal2 || 0,
      total: ctx.crystalTotal || 0,
    }
    var i = 0               // 下一句的序號
    var lineIdx = -1        // 正在顯示的那一句的序號
    var finished = false
    var lineNarrated = false // 本句是否用上了旁白（沒有旁白時由畫面播完來翻頁）
    var narrDone = true      // 本句旁白是否已念完（沒啟用旁白時恆為 true）
    var endedLine = -1       // ended 事件屬於哪一句（防止跨句回調）
    var watchdog = null     // 本句的兜底計時器

    /** 片段時長：元數據還沒就緒時用兜底值 */
    function clipSeconds() {
      var d = vid && Number(vid.duration)
      return Number.isFinite(d) && d > 0.5 ? d : CLIP_SEC_FALLBACK
    }
    /** 本句兜底預算：取「畫面時長 / 計劃節拍 / 旁白估時」三者的較大值 */
    function budgetMs(line) {
      var est = 1500 + String(line || '').length * 260 // 與 speech.js 的兜底估時同口徑
      return Math.max(clipSeconds() * 1000, perLine, est)
    }

    if (hasVid) {
      /* ⚠️ 這裡不能加「只顯示一次」的 guard：切鏡頭時會先摘掉 .on，
       * 一旦 guard 已置位，新片段就再也淡入不了，畫面會一直黑著。 */
      var show = function () {
        vid.classList.add('on')
        if (loadingEl) loadingEl.style.display = 'none'
      }
      if (usingShared) {
        /* 共享元素：事件只綁一次（模塊級 handler 讀 VID_STATE），
         * 每次 play() 只刷新狀態引用，避免監聽器隨故事段數累積 */
        VID_STATE = {
          show: show,
          isFinished: function () { return finished },
          endedLine: function () { return endedLine },
          lineIdx: function () { return lineIdx },
          lineNarrated: function () { return lineNarrated },
          advance: maybeAdvance,
          markDead: function () { videoDead = true },
          hideLoading: function () { if (loadingEl) loadingEl.style.display = 'none' },
        }
        if (!vid._lpBound) {
          vid._lpBound = true
          vid.addEventListener('error', vidOnError, true)
          vid.addEventListener('canplay', vidOnShow)
          vid.addEventListener('playing', vidOnShow)
          vid.addEventListener('ended', vidOnEnded)
        }
      } else {
        // 兼容路徑（測試樁 / 元素不可復用）：逐次綁定，行為與舊版一致
        vid.addEventListener('error', function () {
          videoDead = true
          if (vid.parentNode) vid.parentNode.removeChild(vid)
          if (loadingEl) loadingEl.style.display = 'none' // 保持深色畫面，不再顯示加載圈
        }, true)
        vid.addEventListener('canplay', show)
        vid.addEventListener('playing', show)
        vid.addEventListener('ended', function () {
          if (finished || endedLine !== lineIdx) return
          if (!lineNarrated) maybeAdvance()
        })
      }
      if (vid.readyState >= 2) show()
      try { vid.load() } catch (e) { }
      /* 移動端自動播放加固（修：手機上過場動畫不出現）
       * 順序：先試有聲 → 被策略拒絕 → 轉靜音再試 → 靜音起播成功後掛一次性觸摸監聽，
       * 孩子下一次點屏幕立刻恢復有聲；再被拒就放棄播放動作，交給旁白節拍與
       * forceAdvance 兜底（畫面深色但文字與翻頁不受影響）。
       * 切鏡頭也必須走這個入口（原實現只在首次播放重試，切鏡頭靜默失敗 → 整段黑屏）。 */
      var safePlay = function () {
        var pp = null
        try { pp = vid.play() } catch (e) { pp = null }
        if (pp && pp.catch) {
          pp.catch(function () {
            vid.muted = true
            var q = null
            try { q = vid.play() } catch (e) { q = null }
            if (q && q.then) {
              q.then(function () {
                // 靜音起播成功：下一次觸摸（touch 也是手勢）立刻恢復有聲
                var unmute = function () { vid.muted = false }
                if (typeof document !== 'undefined' && document.addEventListener) {
                  document.addEventListener('pointerdown', unmute, { once: true })
                  document.addEventListener('touchstart', unmute, { once: true })
                }
              }, function () { })
            }
          })
        }
      }
      safePlay()
      // 加載超時兜底：視頻沒能在 6s 內進入可播狀態（弱網/被攔），先把轉圈收掉，
      // 避免孩子盯著一個永遠轉不完的圈（文字與翻頁照常有旁白+兜底驅動）
      setTimeout(function () {
        if (!vid.classList || !vid.classList.contains('on')) {
          if (loadingEl) loadingEl.style.display = 'none'
        }
      }, 6000)
    }

    /**
     * 把畫面切到第 n 句對應的片段（越界取最後一段）。
     * 按「句」去重：同一句重複調用不再重載；但相鄰兩句即使指向同一個文件也會從頭開始，
     * 保證「一句文字 = 一次完整畫面」，文字和畫面不會錯位。
     */
    function switchClip(n) {
      if (!hasVid || videoDead || !vid.parentNode || !vcfg || !vcfg.list.length) return
      var want = Math.min(n, vcfg.list.length - 1)
      if (want === curLine) return
      curLine = want
      endedLine = want
      vid.classList.remove('on')                  // 先回暗，待新片段可播放後由 show() 重新淡入
      if (loadingEl) loadingEl.style.display = '' // 切換期間給個加載反饋，避免純黑
      vid.src = mediaSrc(CLIP_BASE + vcfg.list[want])
      try { vid.load() } catch (e) { }
      safePlay() // 與首次播放同一套自動播放加固（被拒 → 轉靜音重試）
      if (vid.readyState >= 2) show()             // 命中緩存時可能已經在可播狀態
      prefetchClip(vcfg.list[want + 1])           // 預取下一段，避免切鏡頭時才下載
    }
    layer._storySwitchClip = switchClip            // 兼容舊調用（測試/調試）
    if (hasVid) prefetchClip(vcfg && vcfg.list.length > 1 ? vcfg.list[1] : '') // 開場即預取第 2 段

    /* ---------------- 流程：旁白是節拍，視頻只播一遍 ---------------- */

    function finish(skipped) {
      if (finished) return
      finished = true
      if (watchdog) clearTimeout(watchdog)
      clearTimeout(guard)
      if (speech) speech.cancel() // 別讓孩子已經跳過動畫後還在念臺詞（也會掐掉共享 Audio 的 MP3）
      try { if (hasVid && typeof vid.pause === 'function') vid.pause() } catch (e) { }
      if (usingShared) VID_STATE = null // 共享元素歸位：後續故事重新掛狀態
      layer.classList.add('hidden')
      done(!!skipped)
    }

    /** 本句是否該翻頁了：旁白念完（或沒有旁白）就翻。
     *  —— 旁白先念完、畫面還在播 → 直接切下一句（不等畫面）
     *  —— 畫面先播完、旁白還在念 → 畫面停在最後一幀，等旁白念完再翻 */
    function maybeAdvance() {
      if (finished || lineIdx < 0) return
      if (narrDone) nextLine()
    }

    /** 兜底：旁白/畫面誰都沒按時觸發（播放被攔、語音不回調），強制翻頁 */
    function forceAdvance(n) {
      if (finished || n !== lineIdx) return
      narrDone = true
      nextLine()
    }

    /**
     * 顯示下一句：文字出現的同時切到對應片段。
     * 視頻每句只播一遍、絕不重播；旁白念完即翻頁，所以文字與畫面始終對齊。
     */
    function nextLine() {
      if (finished) return
      if (watchdog) { clearTimeout(watchdog); watchdog = null }
      if (i >= sc.lines.length) { finish(false); return }
      var myLine = i
      lineIdx = myLine
      i++

      var line = sc.lines[myLine]
      textEl.style.opacity = '0'
      textEl.textContent = line
      // 淡入
      setTimeout(function () { textEl.style.opacity = '1' }, 30)
      // 臺詞同步切換視頻鏡頭
      switchClip(myLine)

      // 兜底：自動播放被攔、片段損壞、語音不回調時，也要按計劃翻頁
      watchdog = setTimeout(function () { forceAdvance(myLine) }, budgetMs(line) + 2500)

      lineNarrated = false
      narrDone = true
      if (NARRATE) {
        lineNarrated = true
        narrDone = false
        var spoke = narrate(line, kind + '-' + (myLine + 1), function () {
          if (myLine !== lineIdx) return // 已經翻頁了，這次回調作廢
          narrDone = true
          maybeAdvance()
        })
        if (!spoke) { lineNarrated = false; narrDone = true } // 什麼都沒得播 → 由畫面播完來翻頁
      }
    }

    /**
     * 朗讀一句臺詞：優先播預生成的 MP3 配音（minimax-h3 出品，音色比瀏覽器 TTS 好），
     * 配音缺失或播放失敗時自動回退到瀏覽器 TTS，兩者都沒有就放棄（由畫面節奏接管）。
     * 返回 true = 已交給某種朗讀（done 稍後必被調用）；false = 無可播旁白，
     * 此時**不得**再碰 done —— nextLine 會讓 lineNarrated=false，由畫面播完 / 兜底節拍翻頁。
     * ⚠️ 不可播路徑絕不能用 0ms 延時回調 done：微信內置瀏覽器沒有 speechSynthesis，
     * 0ms 回調會讓每句瞬間翻頁，整段故事一閃而過（線上已實測復現）。
     */
    function narrate(text, lineKey, done) {
      if (!speech) return false // 無 TTS 環境：交給 nextLine 的「畫面播完 / forceAdvance 兜底」節拍
      var segs = null
      if (lineKey && typeof speech.segmentsFor === 'function') segs = speech.segmentsFor(lineKey, segCtx)
      if (segs && segs.length && typeof speech.speakAudio === 'function') {
        var started = speech.speakAudio(segs, function (ok) {
          if (ok === true) { done(); return }
          // 被新的朗讀/取消頂掉（ok === null）：靜默作廢，**不得**回退 TTS，
          // 否則新舊兩段語音會同時響（「再聽一次」疊音的根因之一）
          if (ok === null) return
          if (speech.speak(text, { minMs: 0, done: done })) return
          // 配音失敗 + TTS 也不可用：本句已聲明「有旁白」（nextLine 在等 done），
          // 按臺詞長度估時收尾（與 budgetMs / speech.js 的 est 同口徑），
          // 保證每句按估時節奏翻頁，不瞬移、也不卡死
          setTimeout(done, 1500 + String(text || '').length * 260)
        })
        if (started) return true
      }
      if (speech.speak(text, { minMs: 0, done: done })) return true
      return false // 旁白完全不可用：不回調 done，由畫面播完 / 兜底節拍翻頁
    }

    textEl.style.transition = 'opacity .45s ease'
    nextLine()
    // 最後一道保險：無論出現什麼異常，整段動畫都不會卡死
    var guard = setTimeout(function () { finish(false) }, totalMs + 20000)

    btn.addEventListener('click', function () { finish(true) })
    return { skip: function () { finish(true) } }
  }

  global.Story = { play: play, sceneSVG: sceneSVG, unlockVideo: unlockVideo }
})(window)
