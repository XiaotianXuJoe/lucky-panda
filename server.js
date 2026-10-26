/**
 * 幸運熊貓（ADHD 訓練版）靜態伺服器 + 實驗數據後端
 * 仿照 175.178.16.78:/home/ubuntu/tetris-web（方塊對照）實現，零依賴 Node HTTP。
 *
 * - 雙入口靜態託管：/  /login /register → public/index.html（SPA 殼）
 *                   /admin（302）/admin.html → public/admin.html（後臺）
 *                   /play                   → public/play/index.html（遊戲）
 * - 路徑白名單：只服務 public/ 內文件；server.js / data.json / email-config.json 一律 404
 * - /api/* 路由先於靜態文件匹配；數據持久化在 public 之外的 data.json（原子寫入）
 * - 登錄：4 位被試編號 + 兒童姓氏（無密碼）；Token = Bearer
 * - 後臺：用戶/會話/每日聚合/CSV 導出/批量導入/斷訓判定
 * - 提醒：零依賴 SMTP-over-TLS，72 小時未活動觸發，北京時間 09:00~09:29 自動窗口，冪等雙保險
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const tls = require('tls')

const PORT = Number(process.env.PORT || 8200)
const ROOT = path.join(__dirname, 'public')
const DATA_FILE = path.join(__dirname, 'data.json')
// 發件郵箱配置（public 之外，靜態白名單天然 404）
const EMAIL_CONFIG_FILE = path.join(__dirname, 'email-config.json')
const BODY_LIMIT = 5 * 1024 * 1024 // 5MB
const REMINDER_INTERVAL_MS = 72 * 3600 * 1000 // 3 天未訓練 / 距上次提醒的最小間隔
const SMTP_TIMEOUT_MS = 15 * 1000 // 單封郵件超時
const SITE_URL = process.env.SITE_URL || 'http://175.178.16.78:8200/'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

/* ---------------- 數據持久化（JSON 文件，原子寫入） ---------------- */

function emptyData() {
  return { users: {}, sessions: {}, userTokens: {}, adminTokens: {}, lastAutoReminderDate: null }
}

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    const d = JSON.parse(raw)
    const data = {
      users: d.users && typeof d.users === 'object' ? d.users : {},
      sessions: d.sessions && typeof d.sessions === 'object' ? d.sessions : {},
      userTokens: d.userTokens && typeof d.userTokens === 'object' ? d.userTokens : {},
      adminTokens: d.adminTokens && typeof d.adminTokens === 'object' ? d.adminTokens : {},
      // 自動提醒「今天已發過」雙保險之一（另一個是內存標記），重啟後也不重複發送
      lastAutoReminderDate: typeof d.lastAutoReminderDate === 'string' ? d.lastAutoReminderDate : null,
    }
    // 懶遷移：老記錄缺 childSurname 但有 childName 時拆分補齊
    let migrated = false
    for (const u of Object.values(data.users)) {
      if (!u || typeof u !== 'object') continue
      if (u.childSurname || !u.childName) continue
      const parts = splitChineseName(u.childName) || splitChineseNameFallback(u.childName)
      if (!parts) continue
      u.childSurname = parts.surname
      u.childGivenName = parts.given
      if (u.childAge === undefined) u.childAge = null
      migrated = true
    }
    if (migrated) saveData(data)
    return data
  } catch {
    return emptyData()
  }
}

function saveData(data) {
  const tmp = DATA_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, DATA_FILE) // 原子替換，避免半寫狀態
}

/* ---------------- 工具函數 ---------------- */

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(obj))
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let aborted = false
    req.on('data', (c) => {
      if (aborted) return
      size += c.length
      if (size > BODY_LIMIT) {
        aborted = true
        reject(httpError(413, '請求體過大（超過 5MB）'))
        return // 繼續排空數據但不緩衝，保證 413 響應能正常發出
      }
      chunks.push(c)
    })
    req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', (e) => { if (!aborted) reject(e) })
  })
}

async function readJsonBody(req) {
  const text = await readBody(req)
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw httpError(400, '請求體不是有效的 JSON')
  }
}

function bearerToken(req) {
  const h = req.headers['authorization'] || ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1].trim() : null
}

function newToken() {
  return crypto.randomBytes(24).toString('hex')
}

/* ---------------- 中文姓名拆分與欄位校驗 ---------------- */

// 常見複姓表（拆分全名時優先匹配前 2 字）
const COMPOUND_SURNAMES = new Set([
  '歐陽', '司馬', '諸葛', '上官', '夏侯', '皇甫', '尉遲', '公孫', '令狐', '宇文',
  '長孫', '慕容', '司徒', '鮮于', '閭丘', '子車', '亓官', '司寇', '巫馬', '公西',
  '顓孫', '壤駟', '公良', '漆雕', '樂正', '宰父', '穀梁', '拓跋', '夾谷', '軒轅',
  '百裡', '呼延', '東郭', '南門', '羊舌', '微生', '梁丘', '左丘', '西門', '第五',
  '公羊', '公冶', '太叔', '申屠', '濮陽', '單于', '完顏', '耶律', '赫連', '獨孤',
  '万俟', '聞人', '宗政', '公戶', '公玉', '公儀', '公仲', '公上', '公門', '公山',
  '公堅', '公伯', '公祖', '公乘', '貫丘', '公皙', '南榮', '東裡', '東宮', '仲長',
  '子書', '子桑', '即墨', '達奚', '褚師',
])

/** 拆分中文全名：前 2 字命中複姓表則姓=前2字，否則姓=第1字；不足 2 字或名為空返回 null */
function splitChineseName(fullName) {
  const name = String(fullName ?? '').trim()
  if (name.length < 2) return null
  let surname
  let given
  const first2 = name.slice(0, 2)
  if (COMPOUND_SURNAMES.has(first2)) {
    surname = first2
    given = name.slice(2)
  } else {
    surname = name.slice(0, 1)
    given = name.slice(1)
  }
  if (!given) return null
  return { surname, given }
}

/** 兜底拆分：第 1 字作姓、其餘作名 */
function splitChineseNameFallback(fullName) {
  const name = String(fullName ?? '').trim()
  if (name.length < 2) return null
  return { surname: name.slice(0, 1), given: name.slice(1) }
}

