/* 幸運熊貓 · 激勵音效（Web Audio 實時合成，零素材、零版權風險）
 *
 * ding()：答對「叮」——水晶穿對顏色 / 翻牌配對成功 / 箱子推上圓圈時調用。
 * 雙音小鐘聲（880Hz 主音 + 1318.5Hz 泛音，0.4s 指數衰減），短促明亮不刺耳。
 *
 * AudioContext 必須在用戶手勢裡 resume（iOS/微信策略）：
 * 加載閘門「開始冒險」按鈕會調 LPSfx.unlock()；之後任何時刻 ding() 都能出聲。
 * 與 #btnSound 開關聯動：setOff(true) 後全程靜音（偏好存 localStorage）。
 */
(function (global) {
  'use strict'

  var AC = null
  var OFF = false
  try { OFF = global.localStorage && localStorage.getItem('luckyPanda.soundOff') === '1' } catch (e) { OFF = false }

  function ctx() {
    if (!AC) {
      var Ctor = global.AudioContext || global.webkitAudioContext
      if (!Ctor) return null
      try { AC = new Ctor() } catch (e) { return null }
    }
    return AC
  }

  /** 在用戶手勢裡喚醒 AudioContext（閘門按鈕點擊時調用；此後無需再來） */
  function unlock() {
    var c = ctx()
    if (c && c.state === 'suspended') {
      try { c.resume() } catch (e) { /* ignore */ }
    }
  }

  /** 答對激勵音；env=true 時加一個更飽滿的完成感（可選，供預留） */
  function ding() {
    if (OFF) return
    var c = ctx()
    if (!c) return
    if (c.state === 'suspended') { try { c.resume() } catch (e) { } }
    var t = c.currentTime
    var notes = [[880, 0], [1318.5, 0.09]]
    for (var i = 0; i < notes.length; i++) {
      var o = c.createOscillator()
      var g = c.createGain()
      var start = t + notes[i][1]
      o.type = 'sine'
      o.frequency.value = notes[i][0]
      g.gain.setValueAtTime(0.0001, start)
      g.gain.exponentialRampToValueAtTime(0.2, start + 0.018)
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.4)
      o.connect(g)
      g.connect(c.destination)
      o.start(start)
      o.stop(start + 0.45)
    }
  }

  function setOff(v) { OFF = !!v }
  function isOff() { return OFF }

  global.LPSfx = { ding: ding, unlock: unlock, setOff: setOff, isOff: isOff }
})(window)
