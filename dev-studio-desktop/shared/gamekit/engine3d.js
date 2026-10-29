/**
 * GameKit3D — a real (tiny) 3D renderer. Zero dependencies, canvas-2D based.
 *
 * This is the honest first layer of "AAA": actual 3D mathematics, not sprites
 * pretending. Perspective camera, 4x4 matrix pipeline, backface culling,
 * directional light + ambient, distance fog, painter's-algorithm depth sort
 * and near-plane rejection. It renders world-space quad/triangle faces built
 * by helpers like boxFaces(). Software-filled polygons keep it dependency-free
 * and headless-testable — the SAME code runs in the arcade, in scaffolded
 * user projects, and inside the VM test harness.
 *
 * Conventions: right-handed world (x east, y up, z south); camera looks down
 * its local -z; row-major m[16]; points transform as v' = M·v.
 */
(function (global) {
  'use strict';

  /* ---------------- Mat4 / Vec3 ---------------- */
  const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  function mul(a, b) { // a·b (apply b first)
    const o = new Array(16);
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
      }
    }
    return o;
  }

  function translation(x, y, z) {
    const m = ident(); m[3] = x; m[7] = y; m[11] = z; return m;
  }
  function rotX(a) {
    const c = Math.cos(a); const s = Math.sin(a); const m = ident();
    m[5] = c; m[6] = -s; m[9] = s; m[10] = c; return m;
  }
  function rotY(a) {
    const c = Math.cos(a); const s = Math.sin(a); const m = ident();
    m[0] = c; m[2] = s; m[8] = -s; m[10] = c; return m;
  }
  function rotZ(a) {
    const c = Math.cos(a); const s = Math.sin(a); const m = ident();
    m[0] = c; m[1] = -s; m[4] = s; m[5] = c; return m;
  }
  function perspective(fovDeg, aspect, near, far) {
    const f = 1 / Math.tan((fovDeg * Math.PI / 180) / 2);
    const m = new Array(16).fill(0);
    m[0] = f / aspect; m[5] = f;
    m[10] = (far + near) / (near - far); m[11] = (2 * far * near) / (near - far);
    m[14] = -1;
    return m;
  }
  function transformPoint(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
      m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
      m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
      m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15]
    ];
  }

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function norm(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  function viewMatrix(camera) {
    return mul(mul(rotX(camera.pitch || 0), rotY(camera.yaw || 0)),
      translation(-camera.pos[0], -camera.pos[1], -camera.pos[2]));
  }

  /* ---------------- projection ---------------- */
  function projectPoint(camera, p) {
    // world point -> screen px { x, y, depth } or null when not visible
    const v = transformPoint(viewMatrix(camera), p);
    if (v[2] > -camera.near) return null; // behind near plane
    const f = 1 / Math.tan((camera.fov * Math.PI / 180) / 2);
    const depth = -v[2];
    const sx = (f / camera.aspect) * (v[0] / depth);
    const sy = f * (v[1] / depth);
    if (sx < -1.6 || sx > 1.6 || sy < -1.6 || sy > 1.6) return null; // generous off-screen reject
    return { x: (sx * 0.5 + 0.5) * camera.width, y: (0.5 - sy * 0.5) * camera.height, depth };
  }

  /* ---------------- face helpers ---------------- */
  function boxFaces(x0, y0, z0, w, h, d, base) {
    const x1 = x0 + w; const y1 = y0 + h; const z1 = z0 + d;
    return [
      { verts: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], color: Math.min(1, base * 1.14) }, // top (+y)
      { verts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], color: base },                     // front (+z)
      { verts: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], color: base * 0.82 },               // back (-z)
      { verts: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], color: base * 0.9 },                // right (+x)
      { verts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], color: base * 0.74 }                // left (-x)
    ];
  }

  function groundFace(x0, z0, s, color) {
    return { verts: [[x0, 0, z0 + s], [x0 + s, 0, z0 + s], [x0 + s, 0, z0], [x0, 0, z0]], color };
  }

  function rotateFaceY(face, cx, cz, ang) {
    const c = Math.cos(ang); const s = Math.sin(ang);
    return {
      color: face.color,
      verts: face.verts.map((v) => {
        const dx = v[0] - cx; const dz = v[2] - cz;
        return [cx + dx * c - dz * s, v[1], cz + dx * s + dz * c];
      })
    };
  }

  /* ---------------- the renderer ---------------- */
  function renderScene(ctx, opts) {
    const camera = opts.camera;
    const faces = opts.faces || [];
    const light = norm(opts.light || [-0.45, 0.82, -0.38]); // direction TOWARD the sun
    const ambient = opts.ambient === undefined ? 0.34 : opts.ambient;
    const diffuse = opts.diffuse === undefined ? 0.82 : opts.diffuse;
    const fogNear = opts.fogNear === undefined ? 220 : opts.fogNear;
    const fogFar = opts.fogFar === undefined ? 950 : opts.fogFar;
    const fogColor = opts.fogColor || [11, 11, 11];
    const view = viewMatrix(camera);
    const f = 1 / Math.tan((camera.fov * Math.PI / 180) / 2);

    const drawList = [];
    let culled = 0;
    for (const face of faces) {
      const vs = face.verts;
      // world normal + outward test
      const n = norm(cross(sub(vs[1], vs[0]), sub(vs[2], vs[0])));
      const center = [
        vs.reduce((a, v) => a + v[0], 0) / vs.length,
        vs.reduce((a, v) => a + v[1], 0) / vs.length,
        vs.reduce((a, v) => a + v[2], 0) / vs.length
      ];
      const toCam = sub(camera.pos, center);
      if (dot(n, toCam) <= 0) { culled += 1; continue; } // backface
      const dist = Math.hypot(toCam[0], toCam[1], toCam[2]);
      if (dist > fogFar * 1.25) { culled += 1; continue; } // too far, pure fog anyway

      // transform + near-plane reject + project
      const pts = [];
      let depthSum = 0;
      let bad = false;
      for (const v of vs) {
        const t = transformPoint(view, v);
        if (t[2] > -camera.near) { bad = true; break; }
        const depth = -t[2];
        depthSum += depth;
        const sx = (f / camera.aspect) * (t[0] / depth);
        const sy = f * (t[1] / depth);
        pts.push([(sx * 0.5 + 0.5) * camera.width, (0.5 - sy * 0.5) * camera.height]);
      }
      if (bad) { culled += 1; continue; }

      // shading: lambert + ambient, then distance fog toward bg
      const lam = Math.max(0, dot(n, light));
      let shade = (face.color === undefined ? 0.6 : face.color) * (ambient + diffuse * lam);
      const fogT = Math.min(1, Math.max(0, (dist - fogNear) / Math.max(1, fogFar - fogNear)));
      const r = Math.round(Math.min(1, shade) * 255 * (1 - fogT) + fogColor[0] * fogT);
      const gg = Math.round(Math.min(1, shade) * 255 * (1 - fogT) + fogColor[1] * fogT);
      const b = Math.round(Math.min(1, shade) * 255 * (1 - fogT) + fogColor[2] * fogT);
      drawList.push({ pts, depth: depthSum / pts.length, fill: `rgb(${r},${gg},${b})` });
    }

    drawList.sort((a, b) => b.depth - a.depth); // painter: far first
    for (const d of drawList) {
      ctx.beginPath();
      ctx.moveTo(d.pts[0][0], d.pts[0][1]);
      for (let i = 1; i < d.pts.length; i += 1) ctx.lineTo(d.pts[i][0], d.pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = d.fill;
      ctx.fill();
      ctx.strokeStyle = d.fill; // kill antialias seams between quads
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    return { drawn: drawList.length, culled };
  }

  global.GameKit3D = {
    M4: { ident, mul, translation, rotX, rotY, rotZ, perspective, transformPoint },
    vec: { sub, cross, dot, norm },
    viewMatrix, projectPoint, renderScene,
    boxFaces, groundFace, rotateFaceY
  };
})(typeof window !== 'undefined' ? window : globalThis);
