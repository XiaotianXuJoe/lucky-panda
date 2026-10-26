/* 幸运熊猫 · 管理后台 */
(function () {
  'use strict'

  var $ = function (id) { return document.getElementById(id) }
  var allUsers = []
  var editingPid = null

  function msg(id, text, kind) {
    var el = $(id)
    if (!el) return
    el.className = 'msg show ' + (kind || 'err')
    el.textContent = text
  }
  function clearMsg(id) { var el = $(id); if (el) el.className = 'msg' }
  function stat(k, v) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    })
  }
  function fmtSec(v) { return v == null || v === 0 ? '—' : (Math.round(v * 10) / 10) + 's' }

  /* ---------------- 登录 ---------------- */

  $('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault()
    clearMsg('loginMsg')
    try {
      var d = await LP.api('/api/admin/login', {
        method: 'POST',
        admin: true,
        body: { username: $('adUser').value, password: $('adPass').value },
        token: '', // 登录接口本身不需要 token
      })
      LP.setAdminToken(d.token)
      enterMain()
    } catch (err) {
      msg('loginMsg', err.message || '登录失败')
    }
  })

  $('btnLogout').addEventListener('click', function () {
    LP.setAdminToken('')
    $('viewMain').classList.add('hidden')
    $('viewLogin').classList.remove('hidden')
    $('btnLogout').classList.add('hidden')
  })

  function enterMain() {
    $('viewLogin').classList.add('hidden')
    $('viewMain').classList.remove('hidden')
    $('btnLogout').classList.remove('hidden')
    refreshAll()
  }

  function refreshAll() {
    loadOverview()
    loadUsers()
    loadSessions()
  }

  /* ---------------- Tab ---------------- */

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) { b.classList.remove('active') })
      btn.classList.add('active')
      var ids = ['tabUsers', 'tabSessions', 'tabRemind', 'tabImport']
      ids.forEach(function (id) { $(id).classList.toggle('hidden', id !== btn.dataset.tab) })
      $('userDetail').classList.add('hidden')
    })
  })

  /* ---------------- 总览 ---------------- */

  async function loadOverview() {
    try {
      var d = await LP.api('/api/admin/overview', { admin: true })
      $('overview').innerHTML = [
        stat('被试人数', d.userCount),
        stat('训练会话', d.sessionCount),
        stat('完成次数', d.completedCount),
        stat('累计训练时长', LP.fmtDuration(d.totalPlaySeconds)),
        stat('累计水晶', d.crystalTotal + ' 颗'),
        stat('待提醒', d.needsReminder + ' 人'),
        stat('邮件服务', d.emailConfigured ? '已配置' : '未配置'),
      ].join('')
    } catch (err) {
      $('overview').innerHTML = '<div class="stat"><div class="k">加载失败</div><div class="v" style="font-size:15px">' + esc(err.message) + '</div></div>'
    }
  }

  /* ---------------- 用户列表 ---------------- */

  async function loadUsers() {
    try {
      var d = await LP.api('/api/admin/users', { admin: true })
      allUsers = d.users || []
      renderUsers()
    } catch (err) {
      console.error(err)
    }
  }

  function renderUsers() {
    var kw = ($('userSearch').value || '').trim().toLowerCase()
    var list = allUsers.filter(function (u) {
      if (!kw) return true
      return [u.participantId, u.childName, u.email, u.childSurname].join(' ').toLowerCase().indexOf(kw) >= 0
    })
    var tbody = document.querySelector('#usersTable tbody')
    tbody.innerHTML = ''
    $('usersEmpty').style.display = list.length ? 'none' : 'block'
    list.forEach(function (u) {
      var s = u.stats || {}
      var r = u.reminder || {}
      var tr = document.createElement('tr')
      tr.innerHTML =
        '<td><b>' + esc(u.participantId) + '</b></td>' +
        '<td>' + esc(u.childName) + '</td>' +
        '<td>' + esc(u.childGender) + '</td>' +
        '<td>' + (u.childAge == null ? '—' : u.childAge) + '</td>' +
        '<td>' + esc(u.email || '—') + '</td>' +
        '<td class="num">' + s.sessionCount + '</td>' +
        '<td class="num">' + LP.fmtDuration(s.totalPlaySeconds) + '</td>' +
        '<td class="num">' + (s.crystalTotal || 0) + '</td>' +
        '<td>' + LP.fmtBJ(s.lastPlayedAt) + '</td>' +
        '<td class="num">' + r.daysInactive + ' 天</td>' +
        '<td>' + (r.needsReminder ? '<span class="tag warn">需提醒</span>' : '<span class="tag grey">正常</span>') + '</td>' +
        '<td><button class="btn btn-sm btn-ghost" data-pid="' + esc(u.participantId) + '">详情</button></td>'
      tr.querySelector('button').addEventListener('click', function () { openDetail(u.participantId) })
      tbody.appendChild(tr)
    })
  }

  $('userSearch').addEventListener('input', renderUsers)
  $('btnRefreshUsers').addEventListener('click', loadUsers)
  $('btnRefreshOverview').addEventListener('click', loadOverview)

  /* ---------------- 会话列表 ---------------- */

  async function loadSessions() {
    var pid = ($('sessPid').value || '').trim()
    try {
      var url = '/api/admin/sessions?limit=200' + (pid ? '&participantId=' + encodeURIComponent(pid) : '')
      var d = await LP.api(url, { admin: true })
      var list = d.sessions || []
      var tbody = document.querySelector('#sessionsTable tbody')
      tbody.innerHTML = ''
      $('sessionsEmpty').style.display = list.length ? 'none' : 'block'
      list.forEach(function (s) {
        var tr = document.createElement('tr')
        tr.innerHTML =
          '<td><b>' + esc(s.participantId) + '</b></td>' +
          '<td>' + esc(nameOf(s.participantId)) + '</td>' +
          '<td>' + LP.fmtBJ(s.sessionStart) + '</td>' +
          '<td class="num">' + fmtSec(s.block1Seconds) + '</td>' +
          '<td class="num">' + fmtSec(s.block2Seconds) + '</td>' +
          '<td class="num">' + fmtSec(s.block3Seconds) + '</td>' +
          '<td class="num">' + LP.fmtDuration(s.durationSec) + '</td>' +
          '<td class="num">' + fmtSec(s.storySeconds) + '</td>' +
          '<td class="num">' + fmtSec(s.hiddenSeconds) + '</td>' +
          '<td class="num">' + (s.crystalTotal || 0) + '</td>' +
          '<td>第' + (s.maxStage || 0) + '阶段 第' + (s.maxLevel || 0) + '关</td>' +
          '<td>' + (s.completed ? '<span class="tag ok">完成</span>' : '<span class="tag warn">未完成</span>') + '</td>'
        tbody.appendChild(tr)
      })
    } catch (err) {
      console.error(err)
    }
  }
  $('btnRefreshSessions').addEventListener('click', loadSessions)
  $('sessPid').addEventListener('change', loadSessions)

  function nameOf(pid) {
    var u = allUsers.filter(function (x) { return x.participantId === pid })[0]
    return u ? u.childName : ''
  }

  /* ---------------- 用户详情 ---------------- */

  async function openDetail(pid) {
    editingPid = pid
    clearMsg('udMsg')
    try {
      var d = await LP.api('/api/admin/users/' + encodeURIComponent(pid), { admin: true })
      var u = d.user
      var s = d.stats || {}
      var r = d.reminder || {}
      $('udTitle').textContent = u.childName + '（编号 ' + u.participantId + '）'
      $('udStats').innerHTML = [
        stat('会话数', s.sessionCount),
        stat('总训练时长', LP.fmtDuration(s.totalPlaySeconds)),
        stat('水晶总数', (s.crystalTotal || 0) + ' 颗'),
        stat('最远进度', '第' + (s.maxStage || 0) + '阶段 第' + (s.maxLevel || 0) + '关'),
        stat('最近训练', LP.fmtBJ(s.lastPlayedAt)),
        stat('未训练', r.daysInactive + ' 天'),
        stat('提醒状态', r.needsReminder ? '需提醒' : '正常'),
      ].join('')

      var tb = document.querySelector('#udDaily tbody')
      tb.innerHTML = ''
      ;(d.daily || []).forEach(function (x) {
        var tr = document.createElement('tr')
        tr.innerHTML =
          '<td>' + esc(x.date) + '</td>' +
          '<td class="num">' + fmtSec(x.block1Seconds) + '</td>' +
          '<td class="num">' + fmtSec(x.block2Seconds) + '</td>' +
          '<td class="num">' + fmtSec(x.block3Seconds) + '</td>' +
          '<td class="num">' + LP.fmtDuration(x.totalSeconds) + '</td>' +
          '<td class="num">' + (x.crystalTotal || 0) + '</td>' +
          '<td class="num">' + x.sessionCount + '</td>'
        tb.appendChild(tr)
      })

      $('udId').value = u.participantId
      $('udName').value = u.childName
      $('udGender').value = u.childGender
      $('udAge').value = u.childAge == null ? '' : u.childAge
      $('udEmail').value = u.email || ''
      $('userDetail').classList.remove('hidden')
      $('userDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } catch (err) {
      alert(err.message || '加载失败')
    }
  }

  $('btnCloseDetail').addEventListener('click', function () {
    $('userDetail').classList.add('hidden')
  })

  $('udForm').addEventListener('submit', async function (e) {
    e.preventDefault()
    if (!editingPid) return
    clearMsg('udMsg')
    var body = {
      participantId: $('udId').value.trim(),
      childName: $('udName').value.trim(),
      childGender: $('udGender').value,
      email: $('udEmail').value.trim(),
    }
    var age = $('udAge').value.trim()
    if (age !== '') body.childAge = Number(age)
    try {
      await LP.api('/api/admin/users/' + encodeURIComponent(editingPid), { method: 'PUT', admin: true, body: body })
      msg('udMsg', '已保存', 'ok')
      await loadUsers()
      loadOverview()
      loadSessions()
    } catch (err) {
      msg('udMsg', err.message || '保存失败')
    }
  })

  $('btnDeleteUser').addEventListener('click', async function () {
    if (!editingPid) return
    if (!confirm('确定删除编号 ' + editingPid + ' 吗？该用户的全部训练记录也会一并删除，且不可恢复。')) return
    try {
      await LP.api('/api/admin/users/' + encodeURIComponent(editingPid), { method: 'DELETE', admin: true })
      $('userDetail').classList.add('hidden')
      editingPid = null
      await loadUsers()
      loadOverview()
      loadSessions()
    } catch (err) {
      msg('udMsg', err.message || '删除失败')
    }
  })

  /* ---------------- 提醒 ---------------- */

  $('btnSendReminders').addEventListener('click', async function () {
    clearMsg('remindMsg')
    var btn = this
    btn.disabled = true
    btn.textContent = '发送中…'
    $('remindResult').innerHTML = ''
    try {
      var d = await LP.api('/api/admin/send-reminders', { method: 'POST', admin: true })
      msg('remindMsg', '完成：成功 ' + d.sent.length + ' 封，失败 ' + d.failed.length + ' 封，跳过 ' + d.skipped + ' 人', d.failed.length ? 'err' : 'ok')
      var rows = d.sent.map(function (x) { return '<div class="muted">✓ ' + esc(x.participantId) + ' ' + esc(x.childName) + ' → ' + esc(x.email) + '</div>' })
        .concat(d.failed.map(function (x) { return '<div class="muted" style="color:#c2410c">✗ ' + esc(x.participantId) + ' ' + esc(x.childName) + '：' + esc(x.reason) + '</div>' }))
      $('remindResult').innerHTML = rows.join('') || '<div class="muted">没有需要提醒的用户。</div>'
      loadOverview()
      loadUsers()
    } catch (err) {
      msg('remindMsg', err.message || '发送失败')
    } finally {
      btn.disabled = false
      btn.textContent = '立即发送提醒邮件'
    }
  })

  /* ---------------- 批量导入 ---------------- */

  $('btnImport').addEventListener('click', async function () {
    clearMsg('importMsg')
    var text = $('importText').value
    var rows = text.split('\n').map(function (l) { return l.trim() }).filter(Boolean).map(function (l) {
      var p = l.split(/[,，\t]/).map(function (x) { return x.trim() })
      return { participantId: p[0], childName: p[1], childGender: p[2], childAge: p[3], email: p[4] }
    })
    if (!rows.length) return msg('importMsg', '没有要导入的数据')
    if (rows.length > 500) return msg('importMsg', '单次最多导入 500 条')
    var btn = this
    btn.disabled = true
    try {
      var d = await LP.api('/api/admin/import-users', { method: 'POST', admin: true, body: { rows: rows } })
      msg('importMsg', '导入完成：成功 ' + d.created.length + ' 条，失败 ' + d.errors.length + ' 条', d.errors.length ? 'err' : 'ok')
      var errRows = d.errors.map(function (x) { return '<div class="muted" style="color:#c2410c">第 ' + x.line + ' 行：' + esc(x.reason) + '</div>' })
      $('importResult').innerHTML = errRows.join('') || '<div class="muted">全部导入成功。</div>'
      await loadUsers()
      loadOverview()
    } catch (err) {
      msg('importMsg', err.message || '导入失败')
    } finally {
      btn.disabled = false
    }
  })

  /* ---------------- CSV 导出（带 token，不能直接用 <a href>） ---------------- */

  async function downloadCsv(url, filename) {
    try {
      var res = await fetch(url, { headers: { Authorization: 'Bearer ' + LP.getAdminToken() } })
      if (!res.ok) throw new Error('导出失败（' + res.status + '）')
      var blob = await res.blob()
      var a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      document.body.appendChild(a)
      a.click()
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove() }, 1000)
    } catch (err) {
      alert(err.message || '导出失败')
    }
  }

  Array.prototype.forEach.call(document.querySelectorAll('a[href^="/api/admin/export/"]'), function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault()
      downloadCsv(a.getAttribute('href'), a.getAttribute('href').split('/').pop())
    })
  })

  /* ---------------- 启动 ---------------- */

  if (LP.getAdminToken()) enterMain()
})()
