/* 在服务器上运行：验证邮件提醒链路（判定逻辑 + 真实发信） */
const fs = require('fs')
const http = require('http')
const path = require('path')

const HOME = '/home/ubuntu/lucky-panda'
const DATA = path.join(HOME, 'data.json')
const S = require(path.join(HOME, 'server.js'))

let failures = 0
const check = (c, m) => { if (!c) failures++; console.log((c ? '  ✓ ' : '  ✗ ') + m) }

/* ---------- 1. 判定逻辑与窗口 ---------- */
console.log('\n[1] 提醒判定逻辑')
const cfg = S.loadEmailConfig()
check(!!cfg, `邮件配置已加载：${cfg ? cfg.user + ' via ' + cfg.host + ':' + cfg.port : '未配置'}`)

const bj = S.beijingParts(Date.now())
console.log(`  · 当前北京时间：${bj.date} ${String(bj.hour).padStart(2, '0')}:${String(bj.minute).padStart(2, '0')}`)

// 构造一个 09:10 北京时间 / 一个 14:00 北京时间
function bjAt(y, m, d, h, min) {
  return Date.UTC(y, m - 1, d, h - 8, min) // 北京时间 = UTC+8
}
check(S.inAutoReminderWindow(bjAt(2026, 10, 13, 9, 10)) === true, '北京时间 09:10 在自动发送窗口内')
check(S.inAutoReminderWindow(bjAt(2026, 10, 13, 9, 29)) === true, '北京时间 09:29 在窗口内（边界）')
check(S.inAutoReminderWindow(bjAt(2026, 10, 13, 9, 30)) === false, '北京时间 09:30 不在窗口内')
check(S.inAutoReminderWindow(bjAt(2026, 10, 13, 14, 0)) === false, '北京时间 14:00 不在窗口内')

const fakeUser = {
  participantId: '0299', childName: '测试小熊', childSurname: '测', childGivenName: '试小熊',
  email: '757289926@qq.com', registeredAt: new Date(Date.now() - 5 * 86400000).toISOString(),
}
const fakeData = { users: { '0299': fakeUser }, sessions: {}, userTokens: {}, adminTokens: {} }
const now = Date.now()
let info = S.reminderInfo(fakeData, fakeUser, now)
check(info.daysInactive === 5, `5 天未训练 → daysInactive=${info.daysInactive}`)
check(info.needsReminder === true, '5 天未训练且从未提醒 → needsReminder=true')

const fresh = { ...fakeUser, registeredAt: new Date(now - 3600000).toISOString() }
let info2 = S.reminderInfo({ users: { x: fresh }, sessions: {} }, fresh, now)
check(info2.needsReminder === false, '1 小时前刚注册 → needsReminder=false')

const justReminded = { ...fakeUser, lastReminderAt: new Date(now - 3600000).toISOString() }
let info3 = S.reminderInfo({ users: { x: justReminded }, sessions: {} }, justReminded, now)
check(info3.needsReminder === false, '1 小时前刚提醒过 → needsReminder=false（72h 最小间隔生效）')

const mail = S.buildReminderMail(fakeUser, 5)
console.log('\n[2] 邮件模板')
console.log('  主题：' + mail.subject)
console.log('  正文：\n' + mail.text.split('\n').map((l) => '    ' + l).join('\n'))
check(mail.text.includes('请鼓励小朋友按时参加，努力完成游戏哦！'), '正文包含需求原文文案')
check(mail.text.includes('175.178.16.78:8200'), '正文包含正确的访问地址')

/* ---------- 3. 真实发信 ---------- */
function post(pathname, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const headers = {}
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data) }
    if (token) headers['Authorization'] = 'Bearer ' + token
    const r = http.request({ host: '127.0.0.1', port: 8200, method: data ? 'POST' : 'GET', path: pathname, headers }, (res) => {
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { buf += c })
      res.on('end', () => { let j = null; try { j = JSON.parse(buf) } catch { /* */ } resolve({ status: res.statusCode, json: j, text: buf }) })
    })
    r.on('error', reject)
    if (data) r.write(data)
    r.end()
  })
}

;(async () => {
  console.log('\n[3] 真实发信（SMTP-over-TLS，零依赖）')
  // 造一个「5 天未训练」的真实用户，并清空其会话
  const d = JSON.parse(fs.readFileSync(DATA, 'utf8'))
  const u = d.users['0299']
  if (!u) { console.log('  ✗ 找不到测试用户 0299'); process.exit(1) }
  u.email = '757289926@qq.com'
  u.registeredAt = new Date(Date.now() - 5 * 86400000).toISOString()
  u.lastReminderAt = null
  d.sessions = Object.fromEntries(Object.entries(d.sessions).filter(([, v]) => v.participantId !== '0299'))
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2))

  let r = await post('/api/admin/login', { username: 'admin', password: '123456' })
  const at = r.json.token
  r = await post('/api/admin/send-reminders', {}, at)
  check(r.status === 200, `调用手动提醒接口 → ${r.status}`)
  const sent = (r.json && r.json.sent) || []
  const failed = (r.json && r.json.failed) || []
  check(sent.length === 1, `成功发送 ${sent.length} 封（目标 ${sent[0] ? sent[0].email : '-'}）`)
  if (failed.length) console.log('  失败：' + JSON.stringify(failed))

  // 验证 lastReminderAt 已落盘
  const d2 = JSON.parse(fs.readFileSync(DATA, 'utf8'))
  check(!!d2.users['0299'].lastReminderAt, `lastReminderAt 已落盘：${d2.users['0299'].lastReminderAt}`)

  // 立刻再发一次 → 应被 72h 最小间隔拦住
  r = await post('/api/admin/send-reminders', {}, at)
  check(((r.json && r.json.sent) || []).length === 0, '5 秒后再次发送 → 被 72 小时最小间隔拦截（幂等）')

  console.log('\n' + (failures === 0 ? '邮件链路全部通过 ✓' : failures + ' 项失败 ✗'))
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => { console.error('异常：', e); process.exit(1) })
