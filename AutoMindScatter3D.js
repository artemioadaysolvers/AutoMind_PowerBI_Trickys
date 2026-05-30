/*!
 * AutoMindScatter3D.js
 * Versión simple tipo ejemplo Three.js:
 * - Ejes negros tipo AxesHelper
 * - Labels pequeños
 * - Ticks pequeños
 * - Sin MathJax externo para evitar textos gigantes/deformados
 * - Compatible con Power BI wrapper: window.renderAutoMindScatter3D(...)
 */

(function () {
  "use strict";

  const VERSION = "1.0.12-SIMPLE_AXES";

  const THREE_URL = "https://unpkg.com/three@0.160.0/build/three.module.js";
  const ORBIT_URL = "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";

  const DEFAULT_LOGO_URL =
    "https://raw.githubusercontent.com/artemioadaysolvers/AutoMindCloudExperimental/main/AutoMindCloud/AutoMindCloud2.png";

  const PALETTE = [
    [0.90, 0.10, 0.25], // rojo
    [0.10, 0.30, 0.95], // azul
    [0.10, 0.65, 0.25], // verde
    [0.95, 0.45, 0.10], // naranjo
    [0.55, 0.10, 0.75], // morado
    [0.00, 0.65, 0.75],
    [0.90, 0.20, 0.80],
    [0.55, 0.75, 0.05],
    [0.50, 0.30, 0.10],
    [0.00, 0.45, 0.45]
  ];

  const HANDLES = new Map();
  let loaderPromise = null;

  function getContainer(containerOrId) {
    if (typeof containerOrId === "string") return document.getElementById(containerOrId);
    return containerOrId;
  }

  async function loadThree() {
    if (loaderPromise) return loaderPromise;

    loaderPromise = (async function () {
      const THREE = await import(THREE_URL);
      const mod = await import(ORBIT_URL);
      return { THREE, OrbitControls: mod.OrbitControls };
    })();

    return loaderPromise;
  }

  function toNumber(v, fallback = NaN) {
    if (v === null || v === undefined || v === "") return fallback;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function cleanLatexLabel(s) {
    s = String(s ?? "").trim();

    // Convierte cosas como \mathrm{Ventas\_Netas} a texto simple pequeño.
    s = s.replace(/^[$]/, "").replace(/[$]$/, "");
    s = s.replace(/\\mathrm\{([\s\S]*)\}/g, "$1");
    s = s.replace(/\\text\{([\s\S]*)\}/g, "$1");
    s = s.replace(/\\_/g, "_");
    s = s.replace(/\\%/g, "%");
    s = s.replace(/\\&/g, "&");
    s = s.replace(/\\#/g, "#");
    s = s.replace(/\\\$/g, "$");
    s = s.replace(/\\\{/g, "{").replace(/\\\}/g, "}");
    s = s.replace(/\\/g, "");
    return s || "campo";
  }

  function shortNumber(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "";

    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    if (a !== 0 && a < 0.01) return n.toExponential(1);
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2).replace(/\.?0+$/, "");
  }

  function makeCircleTexture(THREE) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 64, 64);
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function makeTextSprite(THREE, text, options = {}) {
    const fontSize = options.fontSize || 34;
    const color = options.color || "#000000";
    const bold = options.bold || false;
    const scale = options.scale || 0.45;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const font = `${bold ? "700" : "400"} ${fontSize}px Arial, Helvetica, sans-serif`;
    ctx.font = font;

    const padding = 18;
    const w = Math.ceil(ctx.measureText(text).width + padding * 2);
    const h = Math.ceil(fontSize * 1.55 + padding * 2);

    canvas.width = Math.max(96, w);
    canvas.height = Math.max(64, h);

    const c = canvas.getContext("2d");
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.font = font;
    c.fillStyle = color;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    const aspect = canvas.width / canvas.height;
    sprite.scale.set(scale * aspect, scale, 1);
    sprite.renderOrder = 999;

    return sprite;
  }

  function makeLine(THREE, a, b, color = 0x000000) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const m = new THREE.LineBasicMaterial({ color });
    return new THREE.Line(g, m);
  }

  function makeArrowHead(THREE, position, direction, color = 0x000000, size = 0.28) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(size * 0.42, size, 24),
      new THREE.MeshBasicMaterial({ color })
    );

    const dir = direction.clone().normalize();
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cone.position.copy(position.clone().add(dir.clone().multiplyScalar(size * 0.45)));

    return cone;
  }

  function extent(values) {
    let min = Infinity;
    let max = -Infinity;

    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: -1, max: 1, range: 2 };
    }

    if (min === max) {
      min -= 1;
      max += 1;
    }

    return { min, max, range: max - min };
  }

  function niceTicks(min, max, n = 5) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [0];

    const raw = (max - min) / Math.max(1, n - 1);
    const pow = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
    const base = raw / pow;

    let step;
    if (base <= 1) step = 1 * pow;
    else if (base <= 2) step = 2 * pow;
    else if (base <= 5) step = 5 * pow;
    else step = 10 * pow;

    const start = Math.ceil(min / step) * step;
    const end = Math.floor(max / step) * step;

    const arr = [];
    for (let v = start; v <= end + step * 0.25; v += step) {
      arr.push(Math.abs(v) < step * 1e-8 ? 0 : v);
    }

    if (arr.length < 2) return [min, (min + max) / 2, max];
    return arr.slice(0, 7);
  }

  function parseCsv(text, delimiter = ",") {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const n = text[i + 1];

      if (c === '"' && quoted && n === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = !quoted;
      } else if (c === delimiter && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && n === "\n") i++;
        row.push(cell);
        cell = "";
        if (row.some(x => String(x).trim() !== "")) rows.push(row);
        row = [];
      } else {
        cell += c;
      }
    }

    row.push(cell);
    if (row.some(x => String(x).trim() !== "")) rows.push(row);
    if (!rows.length) return [];

    const headers = rows[0].map(h => String(h).trim());
    return rows.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = r[i] ?? "");
      return obj;
    });
  }

  function colorForCategory(category, map) {
    if (!map.has(category)) {
      map.set(category, PALETTE[map.size % PALETTE.length]);
    }
    return map.get(category);
  }

  function addBadge(container, options = {}) {
    if (options.showBadge === false) return;

    const badge = document.createElement("div");
    badge.style.position = "absolute";
    badge.style.right = (options.badgeRight ?? 12) + "px";
    badge.style.bottom = (options.badgeBottom ?? 12) + "px";
    badge.style.zIndex = "10";
    badge.style.display = "flex";
    badge.style.alignItems = "center";
    badge.style.gap = "8px";
    badge.style.pointerEvents = "none";

    const img = document.createElement("img");
    img.src = options.logoUrl || DEFAULT_LOGO_URL;
    img.style.width = (options.badgeSize ?? 70) + "px";
    img.style.height = (options.badgeSize ?? 70) + "px";
    img.style.objectFit = "contain";
    img.style.opacity = "0.9";
    badge.appendChild(img);

    if (options.showBadgeText === true) {
      const span = document.createElement("span");
      span.textContent = options.badgeText || "AutoMindCloud";
      span.style.color = "#31c7b7";
      span.style.fontSize = (options.badgeTextSize ?? 12) + "px";
      span.style.fontWeight = "700";
      span.style.fontFamily = "Arial, sans-serif";
      badge.appendChild(span);
    }

    container.appendChild(badge);
  }

  function clearContainer(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function destroyAutoMindScatter3D(containerOrId) {
    const container = getContainer(containerOrId);
    if (!container) return;

    const h = HANDLES.get(container);
    if (!h) return;

    try { cancelAnimationFrame(h.raf); } catch (e) {}
    try { h.controls.dispose(); } catch (e) {}
    try { h.renderer.dispose(); } catch (e) {}
    try { h.resizeObserver.disconnect(); } catch (e) {}

    HANDLES.delete(container);
  }

  async function renderAutoMindScatter3D(options = {}) {
    const container = getContainer(options.container || options.containerId || "viewer");
    if (!container) throw new Error("No se encontró el contenedor.");

    destroyAutoMindScatter3D(container);
    clearContainer(container);

    const computed = window.getComputedStyle(container);
    if (computed.position === "static") container.style.position = "relative";
    container.style.overflow = "hidden";
    container.style.background = options.background || "#ffffff";

    if (options.width) container.style.width = typeof options.width === "number" ? options.width + "px" : String(options.width);
    if (options.height) container.style.height = typeof options.height === "number" ? options.height + "px" : String(options.height);
    if (!container.style.height && container.clientHeight < 10) container.style.height = "500px";

    const { THREE, OrbitControls } = await loadThree();

    const xField = options.xField || "x";
    const yField = options.yField || "y";
    const zField = options.zField || "z";
    const categoryField = options.categoryField || "cluster";
    const sizeField = options.sizeField || "size";

    const rows = [];
    for (const r of (options.data || [])) {
      const x = toNumber(r[xField]);
      const y = toNumber(r[yField]);
      const z = toNumber(r[zField]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

      rows.push({
        x,
        y,
        z,
        category: String(r[categoryField] ?? "Cluster"),
        size: toNumber(r[sizeField], 5)
      });
    }

    if (!rows.length) throw new Error("No hay datos 3D válidos.");

    const w = Math.max(1, container.clientWidth || 700);
    const h = Math.max(1, container.clientHeight || 500);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(options.background || 0xffffff);

    const camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 1000);
    camera.position.set(...(options.cameraPosition || [7, 7, 7]));

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = options.enableDamping !== false;
    controls.target.set(0, 0, 0);
    controls.update();

    const ex = extent(rows.map(r => r.x));
    const ey = extent(rows.map(r => r.y));
    const ez = extent(rows.map(r => r.z));

    const globalMax = Math.max(
      Math.abs(ex.min), Math.abs(ex.max),
      Math.abs(ey.min), Math.abs(ey.max),
      Math.abs(ez.min), Math.abs(ez.max)
    );

    const axisLen = options.axisLength ?? 4.0;
    const scale = globalMax > 0 ? axisLen / globalMax : 1;

    function P(x, y, z) {
      return new THREE.Vector3(x * scale, y * scale, z * scale);
    }

    // ---------- PUNTOS ----------
    const positions = [];
    const colors = [];
    const catMap = new Map();

    for (const r of rows) {
      const p = P(r.x, r.y, r.z);
      positions.push(p.x, p.y, p.z);

      const c = colorForCategory(r.category, catMap);
      colors.push(c[0], c[1], c[2]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: options.pointSize ?? 0.085,
      map: makeCircleTexture(THREE),
      transparent: true,
      opacity: options.pointOpacity ?? 0.85,
      vertexColors: true,
      depthWrite: false,
      sizeAttenuation: true
    });

    scene.add(new THREE.Points(geometry, material));

    // ---------- EJES NEGROS TIPO AXESHELPER ----------
    const axisColor = 0x000000;
    const o = new THREE.Vector3(0, 0, 0);

    const xEnd = new THREE.Vector3(axisLen, 0, 0);
    const yEnd = new THREE.Vector3(0, axisLen, 0);
    const zEnd = new THREE.Vector3(0, 0, axisLen);

    scene.add(makeLine(THREE, o, xEnd, axisColor));
    scene.add(makeLine(THREE, o, yEnd, axisColor));
    scene.add(makeLine(THREE, o, zEnd, axisColor));

    scene.add(makeArrowHead(THREE, xEnd, new THREE.Vector3(1, 0, 0), axisColor, 0.34));
    scene.add(makeArrowHead(THREE, yEnd, new THREE.Vector3(0, 1, 0), axisColor, 0.34));
    scene.add(makeArrowHead(THREE, zEnd, new THREE.Vector3(0, 0, 1), axisColor, 0.34));

    // Labels pequeños como el ejemplo, no gigantes.
    const xLabel = makeTextSprite(THREE, cleanLatexLabel(options.xLabelLatex || xField), { fontSize: 36, bold: true, scale: 0.38 });
    const yLabel = makeTextSprite(THREE, cleanLatexLabel(options.yLabelLatex || yField), { fontSize: 36, bold: true, scale: 0.38 });
    const zLabel = makeTextSprite(THREE, cleanLatexLabel(options.zLabelLatex || zField), { fontSize: 36, bold: true, scale: 0.38 });

    xLabel.position.set(axisLen + 0.45, -0.20, 0);
    yLabel.position.set(0.18, axisLen + 0.48, 0);
    zLabel.position.set(-0.25, 0.18, axisLen + 0.48);

    scene.add(xLabel);
    scene.add(yLabel);
    scene.add(zLabel);

    // ---------- TICKS PEQUEÑOS ----------
    const tickCount = options.tickCount ?? 4;
    const tickSize = 0.08;
    const tickLabelScale = 0.20;

    function addTicks(axis, ticks) {
      for (const t of ticks) {
        const v = t * scale;

        // Evita que el 0 ensucie el centro.
        if (Math.abs(v) < 1e-9) continue;

        let a, b, pos;

        if (axis === "x") {
          a = new THREE.Vector3(v, -tickSize, 0);
          b = new THREE.Vector3(v, tickSize, 0);
          pos = new THREE.Vector3(v, -0.28, 0);
        } else if (axis === "y") {
          a = new THREE.Vector3(-tickSize, v, 0);
          b = new THREE.Vector3(tickSize, v, 0);
          pos = new THREE.Vector3(-0.32, v, 0);
        } else {
          a = new THREE.Vector3(-tickSize, 0, v);
          b = new THREE.Vector3(tickSize, 0, v);
          pos = new THREE.Vector3(-0.32, 0, v);
        }

        scene.add(makeLine(THREE, a, b, axisColor));

        const label = makeTextSprite(THREE, shortNumber(t), {
          fontSize: 24,
          bold: false,
          scale: tickLabelScale
        });
        label.position.copy(pos);
        scene.add(label);
      }
    }

    addTicks("x", niceTicks(0, ex.max, tickCount));
    addTicks("y", niceTicks(0, ey.max, tickCount));
    addTicks("z", niceTicks(0, ez.max, tickCount));

    addBadge(container, {
      showBadge: options.showBadge,
      logoUrl: options.logoUrl,
      badgeSize: options.badgeSize ?? 70,
      badgeRight: options.badgeRight ?? 12,
      badgeBottom: options.badgeBottom ?? 12,
      showBadgeText: false
    });

    const resizeObserver = new ResizeObserver(() => {
      const nw = Math.max(1, container.clientWidth || w);
      const nh = Math.max(1, container.clientHeight || h);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    });
    resizeObserver.observe(container);

    let raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    const handle = {
      version: VERSION,
      scene,
      camera,
      renderer,
      controls,
      resizeObserver,
      raf
    };

    HANDLES.set(container, handle);
    return handle;
  }

  async function renderAutoMindScatter3DFromCsvUrl(options = {}) {
    const url = options.csvUrl || options.url;
    if (!url) throw new Error("Falta csvUrl.");

    const res = await fetch(url, { cache: options.cache || "no-cache" });
    if (!res.ok) throw new Error("No se pudo cargar CSV: " + res.status);

    const text = await res.text();
    const data = parseCsv(text, options.delimiter || ",");

    return renderAutoMindScatter3D(Object.assign({}, options, { data }));
  }

  window.AutoMindScatter3D = {
    version: VERSION,
    render: renderAutoMindScatter3D,
    renderFromCsvUrl: renderAutoMindScatter3DFromCsvUrl,
    destroy: destroyAutoMindScatter3D,
    parseCsv
  };

  window.renderAutoMindScatter3D = renderAutoMindScatter3D;
  window.renderAutoMindScatter3DFromCsvUrl = renderAutoMindScatter3DFromCsvUrl;
  window.destroyAutoMindScatter3D = destroyAutoMindScatter3D;
})();
