// 深渊回廊 ABYSS CORRIDOR —— 纯代码 3D 无尽逃亡。
// 一切程序生成：石纹/眼睛 canvas 纹理、折线回廊、发光供品、雾里的红眼。
// 没有 Blame 的资产，没有外部文件（除 three.js 本体）。
(function () {
  'use strict';
  const TAU = Math.PI * 2;

  // ---------- 工具 ----------
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- 程序纹理 ----------
  function stoneTexture(seed, tint) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const r = mulberry(seed);
    x.fillStyle = tint.base; x.fillRect(0, 0, 128, 128);
    // 大块明暗斑
    for (let i = 0; i < 26; i++) {
      const g = x.createRadialGradient(r() * 128, r() * 128, 2, r() * 128, r() * 128, 12 + r() * 26);
      g.addColorStop(0, r() < 0.5 ? tint.dark : tint.light);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    }
    // 石砖缝：两排横缝 + 错位竖缝
    x.strokeStyle = tint.seam; x.lineWidth = 2;
    for (let row = 0; row < 4; row++) {
      const y = row * 32 + 31;
      x.beginPath(); x.moveTo(0, y); x.lineTo(128, y); x.stroke();
      const off = (row % 2) * 32;
      for (let col = 0; col < 4; col++) {
        const bx = off + col * 32 + 31;
        x.beginPath(); x.moveTo(bx, row * 32); x.lineTo(bx, y); x.stroke();
      }
    }
    // 噪点颗粒
    for (let i = 0; i < 900; i++) {
      x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.06)';
      x.fillRect(Math.floor(r() * 128), Math.floor(r() * 128), 1, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    return t;
  }

  function eyeTexture(iris) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, '#fff8ea'); g.addColorStop(0.42, iris); g.addColorStop(0.55, '#1a0505'); g.addColorStop(1, 'rgba(20,4,4,0)');
    x.fillStyle = g; x.beginPath(); x.ellipse(32, 32, 30, 20, 0, 0, TAU); x.fill();
    x.fillStyle = '#000'; x.beginPath(); x.ellipse(32, 32, 4.5, 13, 0, 0, TAU); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(24, 20, 3, 3);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    return t;
  }

  const TEX_WALL = stoneTexture(11, { base: '#2b332e', dark: 'rgba(8,14,12,0.55)', light: 'rgba(140,170,150,0.10)', seam: 'rgba(5,10,8,0.9)' });
  const TEX_FLOOR = stoneTexture(23, { base: '#232925', dark: 'rgba(4,8,7,0.6)', light: 'rgba(120,150,130,0.08)', seam: 'rgba(3,6,5,0.9)' });
  const TEX_CEIL = stoneTexture(37, { base: '#181d1a', dark: 'rgba(2,4,4,0.7)', light: 'rgba(90,110,100,0.06)', seam: 'rgba(2,4,3,0.9)' });
  const TEX_EYE_GOLD = eyeTexture('#c9a227');
  const TEX_EYE_RED = eyeTexture('#c11812');

  // ---------- 场景 ----------
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: false });
  renderer.setPixelRatio(1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 120);
  const fog = new THREE.FogExp2(0x020403, 0.075);
  scene.fog = fog;

  // 火把：玩家的点光源，会颤
  const torch = new THREE.PointLight(0xffb46a, 1.5, 16, 2);
  scene.add(torch);
  scene.add(new THREE.AmbientLight(0x1a2a24, 0.7));

  // ---------- 回廊生成 ----------
  const SEG_LEN = 10, HALL_W = 4, HALL_H = 3.6;
  const wallMat = new THREE.MeshLambertMaterial({ map: TEX_WALL });
  const floorMat = new THREE.MeshLambertMaterial({ map: TEX_FLOOR });
  const ceilMat = new THREE.MeshLambertMaterial({ map: TEX_CEIL });
  // 每段各自的贴图偏移量让接缝不同：克隆材质会贵，改为共享 + 世界坐标 UV 无从谈起，
  // 这里接受重复感，靠雾和眼睛打破节奏。

  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // N E S W（-z 朝北）
  const world = {
    segments: [],         // { cx, cz, dir, boxes:[Box3], group, eyes:[], orb, end }
    boxes: [],            // 所有走廊盒（碰撞）
    cursor: { x: 0, z: 0, dir: 0 },
    orbR: mulberry(777),
  };

  function hallBox(cx, cz, along, across, dir) {
    // 沿走廊方向长 along、横向 across 的世界 AABB（方向只会是正交的）
    const horiz = dir % 2 === 1;   // E/W
    return new THREE.Box3(
      new THREE.Vector3(cx - (horiz ? along : across) / 2, 0, cz - (horiz ? across : along) / 2),
      new THREE.Vector3(cx + (horiz ? along : across) / 2, HALL_H, cz + (horiz ? across : along) / 2)
    );
  }

  function buildSegment(prev) {
    const r = world.orbR;
    const dir = prev ? prev.dir : 0;
    const turn = prev && r() < 0.24 ? (r() < 0.5 ? 1 : 3) : 0;   // 左/右转
    const ndir = (dir + turn) % 4;
    const cx = prev ? prev.ex + DIRS[ndir][0] * SEG_LEN / 2 : 0;
    const cz = prev ? prev.ez + DIRS[ndir][1] * SEG_LEN / 2 : 0;
    const group = new THREE.Group();

    // 地板与天花板
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, SEG_LEN + 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    floor.rotation.z = ndir % 2 === 1 ? Math.PI / 2 : 0;
    group.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, SEG_LEN + 2), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, HALL_H, cz);
    ceil.rotation.z = ndir % 2 === 1 ? Math.PI / 2 : 0;
    group.add(ceil);

    // 两侧墙
    const side = ndir % 2 === 1 ? [0, 1] : [1, 0];   // 横向单位
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(SEG_LEN + 2, HALL_H), wallMat);
      wall.position.set(cx + side[0] * s * HALL_W / 2, HALL_H / 2, cz + side[1] * s * HALL_W / 2);
      wall.rotation.y = side[0] !== 0 ? (s > 0 ? -Math.PI / 2 : Math.PI / 2) : (s > 0 ? Math.PI : 0);
      group.add(wall);
    }

    const box = hallBox(cx, cz, SEG_LEN + 2, HALL_W + 0.2, ndir);
    scene.add(group);

    // 墙上的眼睛（越深越多）
    const eyes = [];
    const eyeCount = Math.floor(clamp(depth / 90, 0, 3) + (r() < 0.65 ? 1 : 0));
    for (let i = 0; i < eyeCount; i++) {
      const isRed = r() < 0.25 + clamp(depth / 600, 0, 0.5);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: isRed ? TEX_EYE_RED : TEX_EYE_GOLD, transparent: true, opacity: 0.9, depthWrite: false,
      }));
      const size = 0.34 + r() * 0.3;
      sp.scale.set(size, size * 0.62, 1);
      const side2 = r() < 0.5 ? -1 : 1;
      sp.position.set(
        cx + side[0] * side2 * (HALL_W / 2 - 0.06) + (r() - 0.5) * 3,
        1.3 + r() * 1.6,
        cz + side[1] * side2 * (HALL_W / 2 - 0.06) + (r() - 0.5) * 3
      );
      sp.userData = { blink: 1 + r() * 6, bt: 0, phase: r() * TAU };
      group.add(sp);
      eyes.push(sp);
    }

    // 供品眼球（发光悬浮）
    let orb = null;
    if (!prev || r() < 0.8) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x86e8b0 })
      );
      g.add(core);
      const halo = new THREE.PointLight(0x4fff9a, 0.55, 4.5, 2);
      g.add(halo);
      g.position.set(cx + (r() - 0.5) * (HALL_W - 1.4), 1.0 + r() * 0.8, cz + (r() - 0.5) * (SEG_LEN - 3));
      scene.add(g);
      orb = { group: g, taken: false, bob: r() * TAU };
    }

    const seg = {
      cx, cz, dir: ndir, box, group, eyes, orb,
      ex: cx + DIRS[ndir][0] * SEG_LEN / 2,
      ez: cz + DIRS[ndir][1] * SEG_LEN / 2,
    };
    world.segments.push(seg);
    world.boxes.push(box);
    world.cursor = { x: seg.ex, z: seg.ez, dir: ndir };
    return seg;
  }

  let depth = 0;
  function ensureAhead(pos) {
    // 保证玩家前方至少 6 段、清理身后 2 段外的
    const last = world.segments[world.segments.length - 1];
    const nearEnd = Math.hypot(last.cx - pos.x, last.cz - pos.z) < (SEG_LEN * 4);
    if (nearEnd) {
      let prev = last;
      for (let i = 0; i < 2; i++) prev = buildSegment(prev);
    }
    while (world.segments.length > 9) {
      const dead = world.segments.shift();
      scene.remove(dead.group);
      if (dead.orb) scene.remove(dead.orb.group);
      world.boxes.shift();
    }
  }

  // ---------- 追逐者 ----------
  const pursuer = new THREE.Group();
  {
    const blob = (r, c) => new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: c }));
    const body = blob(1.7, 0x020403); body.position.y = 1.5; pursuer.add(body);
    const head = blob(1.1, 0x030605); head.position.set(0, 2.9, 0.3); pursuer.add(head);
    for (const s of [-1, 1]) {
      const limb = blob(0.8, 0x020403);
      limb.scale.set(1, 2.4, 1); limb.position.set(s * 1.3, 1.0, 0);
      pursuer.add(limb);
    }
  }
  const pEyes = [];
  for (const s of [-1, 1]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX_EYE_RED, transparent: true, depthWrite: false }));
    sp.scale.set(0.55, 0.34, 1);
    sp.position.set(s * 0.42, 3.0, 1.28);
    pursuer.add(sp); pEyes.push(sp);
  }
  scene.add(pursuer);
  const chase = { dist: 46, base: 46 };   // 它到你的路径距离

  // ---------- 音频 ----------
  const A = { ok: false };
  A.init = function () {
    if (A.ok) return;
    try { A.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const ctx = A.ctx;
    A.master = ctx.createGain(); A.master.gain.value = +(localStorage.getItem('abyss_vol') ?? 0.8);
    const comp = ctx.createDynamicsCompressor();
    A.master.connect(comp); comp.connect(ctx.destination);
    A.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = A.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // 深渊底噪
    const droneG = ctx.createGain(); droneG.gain.value = 0.14;
    const droneF = ctx.createBiquadFilter(); droneF.type = 'lowpass'; droneF.frequency.value = 110; droneF.Q.value = 4;
    droneF.connect(droneG); droneG.connect(A.master);
    [38, 38.7].forEach(f => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.connect(droneF); o.start();
    });
    A.droneG = droneG;
    A.ok = true;
  };
  function tone(freq, dur, vol, type, slideTo) {
    if (!A.ok) return;
    const t = A.ctx.currentTime;
    const o = A.ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(A.master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noiseBurst(dur, freq, vol) {
    if (!A.ok) return;
    const t = A.ctx.currentTime;
    const src = A.ctx.createBufferSource(); src.buffer = A.noise; src.loop = true;
    const f = A.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t); src.stop(t + dur);
  }
  const sfx = {
    step: () => noiseBurst(0.09, 300 + Math.random() * 140, 0.06),
    pick: () => { tone(660, 0.35, 0.1, 'sine', 990); tone(1320, 0.22, 0.05); },
    heart: () => { tone(50, 0.14, 0.24, 'sine', 34); },
    growl: v => tone(46, 0.9, v, 'sawtooth', 30),
    death: () => { tone(40, 2.2, 0.4, 'sawtooth', 18); noiseBurst(1.4, 120, 0.3); },
  };

  // ---------- 输入 ----------
  const keys = {};
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.repeat) return;
    if (e.code === 'KeyP' || e.code === 'Escape') { setPause(state.mode === 'play'); return; }
    if ((e.code === 'Space' || e.code === 'Enter')) {
      if (state.mode === 'title' || (state.mode === 'dead' && performance.now() - deadAt > 800)) { start(); e.preventDefault(); return; }
      if (state.mode === 'pause') { setPause(false); e.preventDefault(); return; }
    }
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  const look = { yaw: 0, locked: false };
  const canvas = renderer.domElement;
  canvas.addEventListener('click', () => { if (state === 'play' && !look.locked && canvas.requestPointerLock) canvas.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => { look.locked = document.pointerLockElement === canvas; });
  document.addEventListener('mousemove', e => {
    if (!look.locked) return;
    look.yaw -= e.movementX * 0.0024;
  });
  // 触屏：左半屏虚拟摇杆移动，右半屏滑动转向
  const touch = { move: { id: null, x: 0, y: 0, dx: 0, dy: 0 }, turn: { id: null, lastX: 0 } };
  const touchL = document.getElementById('touchL'), touchR = document.getElementById('touchR');
  function bindTouch(el, isMove) {
    el.addEventListener('touchstart', e => {
      const t = e.changedTouches[0];
      if (isMove) touch.move = { id: t.identifier, x: t.clientX, y: t.clientY, dx: 0, dy: 0 };
      else touch.turn = { id: t.identifier, lastX: t.clientX };
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (isMove && t.identifier === touch.move.id) {
          touch.move.dx = clamp((t.clientX - touch.move.x) / 44, -1, 1);
          touch.move.dy = clamp((t.clientY - touch.move.y) / 44, -1, 1);
        } else if (!isMove && t.identifier === touch.turn.id) {
          look.yaw -= (t.clientX - touch.turn.lastX) * 0.006;
          touch.turn.lastX = t.clientX;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) {
        if (isMove && t.identifier === touch.move.id) touch.move.id = null;
        if (!isMove && t.identifier === touch.turn.id) touch.turn.id = null;
      }
    };
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }
  bindTouch(touchL, true); bindTouch(touchR, false);

  // ---------- 玩家与状态 ----------
  const player = { x: 0, z: 0, vx: 0, vz: 0, bob: 0, stepT: 0 };
  const state = { mode: 'title', san: 100, time: 0, heartT: 0, growlT: 0 };

  function insideCorridor(x, z, pad) {
    for (const b of world.boxes) {
      if (x > b.min.x + pad && x < b.max.x - pad && z > b.min.z + pad && z < b.max.z - pad) return true;
    }
    return false;
  }
  function movePlayer(dt) {
    let mx = 0, mz = 0;
    if (keys.KeyW || keys.ArrowUp) mz -= 1;
    if (keys.KeyS || keys.ArrowDown) mz += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    if (touch.move.id !== null) { mx += touch.move.dx; mz += touch.move.dy; }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const speed = 4.4;
    const sin = Math.sin(look.yaw), cos = Math.cos(look.yaw);
    // 相机 yaw：0 朝 -z；前进向量 = (-sin, -cos)
    const vx = (mx * cos - mz * sin) * speed;
    const vz = (-mx * sin - mz * cos) * speed;
    const nx = player.x + vx * dt, nz = player.z + vz * dt;
    const pad = 0.55;
    if (insideCorridor(nx, player.z, pad)) player.x = nx;
    if (insideCorridor(player.x, nz, pad)) player.z = nz;
    const moving = len > 0.1;
    if (moving) {
      depth += speed * dt * 0.5;                 // 深度按前进累计（保守计）
      player.stepT -= dt;
      if (player.stepT <= 0) { player.stepT = 0.42; sfx.step(); }
      player.bob += dt * 9;
    }
    return moving;
  }

  function updateChase(dt, moving) {
    // 它一直走：玩家移动时只缓慢逼近，停下/慢走时逼近更快
    const pressure = moving ? 0.55 : 2.1;
    const sanK = state.san < 30 ? 1.6 : 1;
    chase.dist -= dt * pressure * sanK;
    // 收集供品把它压回去一点（在 collect 里做）
    chase.dist = Math.min(chase.base + 6, chase.dist);
    if (chase.dist < 1.6) return die();
    // 追逐者位置：玩家身后 chase.dist 处（沿玩家反方向 + 噪声摆动）
    const wob = Math.sin(state.time * 0.7) * 2.2;
    const ang = Math.atan2(player.x, player.z) + Math.PI + wob * 0.04;
    pursuer.position.set(
      player.x + Math.sin(ang) * chase.dist * 0.5,
      0,
      player.z + Math.cos(ang) * chase.dist * 0.5
    );
    pursuer.lookAt(player.x, 0, player.z);
    const visible = chase.dist < 26;
    pursuer.visible = visible;
    pEyes.forEach(e => (e.material.opacity = visible ? clamp(1.4 - chase.dist / 22, 0.2, 1) : 0));
    // 逼近的低吼
    state.growlT -= dt;
    if (chase.dist < 16 && state.growlT <= 0) {
      state.growlT = clamp(chase.dist / 10, 0.5, 2.2);
      sfx.growl(clamp(0.34 - chase.dist / 60, 0.05, 0.3));
    }
  }

  function updateWorldObjects(dt) {
    for (const seg of world.segments) {
      for (const e of seg.eyes) {
        e.material.rotation = Math.sin(state.time * 0.5 + e.userData.phase) * 0.08;
        e.userData.blink -= dt;
        if (e.userData.blink < 0) { e.userData.bt = 0.18; e.userData.blink = 2 + Math.random() * 6; }
        if (e.userData.bt > 0) {
          e.userData.bt -= dt;
          e.scale.y = e.scale.x * 0.62 * Math.abs(e.userData.bt / 0.09 - 1);
        } else e.scale.y = e.scale.x * 0.62;
      }
      if (seg.orb && !seg.orb.taken) {
        seg.orb.group.position.y = 1.2 + Math.sin(state.time * 1.6 + seg.orb.bob) * 0.12;
        seg.orb.group.rotation.y += dt * 1.4;
        const dx = seg.orb.group.position.x - player.x, dz = seg.orb.group.position.z - player.z;
        if (dx * dx + dz * dz < 1.3) collectOrb(seg.orb);
      }
    }
  }

  function collectOrb(orb) {
    orb.taken = true;
    scene.remove(orb.group);
    state.san = clamp(state.san + 9, 0, 100);
    chase.dist = Math.min(chase.base, chase.dist + 4.5);
    sfx.pick();
  }

  function updateSan(dt) {
    state.san = clamp(state.san - dt * 0.5, 0, 100);
    const mad = 1 - state.san / 100;
    // 氛围随神智恶化
    fog.color.setRGB(0.008 + mad * 0.05, 0.016 - mad * 0.008, 0.012 - mad * 0.006);
    fog.density = 0.075 + mad * 0.03;
    document.getElementById('vig').style.background =
      `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) ${42 - mad * 14}%, rgba(${mad > 0.5 ? '20,0,0' : '0,0,0'},${0.85 + mad * 0.1}) 100%)`;
    torch.intensity = 1.5 + Math.sin(state.time * 11) * 0.12 + Math.sin(state.time * 3.7) * 0.1 - mad * 0.35;
    // 心跳
    if (state.san < 60) {
      state.heartT -= dt;
      if (state.heartT <= 0) {
        state.heartT = 0.55 + (state.san / 60) * 0.9;
        sfx.heart();
      }
    }
    // HUD
    const fill = document.getElementById('sanFill');
    fill.style.width = state.san + '%';
    fill.style.background = state.san > 55 ? '#3f5a2c' : state.san > 25 ? '#8a5a1c' : '#7a1414';
  }

  // ---------- 主循环 ----------
  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    state.time += dt;
    if (state.mode !== 'play') { renderer.render(scene, camera); return; }

    const moving = movePlayer(dt);
    ensureAhead(player);
    updateChase(dt, moving);
    if (state.mode !== 'play') return;
    updateWorldObjects(dt);
    updateSan(dt);

    // 相机：头部 bob + 火把跟随
    const bobY = Math.sin(player.bob) * 0.05;
    camera.position.set(player.x, 1.62 + bobY, player.z);
    camera.rotation.set(0, look.yaw, Math.sin(player.bob * 0.5) * 0.008);
    torch.position.set(player.x, 1.9, player.z);

    document.getElementById('depth').textContent = Math.floor(depth);
    renderer.render(scene, camera);
  }

  // ---------- 流程 ----------
  function reset() {
    // 清场重建
    for (const seg of world.segments) { scene.remove(seg.group); if (seg.orb) scene.remove(seg.orb.group); }
    world.segments = []; world.boxes = [];
    world.orbR = mulberry((Math.random() * 1e9) | 0);
    depth = 0;
    player.x = 0; player.z = 0; player.bob = 0; player.stepT = 0;
    look.yaw = 0;
    state.san = 100; state.time = 0; state.heartT = 0;
    chase.dist = chase.base;
    let prev = null;
    for (let i = 0; i < 8; i++) prev = buildSegment(prev);
    ensureAhead(player);
    // 标题画面也能看到回廊：相机先站进去
    camera.position.set(0, 1.62, 0);
    camera.rotation.set(0, 0, 0);
    torch.position.set(0, 1.9, 0);
  }
  function start() {
    A.init();
    if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
    reset();
    state.mode = 'play';
    document.getElementById('overlay').classList.add('hide');
    document.getElementById('death').classList.remove('show');
    document.getElementById('pause').classList.remove('show');
    if (canvas.requestPointerLock && matchMedia('(hover: hover) and (pointer: fine)').matches) {
      canvas.requestPointerLock();
    }
  }
  function die() {
    state.mode = 'dead';
    deadAt = performance.now();
    sfx.death();
    document.getElementById('finalDepth').textContent = Math.floor(depth);
    const best = Math.max(Math.floor(depth), +(localStorage.getItem('abyss_best') || 0));
    localStorage.setItem('abyss_best', best);
    document.getElementById('bestLine').innerHTML =
      (Math.floor(depth) >= best && depth > 0 ? '★ 最深纪录 <b>' + best + '</b> 米<br>' : '走过最深 <b>' + best + '</b> 米<br>');
    document.getElementById('death').classList.add('show');
    if (document.exitPointerLock) document.exitPointerLock();
  }

  // ---------- 屏息（暂停） ----------
  let deadAt = 0;
  function setPause(on) {
    if (on && state.mode === 'play') {
      state.mode = 'pause';
      if (A.ctx && A.ctx.state === 'running') A.ctx.suspend();
      document.getElementById('pause').classList.add('show');
      if (document.exitPointerLock) document.exitPointerLock();
    } else if (!on && state.mode === 'pause') {
      state.mode = 'play';
      if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
      document.getElementById('pause').classList.remove('show');
      last = performance.now();
      if (canvas.requestPointerLock && matchMedia('(hover: hover) and (pointer: fine)').matches) {
        canvas.requestPointerLock();
      }
    }
  }
  // 桌面：指针锁定被解除（点 ESC / 切窗）即屏息——逃亡不该有人看守你的窗口
  document.addEventListener('pointerlockchange', () => {
    if (state.mode === 'play' && !document.pointerLockElement && matchMedia('(hover: hover) and (pointer: fine)').matches) {
      setPause(true);
    }
  });
  window.addEventListener('blur', () => setPause(true));

  // 音量滑条：即时生效并持久化
  function initVolume() {
    const slider = document.getElementById('vol');
    slider.value = +(localStorage.getItem('abyss_vol') ?? 0.8);
    slider.addEventListener('input', () => {
      const v = +slider.value;
      if (A.ok) A.master.gain.value = v;
      localStorage.setItem('abyss_vol', v);
    });
  }
  initVolume();

  document.getElementById('btnStart').addEventListener('click', start);
  document.getElementById('btnAgain').addEventListener('click', start);
  document.getElementById('btnResume').addEventListener('click', () => setPause(false));
  document.getElementById('btnRestart').addEventListener('click', () => {
    document.getElementById('pause').classList.remove('show');
    if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
    start();
  });

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  reset();
  state.mode = 'title';
  requestAnimationFrame(loop);
})();
