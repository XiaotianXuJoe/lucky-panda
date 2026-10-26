/* 幸運熊貓 · 訓練會話記錄器
 *
 * 記錄口徑（對應實驗需求）：
 *   Time     —— 每次開始 / 暫停 / 結束的日期與時間
 *   State    —— 當前第幾階段（1/2/3）、第幾級（1-5）
 *   Training —— 三次遊戲各自運行時長
 *
 * 關鍵約束：
 *   - 動畫（故事）期間計時器暫停 → 記入 Time.rests
 *   - 切後臺不算訓練時間        → 記入 Time.pauses，且該段不累加
 *   - 計時基於真實時鐘（不依賴定時器累加），後臺標籤頁節流也不失真
 */
(function (global) {
  'use strict'

  var BLOCK_SECONDS = 6 * 60 // 每段遊戲 6 分鐘

  function nowIso() { return new Date().toISOString() }

  function Recorder() {
    this.log = {
      mode: 'train',
      Time: {
        sessionStart: nowIso(),
        sessionEnd: null,
        rests: [],   // 故事動畫區間（kind: 'story'）
        pauses: [],  // 切後臺 / 手動暫停區間（kind: 'hidden' | 'manual'）
      },
      Training: { block1Seconds: null, block2Seconds: null, block3Seconds: null },
      State: { maxStage: 0, maxLevel: 0, stages: {} },
      Crystal: { total: 0, byStage: [0, 0, 0] },
      Levels: [],
      Story: [],
      Followed: null, // 本實驗不涉及「跟隨推薦位置」指標，置空
      completed: false,
    }
    this._openPause = null
    this._openRest = null
    this._uploading = false
    this._blockLimitSec = null // null = 默認 6 分鐘；setBlockLimit() 覆蓋（需求8）
  }

  /**
   * 當前階段（1/2/3）的訓練秒數累加；僅在遊戲進行中調用。
   * ⚠️ 必須全精度累加：每幀 dt≈0.0167s，若每幀都四捨五入到 0.1s 會被舍成 0，導致總時長永遠為 0。
   * 四捨五入只在展示 / 上報口徑處做（服務端 pandaSummary 已統一 round 到 0.1s）。
   */
  Recorder.prototype.tick = function (stage, dtSeconds) {
    if (!stage || dtSeconds <= 0) return
    var key = 'block' + stage + 'Seconds'
    var cur = this.log.Training[key]
    this.log.Training[key] = (cur == null ? 0 : cur) + dtSeconds
  }

  Recorder.prototype.blockSeconds = function (stage) {
    var v = this.log.Training['block' + stage + 'Seconds']
    return v == null ? 0 : v
  }

  Recorder.prototype.blockDone = function (stage) {
    var limit = this._blockLimitSec == null ? BLOCK_SECONDS : this._blockLimitSec
    return this.blockSeconds(stage) >= limit
  }

  /** 需求8：覆蓋每段 6 分鐘閘門（分鐘）；<=0 視為無閘門（QA 逐關驗收不被自動推進打斷） */
  Recorder.prototype.setBlockLimit = function (minutes) {
    var m = Number(minutes)
    if (!Number.isFinite(m)) return
    this._blockLimitSec = m > 0 ? m * 60 : Infinity
  }

  /** 記錄到達的階段/關卡 */
  Recorder.prototype.reach = function (stage, level) {
    if (!stage) return
    var s = Number(stage)
    var l = Number(level) || 0
    if (s > (this.log.State.maxStage || 0)) this.log.State.maxStage = s
    if (l > (this.log.State.maxLevel || 0)) this.log.State.maxLevel = l
    var cur = this.log.State.stages[String(s)] || 0
    if (l > cur) this.log.State.stages[String(s)] = l
  }

  /** 通過一關 → 水晶 +1（不保底：未通過不加；同一階段同一關只計一次） */
  Recorder.prototype.passLevel = function (stage, level, seconds, steps) {
    stage = Number(stage); level = Number(level)
    var already = this.log.Levels.some(function (l) {
      return l.stage === stage && l.level === level && l.passed
    })
    if (!already) {
      this.log.Crystal.total += 1
      var idx = stage - 1
      if (idx >= 0 && idx < this.log.Crystal.byStage.length) {
        this.log.Crystal.byStage[idx] += 1
      }
    }
    var entry = {
      stage: stage, level: level, passed: true,
      start: nowIso(), end: nowIso(),
      seconds: Math.round((seconds || 0) * 10) / 10,
      steps: steps == null ? null : steps,
    }
    // 需求7：重複通過（到頂循環打第 5 關）只增欄位打標記，分析端可過濾；data.json 結構不變
    if (already) entry.repeat = true
    this.log.Levels.push(entry)
    this.reach(stage, level)
    return !already // 是否首次通過（用於是否新增水晶）
  }

  /** 關卡失敗 / 超時結束也記一筆（passed:false），不扣水晶 */
  Recorder.prototype.failLevel = function (stage, level, seconds, reason) {
    this.log.Levels.push({
      stage: Number(stage), level: Number(level), passed: false,
      start: nowIso(), end: nowIso(),
      seconds: Math.round((seconds || 0) * 10) / 10,
      reason: reason || '',
    })
    this.reach(stage, level)
  }

  Recorder.prototype.story = function (kind, watched, skipped) {
    this.log.Story.push({ kind: kind, watched: !!watched, skipped: !!skipped, at: nowIso() })
  }

  /* ---------------- 暫停 / 休息區間 ---------------- */

  Recorder.prototype.openPause = function (kind) {
    if (this._openPause) return
    this._openPause = { start: nowIso(), end: null, kind: kind || 'hidden' }
    this.log.Time.pauses.push(this._openPause)
  }

  Recorder.prototype.closePause = function () {
    if (!this._openPause) return
    this._openPause.end = nowIso()
    this._openPause = null
  }

  Recorder.prototype.openRest = function (kind, stage) {
    if (this._openRest) this.closeRest()
    this._openRest = { start: nowIso(), end: null, kind: kind || 'story', stage: stage || 0 }
    this.log.Time.rests.push(this._openRest)
  }

  Recorder.prototype.closeRest = function () {
    if (!this._openRest) return
    this._openRest.end = nowIso()
    this._openRest = null
  }

  Recorder.prototype.finish = function () {
    this.closePause()
    this.closeRest()
    this.log.Time.sessionEnd = nowIso()
    this.log.completed = true
    return this.log
  }

  /* ---------------- 上報 ---------------- */

  /**
   * 上報會話日誌。final=true 時用 keepalive，保證關頁面也能發出。
   * 服務端按 sha1(participantId|sessionStart) 冪等 upsert，重複上報不產生重複記錄。
   */
  Recorder.prototype.upload = function (final) {
    // 需求8：測試會話不上報正式訓練集（第一道防線；服務端 /api/session 還有第二道）
    if (this.log.mode === 'test') return Promise.resolve(false)
    var self = this
    var token = ''
    try { token = localStorage.getItem('luckyPanda.userToken') || '' } catch { token = '' }
    if (!token) return Promise.resolve(false)
    if (this._uploading) return Promise.resolve(false)
    this._uploading = true
    var body = JSON.stringify({ log: this.log, final: !!final })
    return fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: body,
      keepalive: true,
    }).then(function (r) { return r.ok })
      .catch(function () { return false })
      .then(function (ok) { self._uploading = false; return ok })
  }

  Recorder.BLOCK_SECONDS = BLOCK_SECONDS
  global.Recorder = Recorder
})(window)
