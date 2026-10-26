/* 本地冒烟测试：直接走 http 模块，避免代理干扰 */
const http = require('http')

const BASE = '127.0.0.1'
const PORT = Number(process.env.PORT || 8200)

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const headers = {}
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data) }
    if (token) headers['Authorization'] = 'Bearer ' + token
    const r = http.request({ host: BASE, port: PORT, method, path, headers }, (res) => {
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { buf += c })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(buf) } catch { /* not json */ }
        resolve({ status: res.statusCode, json, text: buf })
      })
    })
    r.on('error', reject)
    if (data) r.write(data)
    r.end()
  })
}

const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m)
let failures = 0
function check(c, m) { if (!c) failures++; ok(c, m) }

function sampleLog(startOffsetMs) {
  const start = new Date(Date.now() - startOffsetMs).toISOString()
  const end = new Date().toISOString()
  return {
    mode: 'train',
    Time: {
      sessionStart: start,
      sessionEnd: end,
      rests: [
        { start: start, end: new Date(Date.parse(start) + 40000).toISOString(), kind: 'story', stage: 0 },
        { start: new Date(Date.parse(start) + 400000).toISOString(), end: new Date(Date.parse(start) + 455000).toISOString(), kind: 'story', stage: 1 },
      ],
      pauses: [{ start: new Date(Date.parse(start) + 120000).toISOString(), end: new Date(Date.parse(start) + 130000).toISOString(), kind: 'hidden' }],
    },
    Training: { block1Seconds: 360, block2Seconds: 360, block3Seconds: 210.5 },
    State: { maxStage: 3, maxLevel: 4, stages: { '1': 5, '2': 4, '3': 2 } },
    Crystal: { total: 11, byStage: [5, 4, 2] },
    Levels: [
      { stage: 1, level: 1, passed: true, seconds: 40 }, { stage: 1, level: 2, passed: true, seconds: 52 },
      { stage: 1, level: 3, passed: true, seconds: 61 }, { stage: 1, level: 4, passed: true, seconds: 70 },
      { stage: 1, level: 5, passed: true, seconds: 66 }, { stage: 2, level: 1, passed: true, seconds: 55 },
      { stage: 3, level: 2, passed: false, seconds: 30, reason: 'block_timeout' },
    ],
    Story: [{ kind: 'intro', watched: true, skipped: false }],
    Followed: null,
    completed: true,
  }
}