/** childAge：未提供 → null；否則須為 0~18 的數字 */
function normalizeChildAge(v) {
  if (v === undefined || v === null || v === '') return { ok: true, value: null }
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 18) return { ok: false }
  return { ok: true, value: n }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function publicUser(u) {
  return {
    participantId: u.participantId,
    childSurname: u.childSurname,
    childGivenName: u.childGivenName,
    childName: u.childName,
    childAge: u.childAge ?? null,
    childGender: u.childGender,
    email: u.email,
    registeredAt: u.registeredAt,
  }
}

function authUser(req, data) {
  const t = bearerToken(req)
  const pid = t ? data.userTokens[t] : null
  return pid && data.users[pid] ? pid : null
}

function authAdmin(req, data) {
  const t = bearerToken(req)
  return t && data.adminTokens[t] ? true : false
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const round1 = (v) => Math.round(v * 10) / 10

/* ---------------- 會話日誌統計（幸運熊貓口徑） ---------------- */

/**
 * 三段訓練時長求和（Training.block1/2/3Seconds 中非空值）。
 * 與方塊對照的 computeActiveSeconds 同構，但幸運熊貓以「三段各 6 分鐘」為準，
 * 故事動畫與切後臺時間不計入（前端只在 PLAY 狀態累加，且切後臺時寫 Time.pauses）。
 */
function computeActiveSeconds(log) {
  if (!log || typeof log !== 'object') return null
  const training = log.Training && typeof log.Training === 'object' ? log.Training : {}
  const blockVals = ['block1Seconds', 'block2Seconds', 'block3Seconds']
    .map((k) => training[k])
    .filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v)))
  if (blockVals.length > 0) {
    return Math.round(blockVals.reduce((a, v) => a + Number(v), 0) * 10) / 10
  }
  // 兜底：sessionEnd - sessionStart - rests - pauses
  const time = log.Time && typeof log.Time === 'object' ? log.Time : {}
  const startMs = Date.parse(time.sessionStart)
  const endMs = Date.parse(time.sessionEnd)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  let activeMs = endMs - startMs
  const subtract = (list) => {
    if (!Array.isArray(list)) return
    for (const iv of list) {
      if (!iv || typeof iv !== 'object') continue
      const s = Date.parse(iv.start)
      if (!Number.isFinite(s)) continue
      let e = Date.parse(iv.end)
      if (!Number.isFinite(e)) e = endMs
      if (e > s) activeMs -= e - s
    }
  }
  subtract(time.rests)
  subtract(time.pauses)
  if (activeMs < 0) activeMs = 0
  return Math.round(activeMs / 100) / 10
}

/** admin 讀取口徑：有完整 log 時實時重算，否則用存儲值兜底 */
function effectiveDurationSec(s) {
  if (s && s.log && typeof s.log === 'object') {
    const v = computeActiveSeconds(s.log)
    if (v != null) return v
  }
  return num(s && s.durationSec)
}

/** 區間總時長（秒），用於統計「故事動畫時長」「切後臺時長」 */
function intervalSeconds(list) {
  if (!Array.isArray(list)) return 0
  let ms = 0
  for (const iv of list) {
    if (!iv || typeof iv !== 'object') continue
    const s = Date.parse(iv.start)
    if (!Number.isFinite(s)) continue
    const e = Date.parse(iv.end)
    if (!Number.isFinite(e)) continue
    if (e > s) ms += e - s
  }
  return round1(ms / 1000)
}

/** 從 log 抽取幸運熊貓專屬匯總：到達階段/關卡、水晶總數、故事與切後臺時長 */
function pandaSummary(log) {
  const empty = {
    block1Seconds: 0, block2Seconds: 0, block3Seconds: 0,
    storySeconds: 0, hiddenSeconds: 0,
    maxStage: 0, maxLevel: 0, crystalTotal: 0, levelPassCount: 0, levelCount: 0,
  }
  if (!log || typeof log !== 'object') return empty
  const training = log.Training && typeof log.Training === 'object' ? log.Training : {}
  const time = log.Time && typeof log.Time === 'object' ? log.Time : {}
  const state = log.State && typeof log.State === 'object' ? log.State : {}
  const crystal = log.Crystal && typeof log.Crystal === 'object' ? log.Crystal : {}
  const levels = Array.isArray(log.Levels) ? log.Levels : []

  // 故事動畫按 kind 區分（rests 裡 kind==='story'），其餘 rests 也一併計入故事時長
  const storySec = intervalSeconds((time.rests || []).filter((r) => !r || r.kind !== 'manual'))
  const hiddenSec = intervalSeconds(time.pauses || [])

  let crystalTotal = num(crystal.total)
  if (!crystalTotal && Array.isArray(crystal.byStage)) {
    crystalTotal = crystal.byStage.reduce((a, v) => a + num(v), 0)
  }
  if (!crystalTotal) crystalTotal = levels.filter((l) => l && l.passed).length

  return {
    block1Seconds: round1(num(training.block1Seconds)),
    block2Seconds: round1(num(training.block2Seconds)),
    block3Seconds: round1(num(training.block3Seconds)),
    storySeconds: storySec,
    hiddenSeconds: hiddenSec,
    maxStage: num(state.maxStage),
    maxLevel: num(state.maxLevel),
    crystalTotal,
    levelPassCount: levels.filter((l) => l && l.passed).length,
    levelCount: levels.length,
  }
}

/** 根據 SessionLog 計算服務端匯總欄位（落庫時用） */
function summarizeLog(log) {
  const time = log && log.Time && typeof log.Time === 'object' ? log.Time : {}
  const sessionStart = typeof time.sessionStart === 'string' ? time.sessionStart : ''
  const sessionEnd = typeof time.sessionEnd === 'string' ? time.sessionEnd : ''
  const active = computeActiveSeconds(log)
  const p = pandaSummary(log)
  return {
    sessionStart,
    durationSec: active != null ? active : 0,
    completed: Boolean(sessionEnd && sessionEnd.trim()),
    maxStage: p.maxStage,
    maxLevel: p.maxLevel,
    crystalTotal: p.crystalTotal,
  }
}

function sessionIdFor(participantId, sessionStart) {
  if (!sessionStart) return crypto.randomBytes(12).toString('hex')
  return crypto.createHash('sha1').update(`${participantId}|${sessionStart}`).digest('hex').slice(0, 16)
}

