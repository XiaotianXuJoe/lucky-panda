/* 幸運熊貓 · 資源預加載器（首頁 app.js 與遊戲頁 main.js 共用）
 *
 * 解決的問題：微信內置瀏覽器裡 <video> 依賴在線 Range 拉流，弱網下「有時能播、
 * 有時黑屏」。改為先把媒體字節整段拉下來，兩層用法：
 *   - run(urls)  首頁登錄後預熱 HTTP 緩存（arrayBuffer 丟棄，只留緩存）
 *   - blob(urls) 遊戲頁內把字節轉 blob:URL，播放時零網絡（LPPreload.src 取用）
 * blob:URL 只在創建它的文檔內有效，所以跨頁跳轉的兩層各做各的：
 * 首頁負責「用戶等待 + 溫暖 HTTP 緩存」，遊戲頁負責「真播放源是 blob」。
 *
 * 並發受限 + 單件超時 + 失敗重試；任何失敗都只記入 failed，絕不把流程卡死。
 */
(function (global) {
  'use strict'

  var BLOBS = {} // url -> blobURL（僅本文檔有效，跨頁跳轉即失效）

  function canBlob() {
    return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
  }

  /* 有 blob 緩存返回 blob:URL，否則原樣返回（調用方不用關心是否有預載） */
  function src(url) { return BLOBS[url] || url }

  function fetchOne(url, asBlob, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false
      var timer = setTimeout(function () {
        if (!done) { done = true; resolve({ url: url, ok: false }) }
      }, timeoutMs)
      fetch(url, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return asBlob ? r.blob() : r.arrayBuffer()
      }).then(function (data) {
        if (done) return
        done = true
        clearTimeout(timer)
        if (asBlob && data && canBlob()) {
          try { BLOBS[url] = URL.createObjectURL(data) } catch (e) { /* 存不下也算拉過緩存 */ }
        }
        resolve({ url: url, ok: true })
      }).catch(function () {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve({ url: url, ok: false })
      })
    })
  }

  /** 並發受限下載一批。opts: {concurrency, timeoutMs, retries, asBlob, onProgress(done,total,url,ok)}
   *  永遠 resolve（不 reject），返回 {failed:[url,...]} */
  function run(urls, opts) {
    opts = opts || {}
    var conc = Math.max(1, opts.concurrency || 2)
    var timeoutMs = opts.timeoutMs || 25000
    var retries = opts.retries == null ? 1 : opts.retries
    var asBlob = !!opts.asBlob
    var onProgress = opts.onProgress
    var failed = []
    var total = urls.length
    var doneN = 0
    var idx = 0
    return new Promise(function (resolve) {
      if (!total) { resolve({ failed: [] }); return }
      function next() {
        if (idx >= urls.length) return
        var url = urls[idx++]
        var attempt = 0
        ;(function go() {
          fetchOne(url, asBlob, timeoutMs).then(function (r) {
            if (!r.ok && attempt < retries) { attempt++; go(); return }
            if (!r.ok) failed.push(url)
            doneN++
            if (onProgress) { try { onProgress(doneN, total, url, r.ok) } catch (e) { } }
            if (doneN >= total) { resolve({ failed: failed }); return }
            next()
          })
        })()
      }
      for (var i = 0; i < Math.min(conc, urls.length); i++) next()
    })
  }

  /* 後臺閒時加載：低並發、不重試、靜默失敗；供遊戲頁放第二/三階段資源 */
  function idle(urls) {
    setTimeout(function () {
      run(urls, { concurrency: 1, timeoutMs: 40000, retries: 0, asBlob: true })
    }, 1500)
  }

  /* 配音清單來自 manifest.json（服務端的權威列表），不在這邊寫死文件名。
   * 顆數整句變體（story1-1-n* / story2-1-c*t* / ending-1-n*，共 128 個、~5MB）**不進**全量預載：
   * 每局實際只會用到其中 3 個，由 main.js 在故事開場前按真實顆數按需轉 blob。 */
  var VARIANT_RE = /-(?:n\d+|c\d+t\d+)\.mp3$/
  function audioUrls() {
    return fetch('/play/assets/audio/manifest.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : {} })
      .catch(function () { return {} })
      .then(function (m) {
        var out = ['/play/assets/audio/lines.json', '/play/assets/audio/manifest.json']
        Object.keys(m || {}).forEach(function (k) {
          var f = m[k] && m[k].file // "audio/xxx.mp3"
          if (f && !VARIANT_RE.test(f)) out.push('/play/assets/' + String(f).replace(/^\/+/, ''))
        })
        return out
      })
  }

  function videosOf(names) {
    return names.map(function (n) { return '/play/assets/video/' + n })
  }

  global.LPPreload = {
    run: run,
    blob: function (urls, opts) { opts = opts || {}; opts.asBlob = true; return run(urls, opts) },
    idle: idle,
    src: src,
    audioUrls: audioUrls,
    /* 開場（第一階段）必須在進訓練前加載完；後兩個階段進遊戲後後臺加載 */
    VIDEOS_INTRO: videosOf([
      'clip01a-forest-wide.mp4', 'clip01b-animals-crystals.mp4', 'clip01c-wizard-appears.mp4',
      'clip02-intro-gray.mp4', 'clip01e-panda-asks.mp4',
    ]),
    VIDEOS_LATER: videosOf([
      'clip03-story1-heal.mp4', 'clip03b-wizard-cave.mp4',
      'clip04-story2-cave.mp4', 'clip04b-wizard-flowers.mp4',
      'clip05a-forest-fullcolor.mp4', 'clip05b-animals-return.mp4', 'clip05-ending-celebrate.mp4',
    ]),
    _blobs: BLOBS, // 供測試檢查
  }
})(window)
