/*!
 * AutoMindScatter3D.js
 * v1.0.18 - Thin Arrow Heads + Perspective-Scaled Tick Labels
 *
 * Correcciones:
 * - Punta de flechas más delgada.
 * - Las medidas/ticks cambian de tamaño con la distancia de cámara.
 * - Evita que los números se vean gigantes al alejar el visor.
 * - Mantiene fix para "Failed to resolve module specifier 'three'".
 * - Renderizado LaTeX con KaTeX + fallback HTML.
 *
 * Funciones globales:
 *   window.renderAutoMindScatter3D(options)
 *   window.renderAutoMindScatter3DFromCsvUrl(options)
 *   window.destroyAutoMindScatter3D(containerOrId)
 */

(function () {
  "use strict";

  const VERSION = "1.0.18-THIN_ARROWS_PERSPECTIVE_TICKS";

  const THREE_VERSION = "0.160.0";

  const THREE_ESM_URLS = [
    {
      name: "esm.sh bundle",
      three: `https://esm.sh/three@${THREE_VERSION}?bundle&target=es2020`,
      orbit: `https://esm.sh/three@${THREE_VERSION}/examples/jsm/controls/OrbitControls.js?bundle&target=es2020`
    },
    {
      name: "esm.sh bundle deps",
      three: `https://esm.sh/three@${THREE_VERSION}?bundle&target=es2020`,
      orbit: `https://esm.sh/three@${THREE_VERSION}/examples/jsm/controls/OrbitControls.js?deps=three@${THREE_VERSION}&bundle&target=es2020`
    },
    {
      name: "esm.run",
      three: `https://esm.run/three@${THREE_VERSION}`,
      orbit: `https://esm.run/three@${THREE_VERSION}/examples/jsm/controls/OrbitControls.js`
    }
  ];

  const THREE_UNPKG_MODULE_URL =
    `https://unpkg.com/three@${THREE_VERSION}/build/three.module.js`;

  const ORBIT_UNPKG_MODULE_URL =
    `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/controls/OrbitControls.js`;

  const KATEX_CSS_URL = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
  const KATEX_JS_URL = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";

  const DEFAULT_LOGO_URL =
    "https://raw.githubusercontent.com/artemioadaysolvers/AutoMindCloudExperimental/main/AutoMindCloud/AutoMindCloud2.png";

  const PALETTE = [
    [0.90, 0.10, 0.25],
    [0.10, 0.30, 0.95],
    [0.10, 0.65, 0.25],
    [0.95, 0.45, 0.10],
    [0.55, 0.10, 0.75],
    [0.00, 0.65, 0.75],
    [0.90, 0.20, 0.80],
    [0.55, 0.75, 0.05],
    [0.50, 0.30, 0.10],
    [0.00, 0.45, 0.45]
  ];

  const HANDLES = new Map();

  let loaderPromise = null;
  let katexPromise = null;

  function getContainer(containerOrId) {
    if (typeof containerOrId === "string") return document.getElementById(containerOrId);
    return containerOrId;
  }

  function dynamicImport(url) {
    return import(/* webpackIgnore: true */ url);
  }

  async function loadText(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) {
      throw new Error("No se pudo cargar " + url + " | status=" + res.status);
    }
    return await res.text();
  }

  async function loadThreeFromBundles() {
    let lastError = null;

    for (const candidate of THREE_ESM_URLS) {
      try {
        const THREE = await dynamicImport(candidate.three);
        const orbitMod = await dynamicImport(candidate.orbit);

        if (!THREE || !orbitMod || !orbitMod.OrbitControls) {
          throw new Error("Carga incompleta de Three/OrbitControls desde " + candidate.name);
        }

        return {
          THREE,
          OrbitControls: orbitMod.OrbitControls,
          source: candidate.name
        };
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error("No se pudo cargar Three.js desde bundles ESM.");
  }

  async function loadThreeFromPatchedUnpkg() {
    const threeCode = await loadText(THREE_UNPKG_MODULE_URL);

    const threeBlobUrl = URL.createObjectURL(
      new Blob([threeCode], { type: "text/javascript" })
    );

    const THREE = await dynamicImport(threeBlobUrl);

    let orbitCode = await loadText(ORBIT_UNPKG_MODULE_URL);

    orbitCode = orbitCode
      .replace(/from\s+['"]three['"]/g, `from "${threeBlobUrl}"`)
      .replace(/from\s+['"]three\/build\/three\.module\.js['"]/g, `from "${threeBlobUrl}"`);

    const orbitBlobUrl = URL.createObjectURL(
      new Blob([orbitCode], { type: "text/javascript" })
    );

    const orbitMod = await dynamicImport(orbitBlobUrl);

    if (!THREE || !orbitMod || !orbitMod.OrbitControls) {
      throw new Error("Fallback parcheado cargó, pero OrbitControls no está disponible.");
    }

    return {
      THREE,
      OrbitControls: orbitMod.OrbitControls,
      source: "patched-unpkg-blob"
    };
  }

  async function loadThree() {
    if (loaderPromise) return loaderPromise;

    loaderPromise = (async function () {
      let bundleError = null;

      try {
        return await loadThreeFromBundles();
      } catch (err) {
        bundleError = err;
      }

      try {
        return await loadThreeFromPatchedUnpkg();
      } catch (fallbackError) {
        const msg =
          "No se pudo cargar Three.js/OrbitControls. " +
          "Error bundle: " + String(bundleError && bundleError.message ? bundleError.message : bundleError) +
          " | Error fallback: " + String(fallbackError && fallbackError.message ? fallbackError.message : fallbackError);

        throw new Error(msg);
      }
    })();

    return loaderPromise;
  }

  function ensureBaseStyles() {
    if (document.getElementById("automind-scatter3d-base-style")) return;

    const style = document.createElement("style");
    style.id = "automind-scatter3d-base-style";
    style.textContent = `
      .automind-3d-html-label {
        box-sizing: border-box;
        pointer-events: none;
        user-select: none;
        transform-origin: center center;
      }

      .automind-3d-html-label .katex {
        font-size: 1em !important;
        line-height: 1 !important;
      }

      .automind-3d-html-label .katex-html {
        line-height: 1 !important;
      }

      .automind-3d-html-label sub,
      .automind-3d-html-label sup {
        line-height: 0;
      }

      .automind-3d-badge-image-only img {
        display: block;
      }
    `;

    document.head.appendChild(style);
  }

  function loadKaTeX() {
    if (window.katex && typeof window.katex.render === "function") {
      return Promise.resolve(window.katex);
    }

    if (katexPromise) return katexPromise;

    katexPromise = new Promise((resolve, reject) => {
      try {
        if (!document.querySelector('link[data-automind-katex-css="1"]')) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = KATEX_CSS_URL;
          link.crossOrigin = "anonymous";
          link.setAttribute("data-automind-katex-css", "1");
          document.head.appendChild(link);
        }

        const existing = document.querySelector('script[data-automind-katex-js="1"]');
        if (existing) {
          existing.addEventListener("load", () => resolve(window.katex));
          existing.addEventListener("error", reject);
          return;
        }

        const script = document.createElement("script");
        script.src = KATEX_JS_URL;
        script.async = true;
        script.defer = true;
        script.crossOrigin = "anonymous";
        script.setAttribute("data-automind-katex-js", "1");

        script.onload = () => {
          if (window.katex && typeof window.katex.render === "function") {
            resolve(window.katex);
          } else {
            reject(new Error("KaTeX cargó, pero window.katex.render no existe."));
          }
        };

        script.onerror = () => reject(new Error("No se pudo cargar KaTeX."));

        document.head.appendChild(script);
      } catch (err) {
        reject(err);
      }
    });

    return katexPromise;
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

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeLatexInput(input) {
    let s = stripMathDelimiters(input);

    if (!s) return "";

    s = s
      .replace(/\r\s*mathrm/g, "\\mathrm")
      .replace(/\r\s*right/g, "\\right")
      .replace(/\r\s*ho/g, "\\rho")

      .replace(/\t\s*heta/g, "\\theta")
      .replace(/\t\s*imes/g, "\\times")
      .replace(/\t\s*ext/g, "\\text")
      .replace(/\t\s*au/g, "\\tau")

      .replace(/\f\s*rac/g, "\\frac")

      .replace(/\x08\s*eta/g, "\\beta")

      .replace(/\n\s*abla/g, "\\nabla")
      .replace(/\n\s*u/g, "\\nu")

      .replace(/\v\s*ar/g, "\\var");

    const bareCommands = [
      "mathrm",
      "text",
      "operatorname",
      "mathbf",
      "boldsymbol",
      "mathit",
      "mathsf",
      "frac",
      "sqrt",
      "sum",
      "prod",
      "int",
      "lim",
      "sin",
      "cos",
      "tan",
      "log",
      "ln",
      "exp",
      "min",
      "max",
      "argmin",
      "argmax",
      "left",
      "right",
      "cdot",
      "times",
      "pm",
      "mp",
      "leq",
      "geq",
      "neq",
      "approx",
      "infty",
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "varepsilon",
      "theta",
      "lambda",
      "mu",
      "nu",
      "pi",
      "rho",
      "sigma",
      "phi",
      "varphi",
      "omega",
      "Delta",
      "Sigma",
      "Omega"
    ];

    for (const cmd of bareCommands) {
      const re = new RegExp("(^|[^\\\\A-Za-z])(" + escapeRegExp(cmd) + ")(?=\\s*\\{|\\b)", "g");
      s = s.replace(re, "$1\\$2");
    }

    return s.trim();
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

  function findTwoCommandArgs(s, command) {
    const first = findCommandArg(s, command);
    if (!first) return null;

    const rest = s.slice(first.end);
    if (!rest.startsWith("{")) return null;

    let depth = 0;
    let content = "";

    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];

      if (ch === "{") {
        depth++;
        if (depth > 1) content += ch;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return {
            start: first.start,
            end: first.end + i + 1,
            a: first.content,
            b: content
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

  function replaceCommandVariantsWithSpan(s, commandName, style) {
    s = replaceCommandWithSpan(s, "\\" + commandName, style);
    s = replaceCommandWithSpan(s, commandName, style);
    return s;
  }

  function replaceFracFallback(s) {
    let guard = 0;

    while ((s.includes("\\frac") || s.includes("frac")) && guard < 100) {
      guard++;

      let found = findTwoCommandArgs(s, "\\frac");
      if (!found) found = findTwoCommandArgs(s, "frac");

      if (!found) break;

      const numerator = latexToHTML(found.a);
      const denominator = latexToHTML(found.b);

      const replacement =
        `<span style="display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;line-height:1;">` +
        `<span style="display:block;border-bottom:1px solid currentColor;padding:0 0.08em;">${numerator}</span>` +
        `<span style="display:block;padding:0 0.08em;">${denominator}</span>` +
        `</span>`;

      s = s.slice(0, found.start) + replacement + s.slice(found.end);
    }

    return s;
  }

  function replaceSqrtFallback(s) {
    let guard = 0;

    while ((s.includes("\\sqrt") || s.includes("sqrt")) && guard < 100) {
      guard++;

      let found = findCommandArg(s, "\\sqrt");
      if (!found) found = findCommandArg(s, "sqrt");

      if (!found) break;

      const inner = latexToHTML(found.content);
      const replacement =
        `<span style="display:inline-flex;align-items:flex-start;">` +
        `<span style="font-size:1.05em;">√</span>` +
        `<span style="border-top:1px solid currentColor;padding-left:0.06em;">${inner}</span>` +
        `</span>`;

      s = s.slice(0, found.start) + replacement + s.slice(found.end);
    }

    return s;
  }

  function replaceScriptsWithHTML(s) {
    s = s.replace(/_\{([^{}]+)\}/g, function (_, a) {
      return `<sub>${latexToHTML(a)}</sub>`;
    });

    s = s.replace(/\^\{([^{}]+)\}/g, function (_, a) {
      return `<sup>${latexToHTML(a)}</sup>`;
    });

    s = s.replace(/_([A-Za-z0-9+\-]+)/g, function (_, a) {
      return `<sub>${htmlEscape(a)}</sub>`;
    });

    s = s.replace(/\^([A-Za-z0-9+\-]+)/g, function (_, a) {
      return `<sup>${htmlEscape(a)}</sup>`;
    });

    return s;
  }

  function latexToHTML(input) {
    let s = normalizeLatexInput(input);
    if (!s) return "";

    s = htmlEscape(s);

    s = s
      .replace(/\\_/g, "_")
      .replace(/\\%/g, "%")
      .replace(/\\&/g, "&amp;")
      .replace(/\\#/g, "#")
      .replace(/\\\$/g, "$")
      .replace(/\\\{/g, "{")
      .replace(/\\\}/g, "}");

    s = replaceFracFallback(s);
    s = replaceSqrtFallback(s);

    s = replaceCommandVariantsWithSpan(s, "mathrm", "font-style:normal;font-weight:400;");
    s = replaceCommandVariantsWithSpan(s, "text", "font-style:normal;font-weight:400;");
    s = replaceCommandVariantsWithSpan(s, "operatorname", "font-style:normal;font-weight:400;");
    s = replaceCommandVariantsWithSpan(s, "mathbf", "font-style:normal;font-weight:700;");
    s = replaceCommandVariantsWithSpan(s, "boldsymbol", "font-style:italic;font-weight:700;");
    s = replaceCommandVariantsWithSpan(s, "mathit", "font-style:italic;font-weight:400;");
    s = replaceCommandVariantsWithSpan(s, "mathsf", "font-style:normal;font-weight:400;");

    const replacements = [
      ["\\times", "×"],
      ["times", "×"],
      ["\\cdot", "·"],
      ["cdot", "·"],
      ["\\pm", "±"],
      ["pm", "±"],
      ["\\mp", "∓"],
      ["mp", "∓"],
      ["\\leq", "≤"],
      ["leq", "≤"],
      ["\\geq", "≥"],
      ["geq", "≥"],
      ["\\neq", "≠"],
      ["neq", "≠"],
      ["\\approx", "≈"],
      ["approx", "≈"],
      ["\\infty", "∞"],
      ["infty", "∞"],
      ["\\alpha", "α"],
      ["alpha", "α"],
      ["\\beta", "β"],
      ["beta", "β"],
      ["\\gamma", "γ"],
      ["gamma", "γ"],
      ["\\delta", "δ"],
      ["delta", "δ"],
      ["\\epsilon", "ε"],
      ["epsilon", "ε"],
      ["\\varepsilon", "ε"],
      ["varepsilon", "ε"],
      ["\\theta", "θ"],
      ["theta", "θ"],
      ["\\lambda", "λ"],
      ["lambda", "λ"],
      ["\\mu", "μ"],
      ["mu", "μ"],
      ["\\nu", "ν"],
      ["nu", "ν"],
      ["\\pi", "π"],
      ["pi", "π"],
      ["\\rho", "ρ"],
      ["rho", "ρ"],
      ["\\sigma", "σ"],
      ["sigma", "σ"],
      ["\\phi", "φ"],
      ["phi", "φ"],
      ["\\varphi", "φ"],
      ["varphi", "φ"],
      ["\\omega", "ω"],
      ["omega", "ω"],
      ["\\Delta", "Δ"],
      ["Delta", "Δ"],
      ["\\Sigma", "Σ"],
      ["Sigma", "Σ"],
      ["\\Omega", "Ω"],
      ["Omega", "Ω"]
    ];

    for (const [from, to] of replacements) {
      s = s.split(from).join(to);
    }

    s = replaceScriptsWithHTML(s);

    s = s.replace(/\\([A-Za-z]+)/g, "$1");
    s = s.replace(/[{}]/g, "");

    return s;
  }

  function patchSupSub(div) {
    const supSubCss = "line-height:0;position:relative;vertical-align:baseline;";
    const subCss = supSubCss + "bottom:-0.25em;font-size:70%;";
    const supCss = supSubCss + "top:-0.45em;font-size:70%;";

    for (const sub of div.querySelectorAll("sub")) {
      sub.setAttribute("style", subCss);
    }

    for (const sup of div.querySelectorAll("sup")) {
      sup.setAttribute("style", supCss);
    }
  }

  function renderLatexIntoElement(div, latex, options = {}) {
    const normalized = normalizeLatexInput(latex);

    div.setAttribute("data-automind-latex", normalized);
    div.innerHTML = latexToHTML(normalized);
    patchSupSub(div);

    if (options.useKatex === false) return;

    loadKaTeX()
      .then((katex) => {
        if (!div.isConnected) return;

        try {
          katex.render(normalized, div, {
            throwOnError: false,
            displayMode: false,
            strict: "ignore",
            trust: true,
            output: "html"
          });

          div.classList.add("automind-katex-ready");
        } catch (err) {
          div.innerHTML = latexToHTML(normalized);
          patchSupSub(div);
        }
      })
      .catch(() => {
        div.innerHTML = latexToHTML(normalized);
        patchSupSub(div);
      });
  }

  function makeHTMLLabel(container, latex, options = {}) {
    const baseFontSize = Number(options.fontSize ?? 13);

    const div = document.createElement("div");

    div.className = "automind-3d-html-label";

    div.style.position = "absolute";
    div.style.left = "0px";
    div.style.top = "0px";
    div.style.transform = "translate(-50%, -50%)";
    div.style.zIndex = String(options.zIndex ?? 8);
    div.style.pointerEvents = "none";
    div.style.color = options.color || "#000000";
    div.style.fontFamily = options.fontFamily || '"Times New Roman", "Cambria Math", Georgia, serif';
    div.style.fontSize = baseFontSize + "px";
    div.style.fontWeight = options.fontWeight || "700";
    div.style.fontStyle = options.fontStyle || "italic";
    div.style.lineHeight = "1";
    div.style.whiteSpace = "nowrap";
    div.style.textShadow = options.textShadow || "0 0 1px rgba(255,255,255,0.95)";
    div.style.userSelect = "none";

    renderLatexIntoElement(div, latex, {
      useKatex: options.useKatex !== false
    });

    container.appendChild(div);

    return {
      element: div,
      world: options.world,
      xOffset: options.xOffset || 0,
      yOffset: options.yOffset || 0,
      hideBehindCamera: options.hideBehindCamera !== false,

      baseFontSize,
      minFontSize: Number(options.minFontSize ?? Math.max(5, baseFontSize * 0.55)),
      maxFontSize: Number(options.maxFontSize ?? baseFontSize),
      perspectiveScale: options.perspectiveScale === true,
      distanceReference: Number(options.distanceReference || 1)
    };
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
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

      if (label.perspectiveScale) {
        const d = camera.position.distanceTo(label.world);
        const ref = label.distanceReference || d || 1;

        /*
          Antes los ticks eran HTML fijo, por eso se veían enormes al alejar.
          Ahora disminuyen con la distancia de cámara, pero con límites para que no desaparezcan.
        */
        const factor = clamp(ref / Math.max(d, 0.0001), 0.50, 1.00);
        const fontSize = clamp(label.baseFontSize * factor, label.minFontSize, label.maxFontSize);

        label.element.style.fontSize = fontSize + "px";
        label.element.style.opacity = String(clamp(0.65 + factor * 0.35, 0.65, 1));
      }

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

  function makeArrowHead(THREE, position, direction, color = 0x000000, options = {}) {
    const length = Number(options.length ?? 0.24);
    const radius = Number(options.radius ?? 0.045);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(radius, length, 32),
      new THREE.MeshBasicMaterial({ color })
    );

    const dir = direction.clone().normalize();
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cone.position.copy(position.clone().add(dir.clone().multiplyScalar(length * 0.45)));

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

  function niceTicks(min, max, n = 7, maxLabels = 12) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [];

    const raw = (max - min) / Math.max(1, n - 1);
    const pow = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
    const base = raw / pow;

    let step;
    if (base <= 1) step = 1 * pow;
    else if (base <= 2) step = 2 * pow;
    else if (base <= 2.5) step = 2.5 * pow;
    else if (base <= 5) step = 5 * pow;
    else step = 10 * pow;

    const start = Math.ceil(min / step) * step;
    const end = Math.floor(max / step) * step;

    const arr = [];
    for (let v = start; v <= end + step * 0.25; v += step) {
      const val = Math.abs(v) < step * 1e-8 ? 0 : v;
      if (Math.abs(val) > step * 1e-8) arr.push(val);
    }

    return arr.slice(0, maxLabels);
  }

  function formatTickLatex(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || Math.abs(n) < 1e-12) return "";

    const a = Math.abs(n);

    if (a >= 1e9) {
      const coeff = (n / 1e9).toFixed(1).replace(/\.0$/, "");
      return coeff + "\\times 10^{9}";
    }

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
    badge.style.right = (options.badgeRight ?? 16) + "px";
    badge.style.bottom = (options.badgeBottom ?? 16) + "px";
    badge.style.zIndex = "10";
    badge.style.display = "flex";
    badge.style.alignItems = "center";
    badge.style.justifyContent = "center";
    badge.style.pointerEvents = "none";

    const img = document.createElement("img");
    img.src = options.logoUrl || DEFAULT_LOGO_URL;
    img.alt = "AutoMindCloud";
    img.style.width = (options.badgeSize ?? 112) + "px";
    img.style.height = (options.badgeSize ?? 112) + "px";
    img.style.objectFit = "contain";
    img.style.opacity = String(options.badgeOpacity ?? 0.95);

    badge.appendChild(img);
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

    ensureBaseStyles();

    destroyAutoMindScatter3D(container);
    clearContainer(container);

    const computed = window.getComputedStyle(container);
    if (computed.position === "static") container.style.position = "relative";
    container.style.overflow = "hidden";
    container.style.background = options.background || "#ffffff";

    if (options.width) {
      container.style.width = typeof options.width === "number" ? options.width + "px" : String(options.width);
    }

    if (options.height) {
      container.style.height = typeof options.height === "number" ? options.height + "px" : String(options.height);
    }

    if (!container.style.height && container.clientHeight < 10) {
      container.style.height = "500px";
    }

    const loaded = await loadThree();
    const THREE = loaded.THREE;
    const OrbitControls = loaded.OrbitControls;

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

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false
    });

    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = options.enableDamping !== false;
    controls.dampingFactor = options.dampingFactor ?? 0.08;
    controls.target.set(0, 0, 0);
    controls.update();

    const labelDistanceReference = camera.position.distanceTo(controls.target);

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

    const axisColor = 0x000000;
    const o = new THREE.Vector3(0, 0, 0);

    const xEnd = new THREE.Vector3(axisLen, 0, 0);
    const yEnd = new THREE.Vector3(0, axisLen, 0);
    const zEnd = new THREE.Vector3(0, 0, axisLen);

    scene.add(makeLine(THREE, o, xEnd, axisColor));
    scene.add(makeLine(THREE, o, yEnd, axisColor));
    scene.add(makeLine(THREE, o, zEnd, axisColor));

    const arrowLength = options.arrowHeadLength ?? 0.24;
    const arrowRadius = options.arrowHeadRadius ?? 0.045;

    scene.add(makeArrowHead(THREE, xEnd, new THREE.Vector3(1, 0, 0), axisColor, {
      length: arrowLength,
      radius: arrowRadius
    }));

    scene.add(makeArrowHead(THREE, yEnd, new THREE.Vector3(0, 1, 0), axisColor, {
      length: arrowLength,
      radius: arrowRadius
    }));

    scene.add(makeArrowHead(THREE, zEnd, new THREE.Vector3(0, 0, 1), axisColor, {
      length: arrowLength,
      radius: arrowRadius
    }));

    const htmlLabels = [];

    htmlLabels.push(makeHTMLLabel(container, options.xLabelLatex || xField, {
      world: new THREE.Vector3(axisLen + 0.42, 0, 0),
      fontSize: options.axisLabelFontSize ?? 16,
      minFontSize: options.axisLabelMinFontSize ?? 9,
      maxFontSize: options.axisLabelMaxFontSize ?? 16,
      perspectiveScale: options.axisLabelPerspectiveScale === true,
      distanceReference: labelDistanceReference,
      fontWeight: "700",
      fontStyle: "italic",
      useKatex: options.useKatex !== false
    }));

    htmlLabels.push(makeHTMLLabel(container, options.yLabelLatex || yField, {
      world: new THREE.Vector3(0, axisLen + 0.42, 0),
      fontSize: options.axisLabelFontSize ?? 16,
      minFontSize: options.axisLabelMinFontSize ?? 9,
      maxFontSize: options.axisLabelMaxFontSize ?? 16,
      perspectiveScale: options.axisLabelPerspectiveScale === true,
      distanceReference: labelDistanceReference,
      fontWeight: "700",
      fontStyle: "italic",
      useKatex: options.useKatex !== false
    }));

    htmlLabels.push(makeHTMLLabel(container, options.zLabelLatex || zField, {
      world: new THREE.Vector3(0, 0, axisLen + 0.42),
      fontSize: options.axisLabelFontSize ?? 16,
      minFontSize: options.axisLabelMinFontSize ?? 9,
      maxFontSize: options.axisLabelMaxFontSize ?? 16,
      perspectiveScale: options.axisLabelPerspectiveScale === true,
      distanceReference: labelDistanceReference,
      fontWeight: "700",
      fontStyle: "italic",
      useKatex: options.useKatex !== false
    }));

    const tickCount = options.tickCount ?? 7;
    const maxTickLabels = options.maxTickLabels ?? 12;
    const tickSize = options.tickSize ?? 0.07;

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
          fontSize: options.tickFontSize ?? 8,
          minFontSize: options.tickMinFontSize ?? 5,
          maxFontSize: options.tickMaxFontSize ?? 8,
          perspectiveScale: options.tickLabelPerspectiveScale !== false,
          distanceReference: labelDistanceReference,
          fontWeight: "400",
          fontStyle: "normal",
          textShadow: "0 0 2px rgba(255,255,255,0.95)",
          useKatex: options.useKatex !== false
        }));
      }
    }

    addTicks("x", niceTicks(0, Math.max(ex.max, 0), tickCount, maxTickLabels));
    addTicks("y", niceTicks(0, Math.max(ey.max, 0), tickCount, maxTickLabels));
    addTicks("z", niceTicks(0, Math.max(ez.max, 0), tickCount, maxTickLabels));

    addBadge(container, {
      showBadge: options.showBadge,
      logoUrl: options.logoUrl,
      badgeSize: options.badgeSize ?? 112,
      badgeOpacity: options.badgeOpacity ?? 0.95,
      badgeRight: options.badgeRight ?? 16,
      badgeBottom: options.badgeBottom ?? 16
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
      source: loaded.source,
      scene,
      camera,
      renderer,
      controls,
      resizeObserver,
      raf,
      htmlLabels
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
    latexToHTML,
    normalizeLatexInput,
    loadThree
  };

  window.renderAutoMindScatter3D = renderAutoMindScatter3D;
  window.renderAutoMindScatter3DFromCsvUrl = renderAutoMindScatter3DFromCsvUrl;
  window.destroyAutoMindScatter3D = destroyAutoMindScatter3D;
})();
