/*!
 * AutoMindScatter3D.js
 * Standalone Three.js 3D scatter renderer for GitHub + jsDelivr.
 *
 * Global functions:
 *   window.renderAutoMindScatter3D(options)
 *   window.renderAutoMindScatter3DFromCsvUrl(options)
 *   window.destroyAutoMindScatter3D(containerOrId)
 *
 * Main namespace:
 *   window.AutoMindScatter3D
 */

(function () {
  "use strict";

  const VERSION = "1.0.0";

  const DEFAULT_LOGO_URL =
    "https://raw.githubusercontent.com/artemioadaysolvers/AutoMindCloudExperimental/main/AutoMindCloud/AutoMindCloud2.png";

  const DEFAULT_THREE_URL = "https://esm.sh/three@0.160.0";
  const DEFAULT_ORBIT_URL =
    "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js?deps=three@0.160.0";
  const DEFAULT_MATHJAX_URL =
    "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js";

  const DEFAULT_PALETTE = [
    "#E6194B", // rojo
    "#4363D8", // azul
    "#3CB44B", // verde
    "#F58231", // naranjo
    "#911EB4", // morado
    "#46F0F0",
    "#F032E6",
    "#BCF60C",
    "#FABEBE",
    "#008080",
    "#E6BEFF",
    "#9A6324"
  ];

  const RENDERERS = new Map();

  let threePromise = null;
  let mathJaxPromise = null;

  function getElement(containerOrId) {
    if (typeof containerOrId === "string") {
      return document.getElementById(containerOrId);
    }
    return containerOrId;
  }

  function safeNumber(value, fallback = NaN) {
    if (value === null || value === undefined || value === "") return fallback;
    const n = Number(String(value).replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function hexToRgb01(hex) {
    let h = String(hex || "").trim();
    if (!h) return [0.2, 0.2, 0.2];

    const named = {
      rojo: "#E6194B",
      red: "#E6194B",
      azul: "#4363D8",
      blue: "#4363D8",
      verde: "#3CB44B",
      green: "#3CB44B",
      naranjo: "#F58231",
      orange: "#F58231",
      morado: "#911EB4",
      purple: "#911EB4",
      negro: "#000000",
      black: "#000000"
    };

    h = named[h.toLowerCase()] || h;

    if (h[0] !== "#") return null;
    if (h.length === 4) {
      h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(h)) return null;

    return [
      parseInt(h.slice(1, 3), 16) / 255,
      parseInt(h.slice(3, 5), 16) / 255,
      parseInt(h.slice(5, 7), 16) / 255
    ];
  }

  function escapeLatexText(text) {
    return String(text ?? "")
      .replace(/\\/g, "\\textbackslash{}")
      .replace(/_/g, "\\_")
      .replace(/%/g, "\\%")
      .replace(/&/g, "\\&")
      .replace(/#/g, "\\#")
      .replace(/\$/g, "\\$")
      .replace(/\{/g, "\\{")
      .replace(/\}/g, "\\}");
  }

  function fieldNameToLatex(fieldName) {
    const raw = String(fieldName ?? "").trim();
    if (!raw) return "\\mathrm{Campo}";

    // Si el usuario ya manda LaTeX, se respeta.
    if (raw.includes("\\") || raw.includes("^") || raw.includes("_") || raw.startsWith("$")) {
      return raw.replace(/^\$/, "").replace(/\$$/, "");
    }

    return "\\mathrm{" + escapeLatexText(raw) + "}";
  }

  function formatNumberLatex(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "\\mathrm{NaN}";

    const abs = Math.abs(n);
    let s;

    if (abs > 0 && (abs >= 10000 || abs < 0.001)) {
      s = n.toExponential(1).replace("e", "\\times 10^{") + "}";
    } else if (Number.isInteger(n)) {
      s = String(n);
    } else {
      s = n.toFixed(digits);
      s = s.replace(/\.?0+$/, "");
    }

    return s.replace("-", "−");
  }

  async function loadThree(options = {}) {
    if (threePromise) return threePromise;

    const threeUrl = options.threeUrl || DEFAULT_THREE_URL;
    const orbitUrl = options.orbitControlsUrl || DEFAULT_ORBIT_URL;

    threePromise = (async () => {
      const THREE = await import(threeUrl);
      const controlsModule = await import(orbitUrl);
      return {
        THREE,
        OrbitControls: controlsModule.OrbitControls
      };
    })();

    return threePromise;
  }

  async function loadMathJax(url = DEFAULT_MATHJAX_URL) {
    if (window.MathJax && window.MathJax.tex2svgPromise) {
      return window.MathJax;
    }

    if (mathJaxPromise) return mathJaxPromise;

    mathJaxPromise = new Promise((resolve, reject) => {
      window.MathJax = window.MathJax || {
        tex: {
          inlineMath: [["$", "$"], ["\\(", "\\)"]]
        },
        svg: {
          fontCache: "none"
        },
        startup: {
          typeset: false
        }
      };

      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = async () => {
        try {
          if (window.MathJax?.startup?.promise) {
            await window.MathJax.startup.promise;
          }
          resolve(window.MathJax);
        } catch (err) {
          reject(err);
        }
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });

    return mathJaxPromise;
  }

  function makeCircleTexture(THREE) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 3;
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function makeFallbackLabelTexture(THREE, text, options = {}) {
    const {
      fontSize = 34,
      color = "#000000",
      background = "rgba(255,255,255,0)",
      padding = 12,
      fontFamily = "Georgia, Times New Roman, serif"
    } = options;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    ctx.font = `italic ${fontSize}px ${fontFamily}`;
    const width = Math.ceil(ctx.measureText(String(text)).width + padding * 2);
    const height = Math.ceil(fontSize * 1.7 + padding * 2);

    canvas.width = Math.max(64, width);
    canvas.height = Math.max(32, height);

    const ctx2 = canvas.getContext("2d");
    ctx2.clearRect(0, 0, canvas.width, canvas.height);
    ctx2.fillStyle = background;
    ctx2.fillRect(0, 0, canvas.width, canvas.height);

    ctx2.font = `italic ${fontSize}px ${fontFamily}`;
    ctx2.fillStyle = color;
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    ctx2.fillText(String(text), canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    return {
      texture,
      aspect: canvas.width / canvas.height
    };
  }

  async function makeLatexTexture(THREE, latex, options = {}) {
    const {
      color = "#000000",
      fontSize = 18,
      useMathJax = true
    } = options;

    if (!useMathJax) {
      return makeFallbackLabelTexture(THREE, latex, {
        color,
        fontSize: Math.max(22, fontSize * 2)
      });
    }

    try {
      const MathJax = await loadMathJax(options.mathJaxUrl);
      const node = await MathJax.tex2svgPromise(String(latex), {
        display: false,
        em: fontSize,
        ex: fontSize / 2,
        containerWidth: 100000
      });

      const svg = node.querySelector("svg");
      if (!svg) throw new Error("MathJax no produjo SVG.");

      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.style.color = color;

      const serialized = new XMLSerializer().serializeToString(svg);
      const encoded = btoa(unescape(encodeURIComponent(serialized)));
      const uri = "data:image/svg+xml;base64," + encoded;

      const image = new Image();
      image.decoding = "async";

      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = uri;
      });

      const texture = new THREE.Texture(image);
      texture.needsUpdate = true;

      const aspect = image.width > 0 && image.height > 0
        ? image.width / image.height
        : 2.0;

      return { texture, aspect };
    } catch (err) {
      return makeFallbackLabelTexture(THREE, latex, {
        color,
        fontSize: Math.max(22, fontSize * 2)
      });
    }
  }

  async function addLatexSprite(scene, THREE, latex, position, options = {}) {
    const {
      color = "#000000",
      scale = 0.55,
      fontSize = 18,
      useMathJax = true
    } = options;

    const { texture, aspect } = await makeLatexTexture(THREE, latex, {
      color,
      fontSize,
      useMathJax,
      mathJaxUrl: options.mathJaxUrl
    });

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(scale * aspect, scale, 1);
    sprite.renderOrder = 999;

    scene.add(sprite);
    return sprite;
  }

  function getNumericExtent(rows, field) {
    const values = rows
      .map((r) => safeNumber(r[field]))
      .filter((v) => Number.isFinite(v));

    if (!values.length) {
      return { min: -1, max: 1, mid: 0, range: 2 };
    }

    let min = Math.min(...values);
    let max = Math.max(...values);

    if (min === max) {
      min -= 1;
      max += 1;
    }

    const pad = (max - min) * 0.05;
    min -= pad;
    max += pad;

    return {
      min,
      max,
      mid: (min + max) / 2,
      range: max - min
    };
  }

  function niceTicks(min, max, count = 5) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      return [min || 0];
    }

    const rawStep = (max - min) / Math.max(1, count - 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep))));
    const normalized = rawStep / magnitude;

    let niceNorm;
    if (normalized <= 1) niceNorm = 1;
    else if (normalized <= 2) niceNorm = 2;
    else if (normalized <= 5) niceNorm = 5;
    else niceNorm = 10;

    const step = niceNorm * magnitude;
    const start = Math.ceil(min / step) * step;
    const end = Math.floor(max / step) * step;

    const ticks = [];
    for (let v = start; v <= end + step * 0.5; v += step) {
      ticks.push(Math.abs(v) < step * 1e-8 ? 0 : v);
    }

    if (ticks.length < 2) {
      return [min, (min + max) / 2, max];
    }

    return ticks.slice(0, 8);
  }

  function createLine(THREE, start, end, color = "#000000", width = 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({
      color,
      linewidth: width
    });
    return new THREE.Line(geometry, material);
  }

  function createArrowHead(THREE, position, direction, color = "#000000", size = 0.18) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(size * 0.42, size, 24),
      new THREE.MeshBasicMaterial({ color })
    );

    const dir = direction.clone().normalize();
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cone.position.copy(position.clone().add(dir.multiplyScalar(size * 0.5)));

    return cone;
  }

  function parseCsv(text, delimiter = ",") {
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (c === '"' && inQuotes && next === '"') {
        value += '"';
        i++;
      } else if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === delimiter && !inQuotes) {
        row.push(value);
        value = "";
      } else if ((c === "\n" || c === "\r") && !inQuotes) {
        if (c === "\r" && next === "\n") i++;
        row.push(value);
        value = "";
        if (row.some((x) => String(x).trim() !== "")) rows.push(row);
        row = [];
      } else {
        value += c;
      }
    }

    row.push(value);
    if (row.some((x) => String(x).trim() !== "")) rows.push(row);

    if (!rows.length) return [];

    const headers = rows[0].map((h) => String(h).trim());
    return rows.slice(1).map((r) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = r[i] ?? "";
      });
      return obj;
    });
  }

  function normalizeRows(rawRows, fields) {
    const rows = [];

    for (const r of rawRows || []) {
      const x = safeNumber(r[fields.xField]);
      const y = safeNumber(r[fields.yField]);
      const z = safeNumber(r[fields.zField]);

      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

      rows.push({
        raw: r,
        x,
        y,
        z,
        category: String(r[fields.categoryField] ?? "Serie 1"),
        colorValue: r[fields.colorField],
        size: safeNumber(r[fields.sizeField], fields.defaultPointSize)
      });
    }

    return rows;
  }

  function categoryColorMap(rows) {
    const map = new Map();
    let idx = 0;

    for (const r of rows) {
      const direct = hexToRgb01(r.colorValue);
      if (direct) {
        map.set(r.category, direct);
        continue;
      }

      if (!map.has(r.category)) {
        const hex = DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length];
        map.set(r.category, hexToRgb01(hex));
        idx++;
      }
    }

    return map;
  }

  function addBadge(container, options = {}) {
    if (options.showBadge === false) return;

    const badge = document.createElement("div");
    badge.style.position = "absolute";
    badge.style.right = (options.badgeRight ?? 18) + "px";
    badge.style.bottom = (options.badgeBottom ?? 18) + "px";
    badge.style.zIndex = "5";
    badge.style.display = "flex";
    badge.style.alignItems = "center";
    badge.style.gap = "8px";
    badge.style.pointerEvents = "none";
    badge.style.opacity = String(options.badgeOpacity ?? 0.92);

    const img = document.createElement("img");
    img.src = options.logoUrl || DEFAULT_LOGO_URL;
    img.alt = "AutoMindCloud";
    img.style.width = (options.badgeSize ?? 150) + "px";
    img.style.height = (options.badgeSize ?? 150) + "px";
    img.style.objectFit = "contain";

    badge.appendChild(img);

    if (options.showBadgeText !== false) {
      const text = document.createElement("span");
      text.textContent = options.badgeText || "AutoMindCloud";
      text.style.fontFamily = "Arial, sans-serif";
      text.style.fontWeight = "700";
      text.style.fontSize = (options.badgeTextSize ?? 14) + "px";
      text.style.color = options.badgeTextColor || "#31c7b7";
      text.style.whiteSpace = "nowrap";
      badge.appendChild(text);
    }

    container.appendChild(badge);
  }

  function ensureContainerStyles(container, options = {}) {
    const computed = window.getComputedStyle(container);

    if (computed.position === "static") {
      container.style.position = "relative";
    }

    container.style.overflow = "hidden";

    if (options.width) {
      container.style.width = typeof options.width === "number"
        ? `${options.width}px`
        : String(options.width);
    }

    if (options.height) {
      container.style.height = typeof options.height === "number"
        ? `${options.height}px`
        : String(options.height);
    }

    if (!container.style.height && computed.height === "0px") {
      container.style.height = "520px";
    }
  }

  function makeDataToScene(ext, globalRange, axisLength, THREE) {
    const xMid = ext.x.mid;
    const yMid = ext.y.mid;
    const zMid = ext.z.mid;
    const scale = axisLength / globalRange;

    return function dataToScene(x, y, z) {
      return new THREE.Vector3(
        (x - xMid) * scale,
        (y - yMid) * scale,
        (z - zMid) * scale
      );
    };
  }

  function getCrossValue(extent, mode) {
    if (mode === "center") return extent.mid;
    if (extent.min <= 0 && extent.max >= 0) return 0;
    return extent.mid;
  }

  async function addAxes(scene, THREE, dataToScene, ext, options = {}) {
    const axisColor = options.axisColor || "#000000";
    const axisLength = options.axisLength ?? 10;
    const tickSize = options.tickSize ?? 0.12;
    const tickLabelScale = options.tickLabelScale ?? 0.28;
    const axisLabelScale = options.axisLabelScale ?? 0.55;
    const tickCount = options.tickCount ?? 5;
    const axisCrossMode = options.axisCrossMode || "zero";
    const useMathJax = options.useMathJax !== false;

    const cx = getCrossValue(ext.x, axisCrossMode);
    const cy = getCrossValue(ext.y, axisCrossMode);
    const cz = getCrossValue(ext.z, axisCrossMode);

    const axes = [
      {
        key: "x",
        field: options.xField,
        latex: options.xLabelLatex || fieldNameToLatex(options.xField),
        start: dataToScene(ext.x.min, cy, cz),
        end: dataToScene(ext.x.max, cy, cz),
        direction: new THREE.Vector3(1, 0, 0),
        ticks: niceTicks(ext.x.min, ext.x.max, tickCount),
        tickPoint: (v) => dataToScene(v, cy, cz),
        tickA: (p) => p.clone().add(new THREE.Vector3(0, -tickSize, 0)),
        tickB: (p) => p.clone().add(new THREE.Vector3(0, tickSize, 0)),
        labelOffset: new THREE.Vector3(0.45, -0.45, 0),
        tickLabelOffset: new THREE.Vector3(0, -0.42, 0)
      },
      {
        key: "y",
        field: options.yField,
        latex: options.yLabelLatex || fieldNameToLatex(options.yField),
        start: dataToScene(cx, ext.y.min, cz),
        end: dataToScene(cx, ext.y.max, cz),
        direction: new THREE.Vector3(0, 1, 0),
        ticks: niceTicks(ext.y.min, ext.y.max, tickCount),
        tickPoint: (v) => dataToScene(cx, v, cz),
        tickA: (p) => p.clone().add(new THREE.Vector3(-tickSize, 0, 0)),
        tickB: (p) => p.clone().add(new THREE.Vector3(tickSize, 0, 0)),
        labelOffset: new THREE.Vector3(0.35, 0.45, 0),
        tickLabelOffset: new THREE.Vector3(-0.48, 0, 0)
      },
      {
        key: "z",
        field: options.zField,
        latex: options.zLabelLatex || fieldNameToLatex(options.zField),
        start: dataToScene(cx, cy, ext.z.min),
        end: dataToScene(cx, cy, ext.z.max),
        direction: new THREE.Vector3(0, 0, 1),
        ticks: niceTicks(ext.z.min, ext.z.max, tickCount),
        tickPoint: (v) => dataToScene(cx, cy, v),
        tickA: (p) => p.clone().add(new THREE.Vector3(-tickSize, 0, 0)),
        tickB: (p) => p.clone().add(new THREE.Vector3(tickSize, 0, 0)),
        labelOffset: new THREE.Vector3(0.35, 0.25, 0.45),
        tickLabelOffset: new THREE.Vector3(-0.48, 0.05, 0)
      }
    ];

    const labelPromises = [];

    for (const axis of axes) {
      const line = createLine(THREE, axis.start, axis.end, axisColor, 2);
      scene.add(line);

      const arrow = createArrowHead(THREE, axis.end, axis.direction, axisColor, 0.35);
      scene.add(arrow);

      const labelPos = axis.end.clone().add(axis.labelOffset);
      labelPromises.push(
        addLatexSprite(scene, THREE, axis.latex, labelPos, {
          color: axisColor,
          scale: axisLabelScale,
          fontSize: 20,
          useMathJax,
          mathJaxUrl: options.mathJaxUrl
        })
      );

      for (const t of axis.ticks) {
        const p = axis.tickPoint(t);

        scene.add(createLine(THREE, axis.tickA(p), axis.tickB(p), axisColor, 1));

        const tex = formatNumberLatex(t, options.tickDigits ?? 2);
        labelPromises.push(
          addLatexSprite(scene, THREE, tex, p.clone().add(axis.tickLabelOffset), {
            color: axisColor,
            scale: tickLabelScale,
            fontSize: 16,
            useMathJax,
            mathJaxUrl: options.mathJaxUrl
          })
        );
      }
    }

    await Promise.allSettled(labelPromises);
  }

  async function renderAutoMindScatter3D(userOptions = {}) {
    const options = Object.assign({
      containerId: "viewer",
      data: [],
      xField: "x",
      yField: "y",
      zField: "z",
      categoryField: "cluster",
      colorField: null,
      sizeField: "size",
      defaultPointSize: 5,
      pointSize: 0.12,
      pointOpacity: 0.88,
      axisColor: "#000000",
      background: "#ffffff",
      width: "100%",
      height: "520px",
      axisLength: 10,
      tickCount: 5,
      tickDigits: 2,
      axisCrossMode: "zero",
      useMathJax: true,
      showBadge: true,
      badgeSize: 150,
      cameraPosition: [8, 8, 8],
      cameraTarget: [0, 0, 0],
      enableDamping: true,
      autoRotate: false,
      autoRotateSpeed: 0.5
    }, userOptions || {});

    const container = getElement(options.container || options.containerId);
    if (!container) {
      throw new Error("No se encontró el contenedor del viewer.");
    }

    destroyAutoMindScatter3D(container);

    ensureContainerStyles(container, options);
    container.innerHTML = "";

    const { THREE, OrbitControls } = await loadThree(options);

    const rawRows = Array.isArray(options.data) ? options.data : [];
    const fields = {
      xField: options.xField,
      yField: options.yField,
      zField: options.zField,
      categoryField: options.categoryField || options.colorField || "cluster",
      colorField: options.colorField || options.categoryField || "cluster",
      sizeField: options.sizeField,
      defaultPointSize: options.defaultPointSize
    };

    const rows = normalizeRows(rawRows, fields);
    if (!rows.length) {
      throw new Error("No hay filas válidas para graficar. Revisa xField, yField, zField.");
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(options.background);

    const w = Math.max(1, container.clientWidth || 700);
    const h = Math.max(1, container.clientHeight || 520);

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 10000);
    camera.position.set(...options.cameraPosition);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true
    });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxPixelRatio || 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = options.enableDamping;
    controls.autoRotate = options.autoRotate;
    controls.autoRotateSpeed = options.autoRotateSpeed;
    controls.target.set(...options.cameraTarget);
    controls.update();

    const ext = {
      x: getNumericExtent(rows.map((r) => ({ [options.xField]: r.x })), options.xField),
      y: getNumericExtent(rows.map((r) => ({ [options.yField]: r.y })), options.yField),
      z: getNumericExtent(rows.map((r) => ({ [options.zField]: r.z })), options.zField)
    };

    const globalRange = Math.max(ext.x.range, ext.y.range, ext.z.range);
    const dataToScene = makeDataToScene(ext, globalRange, options.axisLength, THREE);

    const positions = [];
    const colors = [];
    const colorMap = categoryColorMap(rows);

    for (const r of rows) {
      const p = dataToScene(r.x, r.y, r.z);
      positions.push(p.x, p.y, p.z);

      const rgb = colorMap.get(r.category) || [0.2, 0.2, 0.2];
      colors.push(rgb[0], rgb[1], rgb[2]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const pointTexture = makeCircleTexture(THREE);

    const material = new THREE.PointsMaterial({
      size: options.pointSize,
      map: pointTexture,
      transparent: true,
      opacity: clamp(options.pointOpacity, 0.05, 1),
      vertexColors: true,
      alphaTest: 0.04,
      depthWrite: false,
      sizeAttenuation: true
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    addBadge(container, options);

    await addAxes(scene, THREE, dataToScene, ext, {
      xField: options.xField,
      yField: options.yField,
      zField: options.zField,
      xLabelLatex: options.xLabelLatex,
      yLabelLatex: options.yLabelLatex,
      zLabelLatex: options.zLabelLatex,
      axisColor: options.axisColor,
      axisLength: options.axisLength,
      tickCount: options.tickCount,
      tickDigits: options.tickDigits,
      axisCrossMode: options.axisCrossMode,
      useMathJax: options.useMathJax,
      mathJaxUrl: options.mathJaxUrl,
      tickSize: options.tickSize,
      tickLabelScale: options.tickLabelScale,
      axisLabelScale: options.axisLabelScale
    });

    const resizeObserver = new ResizeObserver(() => {
      const nw = Math.max(1, container.clientWidth || w);
      const nh = Math.max(1, container.clientHeight || h);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    });
    resizeObserver.observe(container);

    let rafId = null;
    let stopped = false;

    function animate() {
      if (stopped) return;
      rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }

    animate();

    const handle = {
      version: VERSION,
      container,
      scene,
      camera,
      renderer,
      controls,
      points,
      geometry,
      material,
      resizeObserver,
      stop() {
        stopped = true;
        if (rafId !== null) cancelAnimationFrame(rafId);
        resizeObserver.disconnect();
        controls.dispose();
        geometry.dispose();
        material.dispose();
        pointTexture.dispose();
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      }
    };

    RENDERERS.set(container, handle);
    return handle;
  }

  async function renderAutoMindScatter3DFromCsvUrl(options = {}) {
    const csvUrl = options.csvUrl || options.url;
    if (!csvUrl) {
      throw new Error("Falta csvUrl.");
    }

    const res = await fetch(csvUrl, { cache: options.cache || "no-cache" });
    if (!res.ok) {
      throw new Error(`No se pudo cargar CSV: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    const data = parseCsv(text, options.delimiter || ",");

    return renderAutoMindScatter3D(Object.assign({}, options, { data }));
  }

  function destroyAutoMindScatter3D(containerOrId) {
    const container = getElement(containerOrId);
    if (!container) return;

    const handle = RENDERERS.get(container);
    if (handle) {
      handle.stop();
      RENDERERS.delete(container);
    }
  }

  window.AutoMindScatter3D = {
    version: VERSION,
    render: renderAutoMindScatter3D,
    renderFromCsvUrl: renderAutoMindScatter3DFromCsvUrl,
    destroy: destroyAutoMindScatter3D,
    parseCsv,
    fieldNameToLatex,
    formatNumberLatex
  };

  window.renderAutoMindScatter3D = renderAutoMindScatter3D;
  window.renderAutoMindScatter3DFromCsvUrl = renderAutoMindScatter3DFromCsvUrl;
  window.destroyAutoMindScatter3D = destroyAutoMindScatter3D;
})();