;(async () => {
  console.log('\n[1] 健康检查与静态托管')
  let r = await req('GET', '/api/health')
  check(r.status === 200 && r.json.ok, `GET /api/health → ${r.status}`)
  r = await req('GET', '/')
  check(r.status === 200 && r.text.includes('幸运熊猫'), `GET / → ${r.status}`)
  r = await req('GET', '/play/')
  check(r.status === 200 && r.text.includes('gameCanvas'), `GET /play/ → ${r.status}`)
  r = await req('GET', '/api/admin/export/users.csv')
  check(r.status === 401, `未授权访问后台导出 → ${r.status}（应为 401）`)

  console.log('\n[2] 安全：敏感文件不可通过静态路径访问')
  for (const p of ['/email-config.json', '/server.js', '/data.json', '/package.json']) {
    r = await req('GET', p)
    check(r.status === 404, `GET ${p} → ${r.status}（应为 404）`)
  }

  console.log('\n[3] 注册与登录')
  const pid = '02' + String(Math.floor(Math.random() * 90) + 10)
  r = await req('POST', '/api/register', { participantId: pid, childName: '欧阳小宝', childGender: '男', childAge: 7, email: 'test@example.com' })
  check(r.status === 200 && r.json.token, `注册复姓「欧阳小宝」→ ${r.status}`)
  const userToken = r.json && r.json.token
  check(r.json.user && r.json.user.childSurname === '欧阳', `复姓拆分正确：姓=${r.json.user && r.json.user.childSurname} 名=${r.json.user && r.json.user.childGivenName}`)

  r = await req('POST', '/api/login', { credential: pid + '欧阳' })
  check(r.status === 200 && r.json.token, `登录 ${pid}欧阳 → ${r.status}`)
  r = await req('POST', '/api/login', { credential: pid + '李' })
  check(r.status === 401, `错误姓氏登录 → ${r.status}（应为 401）`)

  console.log('\n[4] 会话上报与统计')
  const log = sampleLog(600000) // 固定 sessionStart，用于验证幂等
  r = await req('POST', '/api/session', { log }, userToken)
  check(r.status === 200 && r.json.sessionId, `上报会话 → ${r.status}`)
  const sid = r.json.sessionId
  r = await req('POST', '/api/session', { log }, userToken)
  check(r.json.sessionId === sid, `重复上报幂等（同一 sessionId）→ ${r.json.sessionId}`)
  r = await req('GET', '/api/admin/sessions?limit=50', null, null)
  check(r.status === 401, `未授权访问会话列表 → ${r.status}（应为 401）`)

  r = await req('GET', '/api/me', null, userToken)
  check(r.status === 200 && r.json.stats.maxStage === 3, `GET /api/me → 到达阶段 ${r.json.stats && r.json.stats.maxStage}`)
  check(r.json.stats.crystalTotal === 11, `水晶总数 ${r.json.stats && r.json.stats.crystalTotal}（应为 11）`)
  check(Math.abs(r.json.stats.totalPlaySeconds - 930.5) < 0.2, `训练总时长 ${r.json.stats && r.json.stats.totalPlaySeconds}s（应为 930.5 = 360+360+210.5）`)

  r = await req('GET', '/api/my/sessions?limit=5', null, userToken)
  check(r.status === 200 && r.json.sessions.length === 1, `本人会话列表 → ${r.json.sessions.length} 条（重复上报未产生重复记录，应为 1）`)
  const s0 = r.json.sessions[0]
  check(s0.hiddenSeconds === 10, `切后台时长 ${s0.hiddenSeconds}s（应为 10）`)
  check(s0.storySeconds === 95, `故事动画时长 ${s0.storySeconds}s（应为 40+55=95）`)

  console.log('\n[5] 后台管理')
  r = await req('POST', '/api/admin/login', { username: 'admin', password: '123456' })
  check(r.status === 200 && r.json.token, `管理员登录 → ${r.status}`)
  const at = r.json.token
  r = await req('POST', '/api/admin/login', { username: 'admin', password: 'wrong' })
  check(r.status === 401, `管理员错误口令 → ${r.status}（应为 401）`)

  r = await req('GET', '/api/admin/overview', null, at)
  check(r.status === 200 && r.json.userCount >= 1, `总览：用户 ${r.json.userCount} / 会话 ${r.json.sessionCount} / 水晶 ${r.json.crystalTotal}`)
  r = await req('GET', '/api/admin/users', null, at)
  check(r.status === 200 && r.json.users.length >= 1, `用户列表 → ${r.json.users.length} 人`)
  r = await req('GET', '/api/admin/users/' + pid, null, at)
  check(r.status === 200 && r.json.daily.length >= 1, `用户详情：每日聚合 ${r.json.daily.length} 天`)
  r = await req('GET', '/api/admin/sessions?limit=50', null, at)
  check(r.status === 200 && r.json.sessions.length >= 1, `会话列表 → ${r.json.sessions.length} 条`)
  r = await req('GET', '/api/admin/daily?participantId=' + pid, null, at)
  check(r.status === 200 && r.json.daily.length >= 1, `每日聚合接口 → ${r.json.daily.length} 天`)

  console.log('\n[6] CSV 导出（UTF-8 BOM）')
  r = await req('GET', '/api/admin/export/users.csv', null, at)
  check(r.status === 200 && r.text.charCodeAt(0) === 0xFEFF, `users.csv → ${r.status}，BOM ${r.text.charCodeAt(0) === 0xFEFF ? '正确' : '缺失'}`)
  r = await req('GET', '/api/admin/export/sessions.csv', null, at)
  check(r.status === 200 && r.text.includes('第1阶段(秒)'), `sessions.csv → ${r.status}`)

  console.log('\n[7] 批量导入')
  r = await req('POST', '/api/admin/import-users', { rows: [
    { participantId: '0391', childName: '王小美', childGender: '女', childAge: 8, email: 'a@b.com' },
    { participantId: '03', childName: '坏数据', childGender: '男' },
    { participantId: '0391', childName: '重复号', childGender: '女' },
  ] }, at)
  check(r.status === 200 && r.json.created.length === 1 && r.json.errors.length === 2, `导入 3 行 → 成功 ${r.json.created.length}，失败 ${r.json.errors.length}`)

  console.log('\n[8] 邮件配置')
  r = await req('POST', '/api/admin/send-reminders', null, at)
  check(r.status === 200, `手动提醒接口 → ${r.status}（已配置邮箱）`)

  console.log('\n[9] 改/删用户（级联）')
  r = await req('PUT', '/api/admin/users/' + pid, { participantId: pid, childName: '欧阳大宝', childGender: '男', childAge: 7, email: 'test@example.com' }, at)
  check(r.status === 200 && r.json.user.childName === '欧阳大宝', `改名 → ${r.json.user && r.json.user.childName}`)
  r = await req('DELETE', '/api/admin/users/0391', null, at)
  check(r.status === 200, `删除用户 → ${r.status}`)
  r = await req('DELETE', '/api/admin/users/' + pid, null, at)
  check(r.status === 200, `清理测试用户 → ${r.status}`)

  console.log('\n' + (failures === 0 ? '全部通过 ✓' : failures + ' 项失败 ✗'))
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => { console.error('测试异常：', e); process.exit(1) })