function sessionSummary(s) {
  const p = pandaSummary(s.log)
  return {
    sessionId: s.sessionId,
    participantId: s.participantId,
    sessionStart: s.sessionStart,
    sessionEnd: s.log && s.log.Time ? s.log.Time.sessionEnd : null,
    durationSec: effectiveDurationSec(s),
    block1Seconds: p.block1Seconds,
    block2Seconds: p.block2Seconds,
    block3Seconds: p.block3Seconds,
    storySeconds: p.storySeconds,
    hiddenSeconds: p.hiddenSeconds,
    maxStage: p.maxStage,
    maxLevel: p.maxLevel,
    crystalTotal: p.crystalTotal,
    completed: s.completed,
    receivedAt: s.receivedAt,
  }
}

function userStats(data, participantId) {
  const list = Object.values(data.sessions).filter((s) => s.participantId === participantId)
  let totalPlaySeconds = 0
  let crystalTotal = 0
  let maxStage = 0
  let maxLevel = 0
  let lastPlayedAt = ''
  for (const s of list) {
    totalPlaySeconds += effectiveDurationSec(s)
    const p = pandaSummary(s.log)
    crystalTotal += p.crystalTotal
    if (p.maxStage > maxStage) maxStage = p.maxStage
    if (p.maxLevel > maxLevel) maxLevel = p.maxLevel
    const cand = s.sessionStart || s.receivedAt || ''
    if (cand && cand > lastPlayedAt) lastPlayedAt = cand
  }
  return {
    sessionCount: list.length,
    totalPlaySeconds: round1(totalPlaySeconds),
    lastPlayedAt,
    crystalTotal,
    maxStage,
    maxLevel,
  }
}

/** 按北京時間（UTC+8）日期聚合某用戶的每日訓練情況 */
function dailyDays(data, pid) {
  const byDay = new Map()
  for (const s of Object.values(data.sessions)) {
    if (s.participantId !== pid) continue
    const time = s.log && s.log.Time && typeof s.log.Time === 'object' ? s.log.Time : {}
    let startMs = Date.parse(time.sessionStart)
    if (!Number.isFinite(startMs)) startMs = Date.parse(s.receivedAt)
    if (!Number.isFinite(startMs)) continue
    const date = beijingParts(startMs).date
    let day = byDay.get(date)
    if (!day) {
      day = { date, block1Seconds: 0, block2Seconds: 0, block3Seconds: 0, totalSeconds: 0, storySeconds: 0, hiddenSeconds: 0, sessionCount: 0, crystalTotal: 0, maxStage: 0, maxLevel: 0 }
      byDay.set(date, day)
    }
    const p = pandaSummary(s.log)
    day.block1Seconds += p.block1Seconds
    day.block2Seconds += p.block2Seconds
    day.block3Seconds += p.block3Seconds
    day.storySeconds += p.storySeconds
    day.hiddenSeconds += p.hiddenSeconds
    day.totalSeconds += effectiveDurationSec(s)
    day.sessionCount += 1
    day.crystalTotal += p.crystalTotal
    if (p.maxStage > day.maxStage) day.maxStage = p.maxStage
    if (p.maxLevel > day.maxLevel) day.maxLevel = p.maxLevel
  }
  return [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      block1Seconds: round1(d.block1Seconds),
      block2Seconds: round1(d.block2Seconds),
      block3Seconds: round1(d.block3Seconds),
      totalSeconds: round1(d.totalSeconds),
      storySeconds: round1(d.storySeconds),
      hiddenSeconds: round1(d.hiddenSeconds),
      sessionCount: d.sessionCount,
      crystalTotal: d.crystalTotal,
      maxStage: d.maxStage,
      maxLevel: d.maxLevel,
    }))
}

/* ---------------- CSV 導出 ---------------- */

function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function sendCsv(res, filename, header, rows) {
  // 前綴 UTF-8 BOM，方便 Excel 直接打開不亂碼
  const csv = '\ufeff' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  })
  res.end(csv)
}

/** ISO → 北京時間字符串 YYYY-MM-DD HH:mm:ss */
function beijingStr(iso) {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms + 8 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

/* ---------------- 郵件提醒：配置加載 + 零依賴 SMTP-over-TLS 客戶端 ---------------- */

/**
 * 讀取 email-config.json：{ host, port, user, pass, fromName }
 * 文件不存在 / JSON 非法 / 必填欄位缺失 → null（未配置）；
 * 未配置時提醒相關接口返回 503，其餘功能不受影響。
 */
function loadEmailConfig() {
  try {
    const raw = fs.readFileSync(EMAIL_CONFIG_FILE, 'utf8')
    const c = JSON.parse(raw)
    const host = String(c.host || '').trim()
    const port = Number(c.port)
    const user = String(c.user || '').trim()
    const pass = String(c.pass || '')
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535 || !user || !pass) return null
    return { host, port, user, pass, fromName: String(c.fromName || '幸運熊貓實驗組').trim() || '幸運熊貓實驗組' }
  } catch {
    return null
  }
}

function b64utf8(s) {
  return Buffer.from(String(s), 'utf8').toString('base64')
}

/** RFC 2047 encoded-word：郵件頭中的中文（From 顯示名 / Subject）用 UTF-8 Base64 編碼 */
function encodeHeaderWord(s) {
  return '=?UTF-8?B?' + b64utf8(String(s).replace(/[\r\n]+/g, ' ')) + '?='
}

