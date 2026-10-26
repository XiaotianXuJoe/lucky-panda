/* 幸运熊猫 · 公共 API 封装（与服务端同源，token 存 localStorage） */
(function (global) {
  'use strict'

  var USER_TOKEN_KEY = 'luckyPanda.userToken'
  var ADMIN_TOKEN_KEY = 'luckyPanda.adminToken'

  function getUserToken() {
    try { return localStorage.getItem(USER_TOKEN_KEY) || '' } catch { return '' }
  }
  function setUserToken(t) {
    try { t ? localStorage.setItem(USER_TOKEN_KEY, t) : localStorage.removeItem(USER_TOKEN_KEY) } catch { /* ignore */ }
  }
  function getAdminToken() {
    try { return localStorage.getItem(ADMIN_TOKEN_KEY) || '' } catch { return '' }
  }
  function setAdminToken(t) {
    try { t ? localStorage.setItem(ADMIN_TOKEN_KEY, t) : localStorage.removeItem(ADMIN_TOKEN_KEY) } catch { /* ignore */ }
  }

  /**
   * 请求 JSON 接口。
   * @param {string} path  例如 '/api/login'
   * @param {object} opts  { method, body, token, admin }
   */
  async function api(path, opts) {
    opts = opts || {}
    var headers = { 'Content-Type': 'application/json' }
    var token = opts.token != null ? opts.token : (opts.admin ? getAdminToken() : getUserToken())
    if (token) headers['Authorization'] = 'Bearer ' + token
    var res = await fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      keepalive: !!opts.keepalive,
    })
    var text = await res.text()
    var data = null
    try { data = text ? JSON.parse(text) : {} } catch { data = { error: text || '响应格式错误' } }
    if (!res.ok) {
      var err = new Error((data && data.error) || ('请求失败（' + res.status + '）'))
      err.status = res.status
      err.data = data
      throw err
    }
    return data
  }

  /** 秒 → "m分s秒" */
  function fmtDuration(sec) {
    var s = Math.max(0, Math.round(Number(sec) || 0))
    var m = Math.floor(s / 60)
    return m > 0 ? (m + '分' + (s % 60) + '秒') : (s + '秒')
  }

  /** ISO → 北京时间 YYYY-MM-DD HH:mm */
  function fmtBJ(iso) {
    if (!iso) return '—'
    var ms = Date.parse(iso)
    if (!Number.isFinite(ms)) return '—'
    var d = new Date(ms + 8 * 3600 * 1000)
    var p = function (n) { return String(n).padStart(2, '0') }
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes())
  }

  global.LP = {
    USER_TOKEN_KEY: USER_TOKEN_KEY,
    ADMIN_TOKEN_KEY: ADMIN_TOKEN_KEY,
    getUserToken: getUserToken,
    setUserToken: setUserToken,
    getAdminToken: getAdminToken,
    setAdminToken: setAdminToken,
    api: api,
    fmtDuration: fmtDuration,
    fmtBJ: fmtBJ,
  }
})(window)
