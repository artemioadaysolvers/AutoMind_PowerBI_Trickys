/*!
 * AutoMindHistogram3D.js
 * v1.0.0
 *
 * Histograma 3D interactivo con Three.js.
 *
 * Funciones globales:
 *   window.renderAutoMindHistogram3D(options)
 *   window.destroyAutoMindHistogram3D(containerOrId)
 *
 * Uso básico:
 *   renderAutoMindHistogram3D({
 *     containerId: "viewer",
 *     bars: [
 *       { x: 0.1, z: 0.2, h: 12 },
 *       { x: 0.3, z: 0.5, h: 30 }
 *     ]
 *   });
 *
 * También acepta datos crudos:
 *   renderAutoMindHistogram3D({
 *     containerId: "viewer",
 *     data: [{ x: 1, y: 2 }, { x: 2, y: 3 }],
 *     xField: "x",
 *     yField: "y",
 *     bins: 32
 *   });
 */

(function () {
  "use strict";

  const VERSION = "1.0.0";

  const THREE_VERSION = "0.160.0";

  const THREE_ESM_URLS = [
    {
      name: "esm.sh bundle",
      three: `https://esm.sh/three@${THREE_VERSION}?bundle&target=es2020`,
      orbit: `https://esm.sh/three@${THREE_VERSION}/examples/jsm/controls/OrbitControls.js?deps=three@${THREE_VERSION}&bundle&target=es2020`
    },
    {
      name: "esm.run",
      three: `https://esm.run/three@${THREE_VERSION}`,
      orbit: `https://esm.run/three@${THREE_VERSION}/examples/jsm/controls/OrbitControls.js`
    }
  ];

  const DEFAULT_LOGO_URL =
    "https://raw.githubusercontent.com/artemioadaysolvers/AutoMindCloudExperimental/main/AutoMindCloud/AutoMindCloud2.png";

  const HANDLES = new Map();

  let loaderPromise = null;

  function getContainer(containerOrId) {
    if (typeof containerOrId === "string") {
      return document.getElementById(containerOrId);
    }
    return containerOrId;
  }

  function dynamicImport(url) {
    return import(/* webpackIgnore: true */ url);
  }

  async function loadThree() {
    if (loaderPromise) return loaderPromise;

    loaderPromise = (async function () {
      let lastError = null;

      for (const candidate of THREE_ESM_URLS) {
        try {
          const THREE = await dynamicImport(candidate.three);
          const orbitMod = await dynamicImport(candidate.orbit);

          if (!THREE || !orbitMod || !orbitMod.OrbitControls) {
            throw new Error("Carga incompleta desde " + candidate.name);
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

      throw lastError || new Error("No se pudo cargar Three.js.");
    })();

    return loaderPromise;
  }

  function toNumber(v, fallback = NaN) {
    if (v === null || v === undefined || v === "") return fallback;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function extent(values) {
    let min = Infinity;
    let max = -Infinity;

    for (const v of values) {
      const n = toNumber(v);
      if (!Number.isFinite(n)) continue;
      min = Math.min(min, n);
      max = Math.max(max, n);
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

  function linspace(a, b, n) {
    const arr = [];
    if (n <= 1) return [a];

    for (let i = 0; i < n; i++) {
      arr.push(a + ((b - a) * i) / (n - 1));
    }

    return arr;
  }

  function makeEdges(min, max, bins) {
    const edges = [];
    const n = Math.max(1, Math.floor(bins));

    for (let i = 0; i <= n; i++) {
      edges.push(min + ((max - min) * i) / n);
    }

    return edges;
  }

  function findBin(value, edges) {
    const n = edges.length - 1;

    if (value < edges[0] || value > edges[n]) return -1;
    if (value === edges[n]) return n - 1;

    const width = (edges[n] - edges[0]) / n;
    let idx = Math.floor((value - edges[0]) / width);

    idx = clamp(idx, 0, n - 1);
    return idx;
  }

  function computeHistogram2D(options) {
    const data = Array.isArray(options.data) ? options.data : [];

    const xField = options.xField || "x";
    const yField = options.yField || "y";

    const xs = [];
    const ys = [];

    for (const row of data) {
      const x = toNumber(row[xField]);
      const y = toNumber(row[yField]);

      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      xs.push(x);
      ys.push(y);
    }

    if (!xs.length || !ys.length) {
      throw new Error("No hay datos válidos para construir el histograma.");
    }

    const ex = extent(xs);
    const ey = extent(ys);

    const bins = options.bins ?? 32;
    const xBins = options.xBins ?? bins;
    const yBins = options.yBins ?? bins;

    const xEdges = options.xEdges || makeEdges(ex.min, ex.max, xBins);
    const yEdges = options.yEdges || makeEdges(ey.min, ey.max, yBins);

    const counts = Array.from({ length: xEdges.length - 1 }, () =>
      Array.from({ length: yEdges.length - 1 }, () => 0)
    );

    for (let k = 0; k < xs.length; k++) {
      const i = findBin(xs[k], xEdges);
      const j = findBin(ys[k], yEdges);

      if (i >= 0 && j >= 0) {
        counts[i][j] += 1;
      }
    }

    const bars = [];

    for (let i = 0; i < xEdges.length - 1; i++) {
      for (let j = 0; j < yEdges.length - 1; j++) {
        const h = counts[i][j];

        if (h <= 0 && options.keepZeroBars !== true) continue;

        bars.push({
          x: (xEdges[i] + xEdges[i + 1]) / 2,
          z: (yEdges[j] + yEdges[j + 1]) / 2,
          h
        });
      }
    }

    return {
      bars,
      xMin: xEdges[0],
      xMax: xEdges[xEdges.length - 1],
      zMin: yEdges[0],
      zMax: yEdges[yEdges.length - 1],
      xBinWidth: xEdges[1] - xEdges[0],
      zBinWidth: yEdges[1] - yEdges[0],
      hMax: Math.max(...bars.map(b => b.h), 1)
    };
  }

  function normalizeHistogramInput(options) {
    if (Array.isArray(options.bars) && options.bars.length > 0) {
      const xField = options.barXField || "x";
      const zField = options.barZField || "z";
      const yAltField = options.barYField || "y";
      const hField = options.barHField || "h";

      const bars = [];

      for (const row of options.bars) {
        const x = toNumber(row[xField]);
        const z = Number.isFinite(toNumber(row[zField]))
          ? toNumber(row[zField])
          : toNumber(row[yAltField]);
        const h = toNumber(row[hField]);

        if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(h)) {
          continue;
        }

        bars.push({ x, z, h });
      }

      if (!bars.length) {
        throw new Error("bars existe, pero no contiene barras válidas.");
      }

      const ex = extent(bars.map(b => b.x));
      const ez = extent(bars.map(b => b.z));
      const eh = extent(bars.map(b => b.h));

      const xBinWidth =
        Number.isFinite(toNumber(options.xBinWidth))
          ? toNumber(options.xBinWidth)
          : ex.range / Math.max(1, Math.sqrt(bars.length));

      const zBinWidth =
        Number.isFinite(toNumber(options.zBinWidth))
          ? toNumber(options.zBinWidth)
          : ez.range / Math.max(1, Math.sqrt(bars.length));

      return {
        bars,
        xMin: toNumber(options.xMin, ex.min),
        xMax: toNumber(options.xMax, ex.max),
        zMin: toNumber(options.zMin, ez.min),
        zMax: toNumber(options.zMax, ez.max),
        xBinWidth,
        zBinWidth,
        hMax: toNumber(options.hMax, eh.max)
      };
    }

    return computeHistogram2D(options);
  }

  function clearContainer(container) {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  function makeLine(THREE, a, b, color = 0x111111) {
    const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
    const material = new THREE.LineBasicMaterial({ color });
    return new THREE.Line(geometry, material);
  }

  function colorByHeight(THREE, h, hMax, options = {}) {
    if (typeof options.colorFunction === "function") {
      return new THREE.Color(options.colorFunction(h, hMax));
    }

    const t = clamp(h / Math.max(hMax, 1e-12), 0, 1);

    const low = new THREE.Color(options.lowColor ?? 0x2b6cb0);
    const mid = new THREE.Color(options.midColor ?? 0xf6ad55);
    const high = new THREE.Color(options.highColor ?? 0xc53030);

    if (t < 0.5) {
      return low.clone().lerp(mid, t * 2);
    }

    return mid.clone().lerp(high, (t - 0.5) * 2);
  }

  function makeTextSprite(THREE, scene, text, position, size = 0.38, options = {}) {
    if (text === null || text === undefined || text === "") return null;

    const canvas = document.createElement("canvas");
    canvas.width = options.canvasWidth || 512;
    canvas.height = options.canvasHeight || 128;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.font = options.font || "bold 42px Arial";
    ctx.fillStyle = options.color || "#111111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text), canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(size * 4, size, 1);

    scene.add(sprite);
    return sprite;
  }

  function addBadge(container, options = {}) {
    if (options.showBadge === false) return null;

    const badge = document.createElement("div");

    badge.className = "automind-histogram3d-badge";
    badge.style.position = "absolute";
    badge.style.right = (options.badgeRight ?? 16) + "px";
    badge.style.bottom = (options.badgeBottom ?? 16) + "px";
    badge.style.zIndex = "20";
    badge.style.pointerEvents = "none";
    badge.style.display = "flex";
    badge.style.alignItems = "center";
    badge.style.justifyContent = "center";

    const img = document.createElement("img");

    img.src = options.logoUrl || DEFAULT_LOGO_URL;
    img.alt = "AutoMind";
    img.style.width = (options.badgeSize ?? 112) + "px";
    img.style.height = (options.badgeSize ?? 112) + "px";
    img.style.objectFit = "contain";
    img.style.opacity = String(options.badgeOpacity ?? 0.95);

    badge.appendChild(img);
    container.appendChild(badge);

    return badge;
  }

  function destroyAutoMindHistogram3D(containerOrId) {
    const container = getContainer(containerOrId);

    if (!container) return;

    const handle = HANDLES.get(container);

    if (!handle) return;

    try {
      cancelAnimationFrame(handle.raf);
    } catch (e) {}

    try {
      handle.controls.dispose();
    } catch (e) {}

    try {
      handle.renderer.dispose();
    } catch (e) {}

    try {
      handle.resizeObserver.disconnect();
    } catch (e) {}

    HANDLES.delete(container);
  }

  async function renderAutoMindHistogram3D(options = {}) {
    const container = getContainer(
      options.container || options.containerId || "viewer"
    );

    if (!container) {
      throw new Error("No se encontró el contenedor.");
    }

    destroyAutoMindHistogram3D(container);
    clearContainer(container);

    const computed = window.getComputedStyle(container);

    if (computed.position === "static") {
      container.style.position = "relative";
    }

    container.style.overflow = "hidden";
    container.style.background = options.background || "#ffffff";

    if (options.width) {
      container.style.width =
        typeof options.width === "number" ? options.width + "px" : String(options.width);
    }

    if (options.height) {
      container.style.height =
        typeof options.height === "number" ? options.height + "px" : String(options.height);
    }

    if (!container.style.height && container.clientHeight < 10) {
      container.style.height = "680px";
    }

    const hist = normalizeHistogramInput(options);

    const loaded = await loadThree();
    const THREE = loaded.THREE;
    const OrbitControls = loaded.OrbitControls;

    const width = Math.max(1, container.clientWidth || 900);
    const height = Math.max(1, container.clientHeight || 680);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(options.background || 0xffffff);

    const camera = new THREE.PerspectiveCamera(
      options.fov ?? 60,
      width / height,
      options.near ?? 0.1,
      options.far ?? 1000
    );

    camera.position.set(...(options.cameraPosition || [8, 7, 9]));

    const renderer = new THREE.WebGLRenderer({
      antialias: options.antialias !== false,
      alpha: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer === true
    });

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxPixelRatio ?? 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);

    controls.enableDamping = options.enableDamping !== false;
    controls.dampingFactor = options.dampingFactor ?? 0.08;
    controls.enablePan = options.enablePan !== false;
    controls.rotateSpeed = options.rotateSpeed ?? 0.75;
    controls.panSpeed = options.panSpeed ?? 0.65;

    controls.target.set(...(options.target || [0, 1.5, 0]));
    controls.update();

    /*
      Zoom manual suave.
      Evita que el scroll sea demasiado intenso en Colab / navegador.
    */
    controls.enableZoom = false;

    const minDistance = options.minDistance ?? 6.0;
    const maxDistance = options.maxDistance ?? 22.0;
    const zoomStep = options.zoomStep ?? 0.25;

    function onWheel(event) {
      event.preventDefault();

      const target = controls.target.clone();
      const direction = camera.position.clone().sub(target).normalize();
      const currentDistance = camera.position.distanceTo(target);

      const delta = Math.sign(event.deltaY);

      const nextDistance = clamp(
        currentDistance + delta * zoomStep,
        minDistance,
        maxDistance
      );

      camera.position.copy(
        target.clone().add(direction.multiplyScalar(nextDistance))
      );

      camera.updateProjectionMatrix();
      controls.update();
    }

    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const ambientLight = new THREE.AmbientLight(
      options.ambientLightColor ?? 0xffffff,
      options.ambientLightIntensity ?? 0.68
    );

    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(
      options.directionalLightColor ?? 0xffffff,
      options.directionalLightIntensity ?? 0.88
    );

    directionalLight.position.set(...(options.lightPosition || [4, 8, 6]));
    scene.add(directionalLight);

    const axisSize = options.axisSize ?? 7.0;
    const maxBarHeight = options.maxBarHeight ?? 4.8;

    const xRange = hist.xMax - hist.xMin || 1;
    const zRange = hist.zMax - hist.zMin || 1;

    function scaleX(x) {
      return ((x - hist.xMin) / xRange - 0.5) * axisSize;
    }

    function scaleZ(z) {
      return ((z - hist.zMin) / zRange - 0.5) * axisSize;
    }

    function scaleH(h) {
      if (options.heightScale === "sqrt") {
        return Math.max(
          options.minBarHeight ?? 0.03,
          Math.sqrt(h / Math.max(hist.hMax, 1e-12)) * maxBarHeight
        );
      }

      if (options.heightScale === "log") {
        return Math.max(
          options.minBarHeight ?? 0.03,
          Math.log1p(h) / Math.log1p(Math.max(hist.hMax, 1e-12)) * maxBarHeight
        );
      }

      return Math.max(
        options.minBarHeight ?? 0.03,
        h / Math.max(hist.hMax, 1e-12) * maxBarHeight
      );
    }

    const barWidth =
      options.barWidth ??
      (hist.xBinWidth / xRange) * axisSize * (options.barGapFactor ?? 0.92);

    const barDepth =
      options.barDepth ??
      (hist.zBinWidth / zRange) * axisSize * (options.barGapFactor ?? 0.92);

    const group = new THREE.Group();

    for (const b of hist.bars) {
      const h = scaleH(b.h);

      const geometry = new THREE.BoxGeometry(barWidth, h, barDepth);

      const material = new THREE.MeshStandardMaterial({
        color: colorByHeight(THREE, b.h, hist.hMax, options),
        roughness: options.roughness ?? 0.55,
        metalness: options.metalness ?? 0.05,
        transparent: options.opacity < 1,
        opacity: options.opacity ?? 0.92
      });

      const mesh = new THREE.Mesh(geometry, material);

      mesh.position.set(
        scaleX(b.x),
        h / 2,
        scaleZ(b.z)
      );

      mesh.userData = {
        x: b.x,
        z: b.z,
        h: b.h
      };

      group.add(mesh);
    }

    scene.add(group);

    const half = axisSize / 2;
    const axisColor = options.axisColor ?? 0x111111;

    if (options.showAxes !== false) {
      scene.add(
        makeLine(
          THREE,
          new THREE.Vector3(-half, 0, -half),
          new THREE.Vector3(half, 0, -half),
          axisColor
        )
      );

      scene.add(
        makeLine(
          THREE,
          new THREE.Vector3(-half, 0, -half),
          new THREE.Vector3(-half, 0, half),
          axisColor
        )
      );

      scene.add(
        makeLine(
          THREE,
          new THREE.Vector3(-half, 0, -half),
          new THREE.Vector3(-half, maxBarHeight, -half),
          axisColor
        )
      );
    }

    if (options.showGrid !== false) {
      const grid = new THREE.GridHelper(
        axisSize,
        options.gridDivisions ?? 10,
        options.gridColor ?? 0xcccccc,
        options.gridSubColor ?? 0xe6e6e6
      );

      grid.position.y = 0;
      scene.add(grid);
    }

    const showAxisLabels = options.showAxisLabels !== false;

    if (showAxisLabels) {
      if (options.showXLabel !== false) {
        makeTextSprite(
          THREE,
          scene,
          options.xLabel ?? "X",
          new THREE.Vector3(0, -0.35, -half - 0.55),
          options.axisLabelSize ?? 0.38
        );
      }

      if (options.showZLabel !== false) {
        makeTextSprite(
          THREE,
          scene,
          options.zLabel ?? "Y",
          new THREE.Vector3(-half - 0.65, -0.35, 0),
          options.axisLabelSize ?? 0.38
        );
      }

      if (options.showHLabel !== false) {
        makeTextSprite(
          THREE,
          scene,
          options.hLabel ?? "Frecuencia",
          new THREE.Vector3(-half - 0.85, maxBarHeight + 0.35, -half),
          options.hLabelSize ?? 0.36
        );
      }
    }

    if (options.title && options.showTitle === true) {
      makeTextSprite(
        THREE,
        scene,
        options.title,
        new THREE.Vector3(0, maxBarHeight + 0.9, 0),
        options.titleSize ?? 0.45
      );
    }

    if (options.showTicks !== false) {
      const tickN = options.tickCount ?? 5;

      for (const tx of linspace(hist.xMin, hist.xMax, tickN)) {
        const sx = scaleX(tx);

        scene.add(
          makeLine(
            THREE,
            new THREE.Vector3(sx, 0, -half),
            new THREE.Vector3(sx, 0.08, -half),
            axisColor
          )
        );

        makeTextSprite(
          THREE,
          scene,
          tx.toFixed(options.tickDecimals ?? 1),
          new THREE.Vector3(sx, -0.25, -half - 0.25),
          options.tickSize ?? 0.22,
          {
            font: "bold 40px Arial"
          }
        );
      }

      for (const tz of linspace(hist.zMin, hist.zMax, tickN)) {
        const sz = scaleZ(tz);

        scene.add(
          makeLine(
            THREE,
            new THREE.Vector3(-half, 0, sz),
            new THREE.Vector3(-half, 0.08, sz),
            axisColor
          )
        );

        makeTextSprite(
          THREE,
          scene,
          tz.toFixed(options.tickDecimals ?? 1),
          new THREE.Vector3(-half - 0.35, -0.25, sz),
          options.tickSize ?? 0.22,
          {
            font: "bold 40px Arial"
          }
        );
      }

      for (const th of linspace(0, hist.hMax, tickN)) {
        const sy = scaleH(th);

        scene.add(
          makeLine(
            THREE,
            new THREE.Vector3(-half, sy, -half),
            new THREE.Vector3(-half - 0.08, sy, -half),
            axisColor
          )
        );

        makeTextSprite(
          THREE,
          scene,
          String(Math.round(th)),
          new THREE.Vector3(-half - 0.45, sy, -half),
          options.tickSize ?? 0.22,
          {
            font: "bold 40px Arial"
          }
        );
      }
    }

    addBadge(container, {
      showBadge: options.showBadge !== false,
      logoUrl: options.logoUrl || DEFAULT_LOGO_URL,
      badgeSize: options.badgeSize ?? 112,
      badgeOpacity: options.badgeOpacity ?? 0.95,
      badgeRight: options.badgeRight ?? 16,
      badgeBottom: options.badgeBottom ?? 16
    });

    const resizeObserver = new ResizeObserver(() => {
      const w = Math.max(1, container.clientWidth || width);
      const h = Math.max(1, container.clientHeight || height);

      camera.aspect = w / h;
      camera.updateProjectionMatrix();

      renderer.setSize(w, h);
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
      source: loaded.source,
      scene,
      camera,
      renderer,
      controls,
      resizeObserver,
      raf,
      group,
      histogram: hist
    };

    HANDLES.set(container, handle);

    return handle;
  }

  window.AutoMindHistogram3D = {
    version: VERSION,
    render: renderAutoMindHistogram3D,
    destroy: destroyAutoMindHistogram3D,
    computeHistogram2D,
    loadThree
  };

  window.renderAutoMindHistogram3D = renderAutoMindHistogram3D;
  window.destroyAutoMindHistogram3D = destroyAutoMindHistogram3D;
})();