/** 組裝 RFC 5322 郵件原文：頭部 CRLF；正文統一 CRLF；行首點號按 SMTP 規範轉義 */
function buildMailMessage(cfg, { to, subject, text }) {
  const cleanTo = String(to).replace(/[\r\n]+/g, '')
  const headers = [
    `From: ${encodeHeaderWord(cfg.fromName)} <${cfg.user}>`,
    `To: <${cleanTo}>`,
    `Subject: ${encodeHeaderWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${crypto.randomBytes(8).toString('hex')}@lucky-panda>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
  ]
  const body = String(text)
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? '.' + line : line))
    .join('\r\n')
  return headers.join('\r\n') + '\r\n\r\n' + body
}

/**
 * 零依賴 SMTP-over-TLS 客戶端（Node 內置 tls）：
 * tls.connect → 220 greeting → EHLO → AUTH LOGIN（base64 分步）→
 * MAIL FROM → RCPT TO → DATA → 正文 + \r\n.\r\n → QUIT。
 * 正確解析多行響應（250- 續行 / 250 結束）；4xx/5xx 拋帶中文說明的錯誤；單封 15s 超時。
 */
function sendMail(cfg, { to, subject, text }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let buf = ''
    let curLines = []
    const waiters = [] // 響應等待隊列：每個 SMTP 命令對應一個
    const sock = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    sock.setEncoding('utf8')
    sock.setTimeout(SMTP_TIMEOUT_MS)

    const fail = (err) => {
      if (settled) return
      settled = true
      try { sock.destroy() } catch { /* ignore */ }
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    sock.on('timeout', () => fail(new Error('SMTP 連接超時（15 秒無響應）')))
    sock.on('error', (e) => fail(new Error(`SMTP 連接失敗（${cfg.host}:${cfg.port}）：${e.message || e}`)))
    sock.on('close', () => {
      if (!settled && waiters.length > 0) fail(new Error('SMTP 連接被伺服器意外關閉'))
    })
    sock.on('data', (chunk) => {
      buf += chunk
      let idx
      while ((idx = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const m = /^(\d{3})([ -])/.exec(line)
        if (!m) continue
        curLines.push(line)
        if (m[2] === '-') continue // 多行響應續行
        const w = waiters.shift()
        if (w) w({ code: Number(m[1]), lines: curLines })
        curLines = []
      }
    })

    const nextResponse = (okCodes, errMsg) => new Promise((res, rej) => {
      waiters.push((resp) => {
        if (okCodes.includes(resp.code)) res(resp)
        else rej(new Error(`${errMsg}（伺服器返回：${resp.lines[resp.lines.length - 1]}）`))
      })
    })

    ;(async () => {
      const authErr = 'SMTP 認證失敗，請檢查授權碼'
      await nextResponse([220], 'SMTP 服務握手失敗')
      sock.write('EHLO lucky-panda\r\n')
      await nextResponse([250], 'SMTP EHLO 失敗')
      sock.write('AUTH LOGIN\r\n')
      await nextResponse([334], authErr)
      sock.write(b64utf8(cfg.user) + '\r\n')
      await nextResponse([334], authErr)
      sock.write(b64utf8(cfg.pass) + '\r\n')
      await nextResponse([235], authErr)
      sock.write(`MAIL FROM:<${cfg.user}>\r\n`)
      await nextResponse([250], 'SMTP 發件地址被拒絕')
      sock.write(`RCPT TO:<${String(to).replace(/[\r\n]+/g, '')}>\r\n`)
      await nextResponse([250, 251], 'SMTP 收件地址被拒絕')
      sock.write('DATA\r\n')
      await nextResponse([354], 'SMTP 數據傳輸被拒絕')
      sock.write(buildMailMessage(cfg, { to, subject, text }) + '\r\n.\r\n')
      await nextResponse([250], 'SMTP 郵件發送被拒')
      sock.write('QUIT\r\n')
      settled = true
      sock.end()
      resolve()
    })().catch(fail)
  })
}

/* ---------------- 郵件提醒：判定、模板與自動定時 ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 單用戶提醒判定：
 * - daysInactive：距今（now - (lastPlayedAt || registeredAt)）的整數天數
 * - needsReminder：未訓練 >= 72h 且（從未提醒過 或 距上次提醒 >= 72h）
 */
function reminderInfo(data, u, nowMs) {
  const stats = userStats(data, u.participantId)
  const refMs = Date.parse(stats.lastPlayedAt || u.registeredAt || '')
  const daysInactive = Number.isFinite(refMs) ? Math.max(0, Math.floor((nowMs - refMs) / 86400000)) : 0
  const lastRemMs = Date.parse(u.lastReminderAt || '')
  const needsReminder = Number.isFinite(refMs) &&
    (nowMs - refMs) >= REMINDER_INTERVAL_MS &&
    (!Number.isFinite(lastRemMs) || (nowMs - lastRemMs) >= REMINDER_INTERVAL_MS)
  return { daysInactive, lastReminderAt: u.lastReminderAt || null, needsReminder }
}

/** 提醒郵件模板（需求原文：「請鼓勵小朋友按時參加，努力完成遊戲哦！」） */
function buildReminderMail(u, daysInactive) {
  return {
    subject: `【幸運熊貓】${u.childName}小朋友請繼續加油哦`,
    text:
      `您好！\n\n` +
      `${u.childName}小朋友已經 ${daysInactive} 天沒有進行訓練了。\n` +
      `請鼓勵小朋友按時參加，努力完成遊戲哦！\n\n` +
      `打開 ${SITE_URL} 即可開始。\n` +
      `登錄方式：輸入編號 ${u.participantId}（兩次）和兒童姓氏「${u.childSurname}」。\n\n` +
      `謝謝配合！\n幸運熊貓實驗組`,
  }
}

/** 北京時間（UTC+8）的小時/分鐘/日期串 */
function beijingParts(nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000)
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), date: d.toISOString().slice(0, 10) }
}

/** 自動發送窗口：北京時間 09:00~09:29 */
function inAutoReminderWindow(nowMs) {
  const b = beijingParts(nowMs)
  return b.hour === 9 && b.minute >= 0 && b.minute <= 29
}

let autoReminderDateMem = null // 內存標記：今天已自動發送過（與 data.json 的 lastAutoReminderDate 雙保險）

/** 逐封發送提醒（1s/封防頻控），成功才更新 lastReminderAt，單用戶失敗不影響其他人 */
async function sendRemindersToUsers(cfg, data, users, nowMs) {
  const sent = []
  const failed = []
  for (const u of users) {
    const info = reminderInfo(data, u, nowMs)
    const email = String(u.email || '').trim()
    if (!email) {
      failed.push({ participantId: u.participantId, childName: u.childName, email: '', reason: '未填寫郵箱' })
      continue
    }
    const mail = buildReminderMail(u, info.daysInactive)
    try {
      await sendMail(cfg, { to: email, subject: mail.subject, text: mail.text })
      u.lastReminderAt = new Date(nowMs).toISOString() // 僅成功才更新
      sent.push({ participantId: u.participantId, childName: u.childName, email })
    } catch (e) {
      failed.push({ participantId: u.participantId, childName: u.childName, email, reason: e.message || '發送失敗' })
    }
    await sleep(1000)
  }
  return { sent, failed }
}

/** 自動定時檢查：北京時間 09:00~09:29 且今天未發過 → 對全部 needsReminder 用戶發送 */
async function autoReminderTick() {
  try {
    const now = Date.now()
    if (!inAutoReminderWindow(now)) return
    const cfg = loadEmailConfig()
    if (!cfg) return
    const bj = beijingParts(now)
    const data = loadData()
    if (autoReminderDateMem === bj.date || data.lastAutoReminderDate === bj.date) {
      autoReminderDateMem = bj.date
      return
    }
    autoReminderDateMem = bj.date
    data.lastAutoReminderDate = bj.date // 先落盤，崩潰重啟今天也不重複
    const targets = Object.values(data.users).filter((u) => reminderInfo(data, u, now).needsReminder)
    console.log(`[email] 自動提醒（${bj.date}）：${targets.length} 位用戶待發送`)
    const { sent, failed } = await sendRemindersToUsers(cfg, data, targets, now)
    for (const f of failed) console.error(`[email] 提醒發送失敗 ${f.participantId}：${f.reason}`)
    saveData(data)
    console.log(`[email] 自動提醒完成：成功 ${sent.length}，失敗 ${failed.length}`)
  } catch (e) {
    console.error('[email] 自動提醒任務異常：', e)
  }
}

/* ---------------- API 路由 ---------------- */

/** 解析 /api/admin/users/<id> 形式的路徑參數 */
function pathArg(urlPath, prefix) {
  if (!urlPath.startsWith(prefix)) return null
  const rest = urlPath.slice(prefix.length)
  return rest.startsWith('/') ? decodeURIComponent(rest.slice(1)) : ''
}

async function handleApi(req, res, urlPath) {
  const data = loadData()
  const method = req.method || 'GET'

  // GET /api/health
  if (method === 'GET' && urlPath === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'lucky-panda', port: PORT, time: new Date().toISOString() })
    return
  }

  // GET /api/me  （用戶 token）
  if (method === 'GET' && urlPath === '/api/me') {
    const pid = authUser(req, data)
    if (!pid) throw httpError(401, '未登錄或登錄狀態無效')
    sendJson(res, 200, { ok: true, user: publicUser(data.users[pid]), stats: userStats(data, pid) })
    return
  }

  // （需求6）/api/my/sessions 已下線：唯一消費者是玩家端訓練記錄表，已隨首頁精簡移除；
  // 其餘玩家端與後臺接口全部保留（技術架構規格 Q3）。

  // POST /api/register
  if (method === 'POST' && urlPath === '/api/register') {
    const body = await readJsonBody(req)
    const participantId = String(body.participantId ?? '').trim()
    const childName = String(body.childName ?? '').trim()
    const childGender = String(body.childGender ?? '').trim()
    const email = String(body.email ?? '').trim()

    if (!/^\d{4}$/.test(participantId)) throw httpError(400, '編號必須是正好 4 位數字')
    if (data.users[participantId]) throw httpError(409, '該編號已註冊')
    if (!childName || !childGender) throw httpError(400, '請填寫完整信息（孩子姓名、孩子性別為必填）')
    const parts = splitChineseName(childName)
    if (!parts) throw httpError(400, '孩子姓名不正確（需為至少兩個字的中文全名）')
    if (childGender !== '男' && childGender !== '女') throw httpError(400, '孩子性別只能是「男」或「女」')
    if (email && !EMAIL_RE.test(email)) throw httpError(400, '郵箱格式不正確')
    const age = normalizeChildAge(body.childAge)
    if (!age.ok) throw httpError(400, '孩子年齡必須是 0~18 的數字')

    const user = {
      participantId,
      childSurname: parts.surname,
      childGivenName: parts.given,
      childName: parts.surname + parts.given,
      childAge: age.value,
      childGender,
      email,
      registeredAt: new Date().toISOString(),
      lastReminderAt: null,
    }
    const token = newToken()
    data.users[participantId] = user
    data.userTokens[token] = participantId
    saveData(data)
    sendJson(res, 200, { ok: true, token, user: publicUser(user) })
    return
  }

  // POST /api/login  credential 形如 "0101張"（4 位編號 + 兒童姓）
  if (method === 'POST' && urlPath === '/api/login') {
    const body = await readJsonBody(req)
    const credential = String(body.credential ?? '').trim()
    const m = /^(\d{4})(\S+)$/.exec(credential)
    const fail = () => { throw httpError(401, '編號或姓氏不正確') }
    if (!m) fail()
    const user = data.users[m[1]]
    if (!user || !user.childSurname || user.childSurname !== m[2]) fail()
    const token = newToken()
    data.userTokens[token] = user.participantId
    saveData(data)
    sendJson(res, 200, { ok: true, token, user: publicUser(user) })
    return
  }

  // POST /api/session  （用戶 token）上報一次完整訓練會話日誌
  if (method === 'POST' && urlPath === '/api/session') {
    const pid = authUser(req, data)
    if (!pid) throw httpError(401, '未登錄或登錄狀態無效')
    const body = await readJsonBody(req)
    const log = body.log
    if (!log || typeof log !== 'object' || Array.isArray(log)) throw httpError(400, '缺少會話數據（log）')

    // 需求8：測試會話（log.mode==='test'）返回 ok 但不寫 data.sessions
    // （第二道防線；第一道在前端 recorder.upload()，雙保險防測試數據汙染訓練集）
    if (log.mode === 'test') {
      sendJson(res, 200, { ok: true, test: true })
      return
    }

    const sum = summarizeLog(log)
    const sessionId = sessionIdFor(pid, sum.sessionStart)
    // upsert：同一用戶 + 相同 sessionStart 覆蓋舊記錄，不產生重複
    data.sessions[sessionId] = {
      sessionId,
      participantId: pid,
      sessionStart: sum.sessionStart,
      durationSec: sum.durationSec,
      maxStage: sum.maxStage,
      maxLevel: sum.maxLevel,
      crystalTotal: sum.crystalTotal,
      completed: sum.completed,
      receivedAt: new Date().toISOString(),
      log,
    }
    saveData(data)
    sendJson(res, 200, { ok: true, sessionId })
    return
  }

  // PUT /api/user/profile  （用戶 token）
  if (method === 'PUT' && urlPath === '/api/user/profile') {
    const pid = authUser(req, data)
    if (!pid) throw httpError(401, '未登錄或登錄狀態無效')
    const body = await readJsonBody(req)
    const childName = String(body.childName ?? '').trim()
    const childGender = String(body.childGender ?? '').trim()
    const email = String(body.email ?? '').trim()

    if (!childName || !childGender) throw httpError(400, '請填寫完整信息（孩子姓名、孩子性別為必填）')
    const parts = splitChineseName(childName)
    if (!parts) throw httpError(400, '孩子姓名不正確（需為至少兩個字的中文全名）')
    if (childGender !== '男' && childGender !== '女') throw httpError(400, '孩子性別只能是「男」或「女」')
    if (email && !EMAIL_RE.test(email)) throw httpError(400, '郵箱格式不正確')

    const user = data.users[pid]
    user.childSurname = parts.surname
    user.childGivenName = parts.given
    user.childName = parts.surname + parts.given
    if (body.childAge !== undefined) {
      const age = normalizeChildAge(body.childAge)
      if (!age.ok) throw httpError(400, '孩子年齡必須是 0~18 的數字')
      user.childAge = age.value
    }
    user.childGender = childGender
    if (email) user.email = email
    saveData(data)
    sendJson(res, 200, { ok: true, user: publicUser(user) })
    return
  }

  // POST /api/admin/login
  if (method === 'POST' && urlPath === '/api/admin/login') {
    const body = await readJsonBody(req)
    const adminUser = process.env.ADMIN_USER || 'admin'
    const adminPass = process.env.ADMIN_PASS || '123456'
    if (body.username !== adminUser || body.password !== adminPass) {
      throw httpError(401, '用戶名或密碼不正確')
    }
    const token = newToken()
    data.adminTokens[token] = true
    saveData(data)
    sendJson(res, 200, { ok: true, token })
    return
  }

  // 以下均為 admin 鑑權接口
  const isAdminRoute =
    urlPath === '/api/admin/overview' || urlPath === '/api/admin/import-users' ||
    urlPath === '/api/admin/send-reminders' || urlPath === '/api/admin/daily' ||
    urlPath.startsWith('/api/admin/users') || urlPath.startsWith('/api/admin/sessions') ||
    urlPath.startsWith('/api/admin/export/')

  if (isAdminRoute) {
    if (!authAdmin(req, data)) throw httpError(401, '未授權（需要管理員登錄）')

    // POST /api/admin/send-reminders  立即對全部 needsReminder 用戶發送提醒郵件
    if (method === 'POST' && urlPath === '/api/admin/send-reminders') {
      const cfg = loadEmailConfig()
      if (!cfg) throw httpError(503, '郵件服務未配置，請先在伺服器上配置發件郵箱')
      const now = Date.now()
      const targets = []
      let skipped = 0
      for (const u of Object.values(data.users)) {
        if (reminderInfo(data, u, now).needsReminder) targets.push(u)
        else skipped++
      }
      const { sent, failed } = await sendRemindersToUsers(cfg, data, targets, now)
      if (sent.length > 0) saveData(data)
      sendJson(res, 200, { ok: true, sent, failed, skipped })
      return
    }

    // GET /api/admin/overview
    if (method === 'GET' && urlPath === '/api/admin/overview') {
      const sessions = Object.values(data.sessions)
      const users = Object.values(data.users)
      const nowMs = Date.now()
      let totalSeconds = 0
      let crystalTotal = 0
      let completedCount = 0
      for (const s of sessions) {
        totalSeconds += effectiveDurationSec(s)
        crystalTotal += pandaSummary(s.log).crystalTotal
        if (s.completed) completedCount++
      }
      let needsReminder = 0
      for (const u of users) if (reminderInfo(data, u, nowMs).needsReminder) needsReminder++
      sendJson(res, 200, {
        ok: true,
        userCount: users.length,
        sessionCount: sessions.length,
        completedCount,
        totalPlaySeconds: round1(totalSeconds),
        crystalTotal,
        needsReminder,
        emailConfigured: Boolean(loadEmailConfig()),
      })
      return
    }

    // GET /api/admin/users  用戶列表（資料 + 統計 + 提醒狀態 三合一）
    if (method === 'GET' && urlPath === '/api/admin/users') {
      const nowMs = Date.now()
      const list = Object.values(data.users)
        .sort((a, b) => String(a.participantId).localeCompare(String(b.participantId)))
        .map((u) => ({
          ...publicUser(u),
          stats: userStats(data, u.participantId),
          reminder: reminderInfo(data, u, nowMs),
        }))
      sendJson(res, 200, { ok: true, users: list })
      return
    }

    // GET /api/admin/users/<id>  用戶詳情（含會話列表 + 每日聚合）
    if (method === 'GET' && urlPath.startsWith('/api/admin/users/')) {
      const pid = pathArg(urlPath, '/api/admin/users')
      const u = data.users[pid]
      if (!u) throw httpError(404, '用戶不存在')
      const sessions = Object.values(data.sessions)
        .filter((s) => s.participantId === pid)
        .sort((a, b) => String(b.sessionStart || '').localeCompare(String(a.sessionStart || '')))
        .map(sessionSummary)
      sendJson(res, 200, {
        ok: true,
        user: publicUser(u),
        stats: userStats(data, pid),
        reminder: reminderInfo(data, u, Date.now()),
        daily: dailyDays(data, pid),
        sessions,
      })
      return
    }

    // PUT /api/admin/users/<id>  改用戶（支持改編號，級聯同步 sessions 與 userTokens）
    if (method === 'PUT' && urlPath.startsWith('/api/admin/users/')) {
      const pid = pathArg(urlPath, '/api/admin/users')
      const u = data.users[pid]
      if (!u) throw httpError(404, '用戶不存在')
      const body = await readJsonBody(req)

      let newPid = String(body.participantId ?? pid).trim()
      if (newPid !== pid) {
        if (!/^\d{4}$/.test(newPid)) throw httpError(400, '編號必須是正好 4 位數字')
        if (data.users[newPid]) throw httpError(409, '該編號已存在')
      }
      const childName = String(body.childName ?? u.childName).trim()
      const parts = splitChineseName(childName)
      if (!parts) throw httpError(400, '孩子姓名不正確（需為至少兩個字的中文全名）')
      const childGender = String(body.childGender ?? u.childGender).trim()
      if (childGender !== '男' && childGender !== '女') throw httpError(400, '孩子性別只能是「男」或「女」')
      const email = String(body.email ?? u.email ?? '').trim()
      if (email && !EMAIL_RE.test(email)) throw httpError(400, '郵箱格式不正確')
      const age = normalizeChildAge(body.childAge === undefined ? u.childAge : body.childAge)
      if (!age.ok) throw httpError(400, '孩子年齡必須是 0~18 的數字')

      u.childSurname = parts.surname
      u.childGivenName = parts.given
      u.childName = parts.surname + parts.given
      u.childAge = age.value
      u.childGender = childGender
      u.email = email

      if (newPid !== pid) {
        delete data.users[pid]
        data.users[newPid] = u
        u.participantId = newPid
        for (const s of Object.values(data.sessions)) {
          if (s.participantId === pid) s.participantId = newPid
        }
        for (const [t, p] of Object.entries(data.userTokens)) {
          if (p === pid) data.userTokens[t] = newPid // 登錄態不斷
        }
      }
      saveData(data)
      sendJson(res, 200, { ok: true, user: publicUser(u) })
      return
    }

    // DELETE /api/admin/users/<id>  刪用戶（級聯刪 sessions 與 userTokens）
    if (method === 'DELETE' && urlPath.startsWith('/api/admin/users/')) {
      const pid = pathArg(urlPath, '/api/admin/users')
      if (!data.users[pid]) throw httpError(404, '用戶不存在')
      delete data.users[pid]
      for (const [sid, s] of Object.entries(data.sessions)) {
        if (s.participantId === pid) delete data.sessions[sid]
      }
      for (const [t, p] of Object.entries(data.userTokens)) {
        if (p === pid) delete data.userTokens[t]
      }
      saveData(data)
      sendJson(res, 200, { ok: true })
      return
    }

    // POST /api/admin/import-users  批量導入（≤500 條/次，逐行校驗，合法入庫、非法逐行報原因）
    if (method === 'POST' && urlPath === '/api/admin/import-users') {
      const body = await readJsonBody(req)
      const rows = Array.isArray(body.rows) ? body.rows : []
      if (rows.length === 0) throw httpError(400, '沒有要導入的數據')
      if (rows.length > 500) throw httpError(400, '單次最多導入 500 條')

      const created = []
      const errors = []
      const seen = new Set()
      rows.forEach((r, i) => {
        const lineNo = i + 1
        const participantId = String(r.participantId ?? '').trim()
        const childName = String(r.childName ?? '').trim()
        const childGender = String(r.childGender ?? '').trim()
        const email = String(r.email ?? '').trim()
        if (!/^\d{4}$/.test(participantId)) { errors.push({ line: lineNo, reason: '編號必須是正好 4 位數字' }); return }
        if (data.users[participantId] || seen.has(participantId)) { errors.push({ line: lineNo, reason: `編號 ${participantId} 已存在` }); return }
        const parts = splitChineseName(childName)
        if (!parts) { errors.push({ line: lineNo, reason: '孩子姓名不正確（需至少兩個字的中文全名）' }); return }
        if (childGender !== '男' && childGender !== '女') { errors.push({ line: lineNo, reason: '孩子性別只能是「男」或「女」' }); return }
        if (email && !EMAIL_RE.test(email)) { errors.push({ line: lineNo, reason: '郵箱格式不正確' }); return }
        const age = normalizeChildAge(r.childAge)
        if (!age.ok) { errors.push({ line: lineNo, reason: '孩子年齡必須是 0~18 的數字' }); return }
        const user = {
          participantId,
          childSurname: parts.surname,
          childGivenName: parts.given,
          childName: parts.surname + parts.given,
          childAge: age.value,
          childGender,
          email,
          registeredAt: new Date().toISOString(),
          lastReminderAt: null,
        }
        data.users[participantId] = user
        seen.add(participantId)
        created.push(publicUser(user))
      })
      if (created.length > 0) saveData(data)
      sendJson(res, 200, { ok: true, created, errors })
      return
    }

    // GET /api/admin/sessions?participantId=xxxx  會話列表
    if (method === 'GET' && urlPath === '/api/admin/sessions') {
      const q = new URL(req.url, 'http://localhost').searchParams
      const pid = q.get('participantId')
      const limit = Math.min(Number(q.get('limit')) || 200, 2000)
      let list = Object.values(data.sessions)
      if (pid) list = list.filter((s) => s.participantId === pid)
      list = list.sort((a, b) => String(b.sessionStart || '').localeCompare(String(a.sessionStart || ''))).slice(0, limit)
      sendJson(res, 200, { ok: true, sessions: list.map(sessionSummary) })
      return
    }

    // GET /api/admin/daily?participantId=xxxx  按北京時間聚合的每日訓練
    if (method === 'GET' && urlPath === '/api/admin/daily') {
      const q = new URL(req.url, 'http://localhost').searchParams
      const pid = q.get('participantId')
      if (!pid) throw httpError(400, '缺少 participantId')
      if (!data.users[pid]) throw httpError(404, '用戶不存在')
      sendJson(res, 200, { ok: true, participantId: pid, daily: dailyDays(data, pid) })
      return
    }

    // GET /api/admin/export/users.csv
    if (method === 'GET' && urlPath === '/api/admin/export/users.csv') {
      const nowMs = Date.now()
      const header = ['編號', '兒童姓名', '姓', '名', '性別', '年齡', '家長郵箱', '註冊時間', '會話數', '總訓練時長(秒)', '水晶總數', '到達階段', '到達關卡', '最近訓練', '未訓練天數', '需提醒', '上次提醒時間']
      const rows = Object.values(data.users)
        .sort((a, b) => String(a.participantId).localeCompare(String(b.participantId)))
        .map((u) => {
          const st = userStats(data, u.participantId)
          const ri = reminderInfo(data, u, nowMs)
          return [
            u.participantId, u.childName, u.childSurname, u.childGivenName, u.childGender,
            u.childAge ?? '', u.email, beijingStr(u.registeredAt),
            st.sessionCount, st.totalPlaySeconds, st.crystalTotal, st.maxStage, st.maxLevel,
            beijingStr(st.lastPlayedAt), ri.daysInactive, ri.needsReminder ? '是' : '否', beijingStr(ri.lastReminderAt),
          ]
        })
      sendCsv(res, 'users.csv', header, rows)
      return
    }

    // GET /api/admin/export/sessions.csv
    if (method === 'GET' && urlPath === '/api/admin/export/sessions.csv') {
      const header = ['會話ID', '編號', '兒童姓名', '開始時間', '結束時間', '第1階段(秒)', '第2階段(秒)', '第3階段(秒)', '訓練總時長(秒)', '故事動畫(秒)', '切後臺(秒)', '到達階段', '到達關卡', '水晶數', '通過關卡數', '是否完成']
      const rows = Object.values(data.sessions)
        .sort((a, b) => String(a.sessionStart || '').localeCompare(String(b.sessionStart || '')))
        .map((s) => {
          const ss = sessionSummary(s)
          const u = data.users[s.participantId]
          const p = pandaSummary(s.log)
          return [
            s.sessionId, s.participantId, u ? u.childName : '', beijingStr(s.sessionStart), beijingStr(ss.sessionEnd),
            ss.block1Seconds, ss.block2Seconds, ss.block3Seconds, ss.durationSec,
            ss.storySeconds, ss.hiddenSeconds, ss.maxStage, ss.maxLevel, ss.crystalTotal,
            p.levelPassCount, s.completed ? '是' : '否',
          ]
        })
      sendCsv(res, 'sessions.csv', header, rows)
      return
    }

    throw httpError(404, '接口不存在')
  }

  throw httpError(404, '接口不存在')
}

/* ---------------- 靜態文件服務（雙入口） ---------------- */

function serveStatic(req, res, urlPath) {
  // /admin 是後臺入口的易記別名：重定向到真正的後臺頁 /admin.html。
  // 若走下方 SPA fallback 會落進前臺殼（public/index.html）——用戶看到「點後臺卻進了遊戲首頁」
  if (urlPath === '/admin' || urlPath === '/admin/') {
    res.writeHead(302, { Location: '/admin.html' })
    res.end()
    return
  }

  // 規範化並限制在 ROOT 內（防目錄穿越 = 白名單效果）
  let filePath = path.normalize(path.join(ROOT, urlPath))
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return
  }

  const isPlay = urlPath === '/play' || urlPath.startsWith('/play/')
  const isTest = urlPath === '/test' || urlPath.startsWith('/test/') // 需求8：QA 測試臺

  let stat = null
  try { stat = fs.statSync(filePath) } catch { /* fallthrough */ }
  if (stat && stat.isDirectory()) { filePath = path.join(filePath, 'index.html'); stat = null }
  if (!stat) {
    // SPA fallback：僅對「不含點號」的路徑段回退；
    // 任何形如 /.env、/x.json、/server.log 的請求一律 404（白名單嚴格化）
    const base = path.basename(urlPath)
    if (!base.includes('.')) {
      filePath = path.join(ROOT, isPlay ? 'play' : isTest ? 'test' : '', 'index.html')
    }
    try { stat = fs.statSync(filePath) } catch { res.writeHead(404); res.end('Not Found'); return }
  }

  const ext = path.extname(filePath).toLowerCase()
  const total = stat.size
  // 強 ETag（size + mtime）：內容一變 ETag 必變，可用於 If-None-Match / If-Range
  const etag = '"' + total.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"'

  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    ETag: etag,
    'Last-Modified': new Date(stat.mtimeMs).toUTCString(),
    'Accept-Ranges': 'bytes',
  }

  /* 條件請求：內容未變直接 304（不帶 body）。
   * 早先不返回任何校驗頭，瀏覽器拿不到新鮮度信息，每次都得整文件重下 ——
   * 這是故事動畫切換鏡頭卡頓的主因之一。現在可以緩存 + 每次校驗（命中 304 幾乎零流量），
   * 既讓切換秒開，又保證換了素材立刻生效。 */
  const inm = req.headers['if-none-match']
  const ims = req.headers['if-modified-since']
  let notModified = false
  if (inm) {
    notModified = inm.trim() === '*' || inm.split(',').some((t) => t.trim() === etag)
  } else if (ims) {
    const t = Date.parse(ims)
    notModified = Number.isFinite(t) && Math.floor(stat.mtimeMs / 1000) * 1000 <= t
  }
  if (notModified) { res.writeHead(304, headers); res.end(); return }

  // ---- HTTP Range 支持：視頻/音頻分片拉流必需（Safari/iOS 不接受 200 整文件流）----
  let range = req.headers.range
  // If-Range 與當前版本不符 → 忽略 Range 回整文件，避免內容已更新卻只拿到舊分片
  const ifRange = req.headers['if-range']
  if (range && ifRange) {
    const v = String(ifRange).trim()
    const t = Date.parse(v)
    const timeOk = Number.isFinite(t) && Math.floor(stat.mtimeMs / 1000) * 1000 <= t
    if (v !== etag && !timeOk) range = null
  }

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim())
    if (m) {
      let start = m[1] === '' ? null : parseInt(m[1], 10)
      let end = m[2] === '' ? null : parseInt(m[2], 10)
      if (start === null && end !== null) { start = Math.max(0, total - end); end = total - 1 } // bytes=-N：末尾 N 字節
      if (start === null) start = 0
      if (end === null || end >= total) end = total - 1
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + total, 'Accept-Ranges': 'bytes' }); res.end(); return
      }
      headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + total
      headers['Content-Length'] = String(end - start + 1)
      res.writeHead(206, headers)
      if (req.method === 'HEAD') { res.end(); return }
      fs.createReadStream(filePath, { start, end }).pipe(res)
      return
    }
  }

  headers['Content-Length'] = String(total)
  res.writeHead(200, headers)
  if (req.method === 'HEAD') { res.end(); return }
  fs.createReadStream(filePath).pipe(res)
}

/* ---------------- 入口 ---------------- */

const server = http.createServer((req, res) => {
  let urlPath
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  } catch {
    res.writeHead(400); res.end(); return
  }
  if (urlPath.includes('\0')) { res.writeHead(400); res.end(); return }

  // /api/* 路由優先於靜態文件處理
  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, urlPath).catch((err) => {
      if (res.headersSent) { res.end(); return }
      const status = Number.isInteger(err.status) ? err.status : 500
      if (status === 500) console.error('api error:', err)
      sendJson(res, status, { error: status === 500 ? '伺服器內部錯誤' : err.message })
    })
    return
  }

  serveStatic(req, res, urlPath)
})

// 每 30 分鐘檢查一次是否進入自動提醒窗口（北京時間 09:00~09:29）；啟動後 5s 也補一次檢查
setInterval(autoReminderTick, 30 * 60 * 1000).unref()

if (require.main === module) {
  const bootCfg = loadEmailConfig()
  console.log(bootCfg
    ? `[email] 郵件服務已配置（${bootCfg.user} via ${bootCfg.host}:${bootCfg.port}）`
    : '[email] 郵件服務未配置（缺少 email-config.json 或欄位不全），提醒功能不可用，其餘功能不受影響')
  server.listen(PORT, () => {
    console.log(`lucky-panda listening on :${PORT}, root=${ROOT}`)
    setTimeout(autoReminderTick, 5000).unref()
  })
}

module.exports = {
  loadEmailConfig, sendMail, buildMailMessage,
  reminderInfo, buildReminderMail, beijingParts, inAutoReminderWindow, autoReminderTick,
  splitChineseName, computeActiveSeconds, pandaSummary, summarizeLog, sessionIdFor,
  userStats, dailyDays, beijingStr,
}
