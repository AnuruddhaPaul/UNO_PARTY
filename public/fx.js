'use strict';
// Confetti and sounds. Everything is drawn / synthesized on the phone, nothing is downloaded.
const FX = (() => {
  const lowMotion = () => localStorage.getItem('uno.fx') === 'low' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const soundOn = () => localStorage.getItem('uno.snd') !== 'off';

  // ---- confetti ----
  let canvas = null, ctx2 = null, parts = [], raf = 0;
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas'); canvas.id = 'fx';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:95';
    document.body.append(canvas); ctx2 = canvas.getContext('2d');
  }
  function resize() { const d = Math.min(window.devicePixelRatio || 1, 2); canvas.width = innerWidth * d; canvas.height = innerHeight * d; ctx2.setTransform(d, 0, 0, d, 0, 0); }
  function confetti(x = innerWidth / 2, y = innerHeight * 0.4, n = 110) {
    if (lowMotion()) return;
    ensureCanvas(); resize();
    const colors = ['#e53935', '#fdd835', '#2e9e4f', '#1e78e0', '#ffffff', '#ff7ad9', '#ffd23f'];
    for (let i = 0; i < Math.min(n, 140); i++) {
      const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 9;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, w: 5 + Math.random() * 6, h: 3 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[i % colors.length], life: 0, max: 110 + Math.random() * 60 });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    ctx2.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.life < p.max && p.y < innerHeight + 30);
    for (const p of parts) {
      p.life++; p.vy += 0.28; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx2.save(); ctx2.translate(p.x, p.y); ctx2.rotate(p.r); ctx2.globalAlpha = Math.min(1, (p.max - p.life) / 30);
      ctx2.fillStyle = p.c; ctx2.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx2.restore();
    }
    raf = parts.length ? requestAnimationFrame(tick) : 0;
    if (!parts.length) ctx2.clearRect(0, 0, innerWidth, innerHeight);
  }

  // ---- sounds ----
  let ac = null;
  const wake = () => { try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) { /* no audio */ } };
  document.addEventListener('pointerdown', wake, { passive: true });
  function tone(f, t0, dur, type = 'sine', vol = 0.12, slideTo = 0) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, ac.currentTime + t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + t0 + dur);
    g.gain.setValueAtTime(0.0001, ac.currentTime + t0); g.gain.exponentialRampToValueAtTime(vol, ac.currentTime + t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t0 + dur);
    o.connect(g).connect(ac.destination); o.start(ac.currentTime + t0); o.stop(ac.currentTime + t0 + dur + 0.02);
  }
  const SOUNDS = {
    play: () => { tone(520, 0, 0.07, 'triangle', 0.14, 300); },
    draw: () => { tone(260, 0, 0.12, 'sawtooth', 0.05, 620); },
    turn: () => { tone(660, 0, 0.09, 'sine', 0.12); tone(880, 0.09, 0.12, 'sine', 0.12); },
    uno: () => { tone(880, 0, 0.1, 'square', 0.07); tone(1175, 0.1, 0.18, 'square', 0.07); },
    bust: () => { tone(220, 0, 0.18, 'sawtooth', 0.12, 90); tone(150, 0.16, 0.25, 'sawtooth', 0.12, 60); },
    storm: () => { tone(110, 0, 0.4, 'sawtooth', 0.1, 50); tone(70, 0.05, 0.5, 'square', 0.06, 40); },
    reverse: () => { tone(400, 0, 0.1, 'triangle', 0.12, 800); tone(800, 0.1, 0.12, 'triangle', 0.1, 400); },
    shuffle: () => { for (let i = 0; i < 14; i++) tone(1400 + Math.random() * 900, i * 0.11, 0.05, 'square', 0.035); },
    win: () => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.2, 'triangle', 0.14)); },
  };
  function sound(name) { if (!soundOn() || !SOUNDS[name]) return; wake(); if (ac && ac.state === 'running') { try { SOUNDS[name](); } catch (e) { /* ignore */ } } }

  return { confetti, sound, lowMotion, soundOn };
})();
