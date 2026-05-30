/*!
 * AutoMindScatter3D.js
 * v1.0.14 - HTML LaTeX Axis Labels Fix
 *
 * Correcciones:
 * - Los labels de ejes ya no se dibujan como sprites 3D borrosos/gigantes.
 * - Los nombres de ejes se renderizan como HTML estilo LaTeX, sobrepuesto y nítido.
 * - \mathrm{z} se ve como z, no como texto literal.
 * - Se eliminan los ticks con valor 0.
 * - El badge muestra solamente la imagen, sin texto AutoMindCloud duplicado.
 *
 * Funciones globales:
 *   window.renderAutoMindScatter3D(options)
 *   window.renderAutoMindScatter3DFromCsvUrl(options)
 *   window.destroyAutoMindScatter3D(containerOrId)
 */

(function () {
  "use strict";

  const VERSION = "1.0.14-HTML_LATEX_AXIS_FIX";

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

  function htmlEscape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function stripMathDelimiters(s) {
    s = String(s ?? "").trim();

    if (s.startsWith("$$") && s.endsWith("$$")) return s.slice(2, -2).trim();
    if (s.startsWith("$") && s.endsWith("$")) return s.slice(1, -1).trim();
    if (s.startsWith("\\(") && s.endsWith("\\)")) return s.slice(2, -2).trim();
    if (s.startsWith("\\[") && s.endsWith("\\]")) return s.slice(2, -2).trim();

    return s;
  }

  function findCommandArg(s, command) {
    const start = s.indexOf(command);
    if (start < 0) return null;

    const open = start + command.length;
    if (s[open] !== "{") return null;

    let depth = 0;
    let content = "";

    for (let i = open; i < s.length; i++) {
      const ch = s[i];

      if (ch === "{") {
        depth++;
        if (depth > 1) content += ch;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return {
            start,
            end: i + 1,
            content
          };
        }
        content += ch;
      } else {
        content += ch;
      }
    }

    return null;
  }

  function replaceCommandWithSpan(s, command, style) {
    let guard = 0;

    while (s.includes(command) && guard < 100) {
      guard++;
      const found = findCommandArg(s, command);
      if (!found) break;

      const inner = latexToHTML(found.content);
      const replacement = `<span style="${style}">${inner}</span>`;
      s = s.slice(0, found.start) + replacement + s.slice(found.end);
    }

    return s;
  }

  function replaceScriptsWithHTML(s) {
    // Subíndices con llaves: x_{t}
    s = s.replace(/_\{([^{}]+)\}/g, function (_, a) {
      return `<sub>${latexToHTML(a)}</sub>`;
    });

    // Superíndices con llaves: x^{2}
    s = s.replace(/\^\{([^{}]+)\}/g, function (_, a) {
      return `<sup>${latexToHTML(a)}</sup>`;
    });

    // Subíndices simples: x_t
    s = s.replace(/_([A-Za-z0-9+\-]+)/g, function (_, a) {
      return `<sub>${htmlEscape(a)}</sub>`;
    });

    // Superíndices simples: x^2
    s = s.replace(/\^([A-Za-z0-9+\-]+)/g, function (_, a) {
      return `<sup>${htmlEscape(a)}</sup>`;
    });

    return s;
  }

  function latexToHTML(input) {
    let s = stripMathDelimiters(input);
    if (!s) return "";

    // Primero escapamos HTML normal.
    s = htmlEscape(s);

    // Revertir escapes necesarios de LaTeX para poder detectar comandos.
    s = s
      .replace(/\\_/g, "_")
      .replace(/\\%/g, "%")
      .replace(/\\&/g, "&amp;")
      .replace(/\\#/g, "#")
      .replace(/\\\$/g, "$")
      .replace(/\\\{/g, "{")
      .replace(/\\\}/g, "}");

    // Comandos con argumentos.
    s = replaceCommandWithSpan(s, "\\mathrm", "font-style:normal;font-weight:400;");
    s = replaceCommandWithSpan(s, "\\text", "font-style:normal;font-weight:400;");
    s = replaceCommandWithSpan(s, "\\operatorname", "font-style:normal;font-weight:400;");
    s = replaceCommandWithSpan(s, "\\mathbf", "font-style:normal;font-weight:700;");
    s = replaceCommandWithSpan(s, "\\boldsymbol", "font-style:italic;font-weight:700;");
    s = replaceCommandWithSpan(s, "\\mathit", "font-style:italic;font-weight:400;");
    s = replaceCommandWithSpan(s, "\\mathsf", "font-style:normal;font-weight:400;");

    // Símbolos comunes.
    const replacements = [
      ["\\times", "×"],
      ["\\cdot", "·"],
      ["\\pm", "±"],
      ["\\mp", "∓"],
      ["\\leq", "≤"],
      ["\\geq", "≥"],
      ["\\neq", "≠"],
      ["\\approx", "≈"],
      ["\\infty", "∞"],
      ["\\alpha", "α"],
      ["\\beta", "β"],
      ["\\gamma", "γ"],
      ["\\delta", "δ"],
      ["\\epsilon", "ε"],
      ["\\theta", "θ"],
      ["\\lambda", "λ"],
      ["\\mu", "μ"],
      ["\\pi", "π"],
      ["\\rho", "ρ"],
      ["\\sigma", "σ"],
      ["\\phi", "φ"],
      ["\\omega", "ω"],
      ["\\Delta", "Δ"],
      ["\\Sigma", "Σ"],
      ["\\Omega", "Ω"]
    ];

    for (const [from, to] of replacements) {
      s = s.split(from).join(to);
    }

    s = replaceScriptsWithHTML(s);

    // Si queda un comando desconocido, remover solo el slash para no mostrar \literal.
    s = s.replace(/\\([A-Za-z]+)/g, "$1");

    // Quitar llaves sueltas.
    s = s.replace(/[{}]/g, "");

    return s;
  }

  function makeHTMLLabel(container, latex, options = {}) {
    const div = document.createElement("div");

    div.className = "automind-3d-html-label";
    div.innerHTML = latexToHTML(latex);

    div.style.position = "absolute";
    div.style.left = "0px";
    div.style.top = "0px";
    div.style.transform = "translate(-50%, -50%)";
    div.style.zIndex = String(options.zIndex ?? 8);
    div.style.pointerEvents = "none";
    div.style.color = options.color || "#000000";
    div.style.fontFamily = options.fontFamily || '"Times New Roman", "Cambria Math", Georgia, serif';
    div.style.fontSize = (options.fontSize ?? 13) + "px";
    div.style.fontWeight = options.fontWeight || "700";
    div.style.fontStyle = options.fontStyle || "italic";
    div.style.lineHeight = "1";
    div.style.whiteSpace = "nowrap";
    div.style.textShadow = options.textShadow || "0 0 1px rgba(255,255,255,0.95)";
    div.style.userSelect = "none";

    container.appendChild(div);

    return {
      element: div,
      world: options.world,
      xOffset: options.xOffset || 0,
      yOffset: options.yOffset || 0,
      hideBehindCamera: options.hideBehindCamera !== false
    };
  }

  function updateHTMLLabels(labels, camera, renderer) {
    const width = renderer.domElement.clientWidth || renderer.domElement.width || 1;
    const height = renderer.domElement.clientHeight || renderer.domElement.height || 1;

    for (const label of labels) {
      const p = label.world.clone();
      p.project(camera);

      const visible =
        p.z >= -1 &&
        p.z <= 1 &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y);

      if (!visible && label.hideBehindCamera) {
        label.element.style.display = "none";
        continue;
      }

      const x = (p.x * 0.5 + 0.5) * width + label.xOffset;
      const y = (-p.y * 0.5 + 0.5) * height + label.yOffset;

      label.element.style.display = "block";
      label.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
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

  function niceTicks(min, max, n = 4) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [];

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
      const val = Math.abs(v) < step * 1e-8 ? 0 : v;
      if (Math.abs(val) > step * 1e-8) arr.push(val); // saca los 0
    }

    return arr.slice(0, 6);
  }

  function formatTickLatex(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || Math.abs(n) < 1e-12) return "";

    const a = Math.abs(n);

    if (a >= 1e6) {
      const coeff = (n / 1e6).toFixed(1).replace(/\.0$/, "");
      return coeff + "\\times 10^{6}";
    }

    if (a >= 1e3) {
      const coeff = (n / 1e3).toFixed(1).replace(/\.0$/, "");
      return coeff + "\\times 10^{3}";
    }

    if (a !== 0 && a < 0.01) {
      const exp = n.toExponential(1);
      const parts = exp.split("e");
      const coeff = parts[0].replace(/\.0$/, "");
      const power = String(Number(parts[1]));
      return coeff + "\\times 10^{" + power + "}";
    }

    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2).replace(/\.?0+$/, "");
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
    badge.className = "automind-3d-badge-image-only";
    badge.style.position = "absolute";
    badge.style.right = (options.badgeRight ?? 12) + "px";
    badge.style.bottom = (options.badgeBottom ?? 12) + "px";
    badge.style.zIndex = "10";
    badge.style.display = "flex";
    badge.style.alignItems = "center";
    badge.style.justifyContent = "center";
    badge.style.pointerEvents = "none";

    const img = document.createElement("img");
    img.src = options.logoUrl || DEFAULT_LOGO_URL;
    img.alt = "AutoMindCloud";
    img.style.width = (options.badgeSize ?? 64) + "px";
    img.style.height = (options.badgeSize ?? 64) + "px";
    img.style.objectFit = "contain";
    img.style.opacity = "0.92";

    badge.appendChild(img);

    // No se agrega texto. Solo imagen.
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

    // ---------- EJES NEGROS ----------
    const axisColor = 0x000000;
    const o = new THREE.Vector3(0, 0, 0);

    const xEnd = new THREE.Vector3(axisLen, 0, 0);
    const yEnd = new THREE.Vector3(0, axisLen, 0);
    const zEnd = new THREE.Vector3(0, 0, axisLen);

    scene.add(makeLine(THREE, o, xEnd, axisColor));
    scene.add(makeLine(THREE, o, yEnd, axisColor));
    scene.add(makeLine(THREE, o, zEnd, axisColor));

    scene.add(makeArrowHead(THREE, xEnd, new THREE.Vector3(1, 0, 0), axisColor, 0.30));
    scene.add(makeArrowHead(THREE, yEnd, new THREE.Vector3(0, 1, 0), axisColor, 0.30));
    scene.add(makeArrowHead(THREE, zEnd, new THREE.Vector3(0, 0, 1), axisColor, 0.30));

    // ---------- LABELS HTML NÍTIDOS ----------
    const htmlLabels = [];

    htmlLabels.push(makeHTMLLabel(container, options.xLabelLatex || xField, {
      world: new THREE.Vector3(axisLen + 0.42, 0, 0),
      fontSize: options.axisLabelFontSize ?? 18,
      fontWeight: "700",
      fontStyle: "italic",
      xOffset: 0,
      yOffset: 0
    }));

    htmlLabels.push(makeHTMLLabel(container, options.yLabelLatex || yField, {
      world: new THREE.Vector3(0, axisLen + 0.42, 0),
      fontSize: options.axisLabelFontSize ?? 18,
      fontWeight: "700",
      fontStyle: "italic",
      xOffset: 0,
      yOffset: 0
    }));

    htmlLabels.push(makeHTMLLabel(container, options.zLabelLatex || zField, {
      world: new THREE.Vector3(0, 0, axisLen + 0.42),
      fontSize: options.axisLabelFontSize ?? 18,
      fontWeight: "700",
      fontStyle: "italic",
      xOffset: 0,
      yOffset: 0
    }));

    // ---------- TICKS SIN CEROS ----------
    const tickCount = options.tickCount ?? 4;
    const tickSize = 0.07;

    function addTicks(axis, ticks) {
      for (const t of ticks) {
        if (!Number.isFinite(t) || Math.abs(t) < 1e-12) continue;

        const v = t * scale;
        const latex = formatTickLatex(t);
        if (!latex || latex === "0") continue;

        let a, b, pos;

        if (axis === "x") {
          a = new THREE.Vector3(v, -tickSize, 0);
          b = new THREE.Vector3(v, tickSize, 0);
          pos = new THREE.Vector3(v, -0.23, 0);
        } else if (axis === "y") {
          a = new THREE.Vector3(-tickSize, v, 0);
          b = new THREE.Vector3(tickSize, v, 0);
          pos = new THREE.Vector3(-0.28, v, 0);
        } else {
          a = new THREE.Vector3(-tickSize, 0, v);
          b = new THREE.Vector3(tickSize, 0, v);
          pos = new THREE.Vector3(-0.28, 0, v);
        }

        scene.add(makeLine(THREE, a, b, axisColor));

        htmlLabels.push(makeHTMLLabel(container, latex, {
          world: pos,
          fontSize: options.tickFontSize ?? 10,
          fontWeight: "400",
          fontStyle: "normal",
          textShadow: "0 0 2px rgba(255,255,255,0.95)"
        }));
      }
    }

    // Medidas positivas tipo ejemplo, sin el 0.
    addTicks("x", niceTicks(0, Math.max(ex.max, 0), tickCount));
    addTicks("y", niceTicks(0, Math.max(ey.max, 0), tickCount));
    addTicks("z", niceTicks(0, Math.max(ez.max, 0), tickCount));

    addBadge(container, {
      showBadge: options.showBadge,
      logoUrl: options.logoUrl,
      badgeSize: options.badgeSize ?? 64,
      badgeRight: options.badgeRight ?? 12,
      badgeBottom: options.badgeBottom ?? 12
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
      updateHTMLLabels(htmlLabels, camera, renderer);
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
    parseCsv,
    latexToHTML
  };

  window.renderAutoMindScatter3D = renderAutoMindScatter3D;
  window.renderAutoMindScatter3DFromCsvUrl = renderAutoMindScatter3DFromCsvUrl;
  window.destroyAutoMindScatter3D = destroyAutoMindScatter3D;
})();
