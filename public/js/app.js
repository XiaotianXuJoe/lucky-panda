/* 幸運熊貓 · 前端殼（登錄 / 登記 / 首頁 / 資料） */
(function () {
  'use strict'

  var $ = function (id) { return document.getElementById(id) }
  var views = ['viewLogin', 'viewRegister', 'viewHome', 'viewProfile']
  var state = { user: null, stats: null }

  function show(name) {
    views.forEach(function (v) {
      var el = $(v)
      if (el) el.classList.toggle('hidden', v !== name)
    })
  }

  function msg(id, text, kind) {
    var el = $(id)
    if (!el) return
    el.className = 'msg show ' + (kind || 'err')
    el.textContent = text
  }
  function clearMsg(id) {
    var el = $(id)
    if (el) el.className = 'msg'
  }

  /* ---------------- 路由 ---------------- */

  function route() {
    var hash = location.hash || '#/login'
    var token = LP.getUserToken()
    if (!token) {
      state.user = null
      $('who').textContent = ''
      $('btnLogout').classList.add('hidden')
      if (hash === '#/register') { show('viewRegister'); return }
      show('viewLogin')
      return
    }
    if (!state.user) {
      // 有 token 但尚未拉取用戶信息
      loadMe().then(function () { route() }).catch(function () {
        LP.setUserToken('')
        location.hash = '#/login'
        route()
      })
      return
    }
    if (hash === '#/profile') { show('viewProfile'); return }
    show('viewHome')
  }

  async function loadMe() {
    var d = await LP.api('/api/me')
    state.user = d.user
    state.stats = d.stats
    $('who').textContent = state.user.childName + '（編號 ' + state.user.participantId + '）'
    $('btnLogout').classList.remove('hidden')
    renderHome()
    return d
  }

  // 需求6：首頁精簡為居中單卡 hero —— 訓練記錄表 / #hmStats 成績區已移除，
  // 不再請求 /api/my/sessions（該接口已隨之下線），也不引用已刪節點。
  function renderHome() {
    var u = state.user
    $('hmTitle').textContent = '你好，' + u.childName + '！'
    ensurePreload()
  }

  /* ---------------- 資源預加載（微信端弱網穩定性的關鍵） ----------------
   * 登錄成功進入首頁後，先把「第一階段開場視頻 + 全部配音」拉進 HTTP 緩存，
   * 進度條走滿前「開始訓練」按鈕不可點；加載完（或失敗重試後）才放行。
   * 後兩階段的視頻由 /play/ 頁在遊玩過程中後臺繼續加載（見 main.js）。 */
  var preloadState = { started: false }
  function ensurePreload() {
    if (preloadState.started) return
    preloadState.started = true
    var PL = window.LPPreload
    var btn = $('btnStart'), box = $('preBox'), fill = $('preFill'), cnt = $('preCount'), lab = $('preLabel')
    if (!PL || !box || !btn) { if (btn) btn.disabled = false; return }
    box.classList.remove('hidden')
    btn.disabled = true
    btn.textContent = '正在加載資源…'
    PL.audioUrls().then(function (audio) {
      var urls = audio.concat(PL.VIDEOS_INTRO)
      if (cnt) cnt.textContent = '0 / ' + urls.length
      return PL.run(urls, {
        concurrency: 2,
        timeoutMs: 25000,
        retries: 1,
        onProgress: function (done, total) {
          if (fill) fill.style.width = Math.round((done / total) * 100) + '%'
          if (cnt) cnt.textContent = done + ' / ' + total
        },
      })
    }).catch(function () { return { failed: [] } }).then(function (res) {
      btn.disabled = false
      btn.textContent = '開始今天的訓練'
      if (box) box.classList.add('pre-done')
      if (lab) {
        if (res && res.failed && res.failed.length) {
          lab.textContent = '有 ' + res.failed.length + ' 個資源沒加載好（網絡不太穩），但可以開始了，播放時會自動再試'
          lab.classList.add('warn')
        } else {
          lab.textContent = '森林冒險已經準備好了！'
        }
      }
    })
  }

  /* ---------------- 登錄 ---------------- */

  $('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault()
    clearMsg('loginMsg')
    var id1 = $('lgId1').value.trim()
    var id2 = $('lgId2').value.trim()
    var surname = $('lgSurname').value.trim()
    if (!/^\d{4}$/.test(id1)) return msg('loginMsg', '編號必須是 4 位數字')
    if (id1 !== id2) return msg('loginMsg', '兩次輸入的編號不一致，請檢查')
    if (!surname) return msg('loginMsg', '請填寫兒童姓氏')
    var btn = e.target.querySelector('button[type=submit]')
    btn.disabled = true
    btn.textContent = '登錄中…'
    try {
      var d = await LP.api('/api/login', { method: 'POST', body: { credential: id1 + surname } })
      LP.setUserToken(d.token)
      state.user = d.user
      location.hash = '#/home'
      await loadMe()
      route()
    } catch (err) {
      msg('loginMsg', err.message || '登錄失敗')
    } finally {
      btn.disabled = false
      btn.textContent = '登 錄'
    }
  })

  /* ---------------- 登記 ---------------- */

  $('regForm').addEventListener('submit', async function (e) {
    e.preventDefault()
    clearMsg('regMsg')
    var body = {
      participantId: $('rgId').value.trim(),
      childName: $('rgName').value.trim(),
      childGender: $('rgGender').value,
      email: $('rgEmail').value.trim(),
    }
    var age = $('rgAge').value.trim()
    if (age !== '') body.childAge = Number(age)
    if (!/^\d{4}$/.test(body.participantId)) return msg('regMsg', '編號必須是 4 位數字')
    if (!body.childName || !body.childGender) return msg('regMsg', '請填寫兒童姓名和性別')
    var btn = e.target.querySelector('button[type=submit]')
    btn.disabled = true
    try {
      var d = await LP.api('/api/register', { method: 'POST', body: body })
      LP.setUserToken(d.token)
      state.user = d.user
      location.hash = '#/home'
      await loadMe()
      route()
      msg('regMsg', '登記成功！已自動登錄', 'ok')
    } catch (err) {
      msg('regMsg', err.message || '登記失敗')
    } finally {
      btn.disabled = false
    }
  })

  /* ---------------- 資料 ---------------- */

  $('pfForm').addEventListener('submit', async function (e) {
    e.preventDefault()
    clearMsg('pfMsg')
    var body = {
      childName: $('pfName').value.trim(),
      childGender: $('pfGender').value,
      email: $('pfEmail').value.trim(),
    }
    var age = $('pfAge').value.trim()
    if (age !== '') body.childAge = Number(age)
    try {
      var d = await LP.api('/api/user/profile', { method: 'PUT', body: body })
      state.user = d.user
      $('who').textContent = d.user.childName + '（編號 ' + d.user.participantId + '）'
      renderHome()
      msg('pfMsg', '已保存', 'ok')
    } catch (err) {
      msg('pfMsg', err.message || '保存失敗')
    }
  })

  /* ---------------- 開始訓練 / 退出 ---------------- */

  $('btnStart').addEventListener('click', function () {
    location.href = '/play/'
  })

  $('btnLogout').addEventListener('click', function () {
    LP.setUserToken('')
    state.user = null
    location.hash = '#/login'
    route()
  })

  window.addEventListener('hashchange', route)

  /* ---------------- 啟動 ---------------- */
  ;(async function boot() {
    if (!location.hash) location.hash = '#/login'
    if (LP.getUserToken()) {
      try {
        await loadMe()
      } catch {
        LP.setUserToken('')
      }
    }
    route()
  })()
})()
