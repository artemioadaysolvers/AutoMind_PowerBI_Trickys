(function () {
    "use strict";

    const DEFAULT_LOGO_URL =
        "https://raw.githubusercontent.com/artemioadaysolvers/AutoMindCloudExperimental/main/AutoMindCloud/AutoMindCloud2.png";

    const DEFAULT_OPTIONS = {
        nPoints: 70000,
        bins: 26,
        axisSize: 7.2,
        percentileDomain: 99.25,
        seed: 42,

        minDensityNorm: 0.018,
        minFreqAbs: 2,
        keepTopQuantile: 0.52,
        maxVoxelsVisible: 1400,
        cubeScale: 0.84,
        densityGamma: 1.20,

        height: 720,
        logoUrl: DEFAULT_LOGO_URL,
        showTicks: true,
        showAxisLabels: true
    };

    let threeLoaderPromise = null;

    function mergeOptions(options) {
        return Object.assign({}, DEFAULT_OPTIONS, options || {});
    }

    async function loadThree() {
        if (!threeLoaderPromise) {
            threeLoaderPromise = Promise.all([
                import("https://esm.sh/three@0.160.0?bundle&target=es2020"),
                import("https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js?deps=three@0.160.0&bundle&target=es2020")
            ]).then(([THREE, orbitModule]) => {
                return {
                    THREE: THREE,
                    OrbitControls: orbitModule.OrbitControls
                };
            });
        }

        return threeLoaderPromise;
    }

    function createSeededRandom(seed) {
        let s = Number(seed) || 42;

        return function random() {
            s = Math.imul(1664525, s) + 1013904223;
            return ((s >>> 0) / 4294967296);
        };
    }

    function randn(random) {
        let u = 0;
        let v = 0;

        while (u === 0) u = random();
        while (v === 0) v = random();

        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    function cholesky3(cov) {
        const a00 = cov[0][0];
        const a01 = cov[0][1];
        const a02 = cov[0][2];
        const a11 = cov[1][1];
        const a12 = cov[1][2];
        const a22 = cov[2][2];

        const l00 = Math.sqrt(Math.max(a00, 1e-12));
        const l10 = a01 / l00;
        const l20 = a02 / l00;

        const l11 = Math.sqrt(Math.max(a11 - l10 * l10, 1e-12));
        const l21 = (a12 - l20 * l10) / l11;

        const l22 = Math.sqrt(Math.max(a22 - l20 * l20 - l21 * l21, 1e-12));

        return [
            [l00, 0, 0],
            [l10, l11, 0],
            [l20, l21, l22]
        ];
    }

    function generateDefaultPoints(options) {
        const random = createSeededRandom(options.seed);

        const weights = [0.45, 0.35, 0.20];

        const means = [
            [-1.8, -1.0, 0.6],
            [1.7, 1.2, -0.8],
            [0.2, -2.1, 2.0]
        ];

        const covs = [
            [
                [0.85, 0.35, 0.15],
                [0.35, 0.70, -0.10],
                [0.15, -0.10, 0.55]
            ],
            [
                [0.65, -0.28, 0.20],
                [-0.28, 0.90, 0.30],
                [0.20, 0.30, 0.75]
            ],
            [
                [0.45, 0.05, -0.18],
                [0.05, 0.60, 0.22],
                [-0.18, 0.22, 0.80]
            ]
        ];

        const chol = covs.map(cholesky3);
        const rows = [];

        for (let i = 0; i < options.nPoints; i++) {
            const r = random();
            let component = 0;

            if (r > weights[0] + weights[1]) {
                component = 2;
            } else if (r > weights[0]) {
                component = 1;
            }

            const z0 = randn(random);
            const z1 = randn(random);
            const z2 = randn(random);

            const L = chol[component];
            const m = means[component];

            const x = m[0] + L[0][0] * z0;
            const y = m[1] + L[1][0] * z0 + L[1][1] * z1;
            const z = m[2] + L[2][0] * z0 + L[2][1] * z1 + L[2][2] * z2;

            rows.push({ x, y, z });
        }

        return rows;
    }

    function cleanRows(rows) {
        if (!Array.isArray(rows)) return [];

        const out = [];

        for (const r of rows) {
            const x = Number(r.x ?? r.X);
            const y = Number(r.y ?? r.Y);
            const z = Number(r.z ?? r.Z);

            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                out.push({ x, y, z });
            }
        }

        return out;
    }

    function quantile(values, q) {
        if (!values.length) return NaN;

        const arr = values.slice().sort((a, b) => a - b);
        const pos = (arr.length - 1) * q;
        const base = Math.floor(pos);
        const rest = pos - base;

        if (arr[base + 1] !== undefined) {
            return arr[base] + rest * (arr[base + 1] - arr[base]);
        }

        return arr[base];
    }

    function makeVoxelPayload(rows, options) {
        const cleaned = cleanRows(rows);

        const points = cleaned.length > 0
            ? cleaned
            : generateDefaultPoints(options);

        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        const zs = points.map(p => p.z);

        const pHigh = options.percentileDomain / 100.0;
        const pLow = 1.0 - pHigh;

        const xMin = quantile(xs, pLow);
        const xMax = quantile(xs, pHigh);
        const yMin = quantile(ys, pLow);
        const yMax = quantile(ys, pHigh);
        const zMin = quantile(zs, pLow);
        const zMax = quantile(zs, pHigh);

        const bins = Math.max(2, Math.floor(options.bins));
        const totalBins = bins * bins * bins;
        const H = new Float64Array(totalBins);

        const xRange = Math.max(xMax - xMin, 1e-12);
        const yRange = Math.max(yMax - yMin, 1e-12);
        const zRange = Math.max(zMax - zMin, 1e-12);

        function index3(i, j, k) {
            return i * bins * bins + j * bins + k;
        }

        for (const p of points) {
            if (
                p.x < xMin || p.x > xMax ||
                p.y < yMin || p.y > yMax ||
                p.z < zMin || p.z > zMax
            ) {
                continue;
            }

            let i = Math.floor((p.x - xMin) / xRange * bins);
            let j = Math.floor((p.y - yMin) / yRange * bins);
            let k = Math.floor((p.z - zMin) / zRange * bins);

            i = Math.max(0, Math.min(bins - 1, i));
            j = Math.max(0, Math.min(bins - 1, j));
            k = Math.max(0, Math.min(bins - 1, k));

            H[index3(i, j, k)] += 1;
        }

        let hMax = 0;

        for (let n = 0; n < H.length; n++) {
            if (H[n] > hMax) hMax = H[n];
        }

        const xBinWidth = xRange / bins;
        const yBinWidth = yRange / bins;
        const zBinWidth = zRange / bins;

        let voxels = [];

        for (let i = 0; i < bins; i++) {
            for (let j = 0; j < bins; j++) {
                for (let k = 0; k < bins; k++) {
                    const freq = H[index3(i, j, k)];

                    if (freq <= 0) continue;

                    const xCenter = xMin + (i + 0.5) * xBinWidth;
                    const yCenter = yMin + (j + 0.5) * yBinWidth;
                    const zCenter = zMin + (k + 0.5) * zBinWidth;

                    voxels.push({
                        x_center: xCenter,
                        y_center: yCenter,
                        z_center: zCenter,
                        freq: freq,
                        density_norm: freq / Math.max(hMax, 1e-12)
                    });
                }
            }
        }

        const freqs = voxels.map(v => v.freq);
        const thresholdQuantile = quantile(freqs, options.keepTopQuantile);
        const thresholdDensity = hMax * options.minDensityNorm;

        const freqThreshold = Math.max(
            options.minFreqAbs,
            thresholdQuantile,
            thresholdDensity
        );

        voxels = voxels.filter(v => v.freq >= freqThreshold);

        if (voxels.length > options.maxVoxelsVisible) {
            voxels = voxels
                .sort((a, b) => b.freq - a.freq)
                .slice(0, options.maxVoxelsVisible);
        }

        const logFreq = voxels.map(v => Math.log1p(v.freq));
        const q1 = quantile(logFreq, 0.02);
        const q2 = quantile(logFreq, 0.995);

        for (let i = 0; i < voxels.length; i++) {
            let densityVisual = (logFreq[i] - q1) / (q2 - q1 + 1e-12);
            densityVisual = Math.max(0, Math.min(1, densityVisual));
            densityVisual = Math.pow(densityVisual, options.densityGamma);

            let alpha = 0.10 + 0.78 * Math.pow(densityVisual, 1.12);
            alpha = Math.max(0.08, Math.min(0.88, alpha));

            voxels[i].density_visual = densityVisual;
            voxels[i].alpha = alpha;
        }

        voxels = voxels.sort((a, b) => a.density_visual - b.density_visual);

        return {
            voxels,

            xMin,
            xMax,
            yMin,
            yMax,
            zMin,
            zMax,

            freqMax: hMax,
            freqThreshold,
            bins,
            axisSize: options.axisSize,

            xBinWidth,
            yBinWidth,
            zBinWidth,

            cubeScale: options.cubeScale,
            logoUrl: options.logoUrl
        };
    }

    function resolveContainer(container) {
        if (typeof container === "string") {
            return document.querySelector(container);
        }

        if (container instanceof HTMLElement) {
            return container;
        }

        return null;
    }

    function injectContainerStyles(container, options) {
        container.innerHTML = "";

        container.style.position = "relative";
        container.style.width = "100%";
        container.style.height = `${options.height}px`;
        container.style.overflow = "hidden";
        container.style.background = "radial-gradient(circle at center, #ffffff 0%, #fbfbfb 58%, #f2f2f2 100%)";
        container.style.border = "1px solid rgba(0,0,0,0.12)";
        container.style.borderRadius = "14px";
        container.style.boxSizing = "border-box";

        const badge = document.createElement("div");
        badge.style.position = "absolute";
        badge.style.right = "16px";
        badge.style.bottom = "16px";
        badge.style.zIndex = "30";
        badge.style.pointerEvents = "none";
        badge.style.userSelect = "none";

        const img = document.createElement("img");
        img.src = options.logoUrl;
        img.alt = "AutoMind";
        img.style.width = "118px";
        img.style.height = "118px";
        img.style.objectFit = "contain";

        // Insignia limpia: sin fog, sin sombra, sin blur.
        img.style.opacity = "1";
        img.style.filter = "none";
        img.style.mixBlendMode = "normal";

        badge.appendChild(img);
        container.appendChild(badge);
    }

    function disposeObject3D(THREE, object) {
        object.traverse((child) => {
            if (child.geometry) {
                child.geometry.dispose();
            }

            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((m) => {
                        if (m.map) m.map.dispose();
                        m.dispose();
                    });
                } else {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            }
        });
    }

    async function render(config) {
        const options = mergeOptions(config && config.options);
        const container = resolveContainer(config && config.container);

        if (!container) {
            throw new Error("AutoMindVoxel3D: container inválido.");
        }

        if (container.__automindVoxelCleanup) {
            container.__automindVoxelCleanup();
            container.__automindVoxelCleanup = null;
        }

        injectContainerStyles(container, options);

        const payload = makeVoxelPayload(config && config.rows, options);
        const { THREE, OrbitControls } = await loadThree();

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xffffff);

        // Sin fog en toda la escena.
        scene.fog = null;

        const mainGroup = new THREE.Group();
        scene.add(mainGroup);

        scene.add(new THREE.AmbientLight(0xffffff, 1.15));

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
        keyLight.position.set(7, 10, 8);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xffffff, 0.45);
        fillLight.position.set(-6, -4, 7);
        scene.add(fillLight);

        const width = container.clientWidth;
        const height = container.clientHeight;

        const camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 5000);
        camera.position.set(8.5, 6.8, 9.8);

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });

        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.sortObjects = true;

        if ("outputColorSpace" in renderer) {
            renderer.outputColorSpace = THREE.SRGBColorSpace;
        }

        renderer.domElement.style.position = "absolute";
        renderer.domElement.style.left = "0";
        renderer.domElement.style.top = "0";
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.zIndex = "1";

        container.insertBefore(renderer.domElement, container.firstChild);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.080;
        controls.rotateSpeed = 0.68;
        controls.panSpeed = 0.60;
        controls.zoomSpeed = 1.05;
        controls.enablePan = true;
        controls.enableZoom = true;
        controls.screenSpacePanning = true;
        controls.minDistance = 1.0;
        controls.maxDistance = 100.0;
        controls.target.set(0, 0, 0);
        controls.update();

        const axisSize = payload.axisSize;
        const half = axisSize / 2;

        const xRange = Math.max(payload.xMax - payload.xMin, 1e-12);
        const yRange = Math.max(payload.yMax - payload.yMin, 1e-12);
        const zRange = Math.max(payload.zMax - payload.zMin, 1e-12);

        function clamp(v, a, b) {
            return Math.max(a, Math.min(b, v));
        }

        function scaleX(x) {
            return ((x - payload.xMin) / xRange - 0.5) * axisSize;
        }

        function scaleY(y) {
            return ((y - payload.yMin) / yRange - 0.5) * axisSize;
        }

        function scaleZ(z) {
            return ((z - payload.zMin) / zRange - 0.5) * axisSize;
        }

        const cubeW = payload.xBinWidth / xRange * axisSize * payload.cubeScale;
        const cubeH = payload.yBinWidth / yRange * axisSize * payload.cubeScale;
        const cubeD = payload.zBinWidth / zRange * axisSize * payload.cubeScale;

        function colorByDensity(t) {
            t = clamp(t, 0, 1);

            const c0 = new THREE.Color(0xfff5f0);
            const c1 = new THREE.Color(0xffc2ad);
            const c2 = new THREE.Color(0xff7043);
            const c3 = new THREE.Color(0xd7191c);
            const c4 = new THREE.Color(0x8b0000);

            if (t < 0.30) {
                return c0.clone().lerp(c1, t / 0.30);
            }

            if (t < 0.58) {
                return c1.clone().lerp(c2, (t - 0.30) / 0.28);
            }

            if (t < 0.82) {
                return c2.clone().lerp(c3, (t - 0.58) / 0.24);
            }

            return c3.clone().lerp(c4, (t - 0.82) / 0.18);
        }

        const voxelsGroup = new THREE.Group();
        const boxGeometry = new THREE.BoxGeometry(cubeW, cubeH, cubeD);

        let counter = 0;

        for (const v of payload.voxels) {
            const t = clamp(v.density_visual ?? v.density_norm, 0, 1);
            const alpha = clamp(v.alpha ?? (0.12 + 0.70 * t), 0.05, 0.90);

            const material = new THREE.MeshLambertMaterial({
                color: colorByDensity(t),
                transparent: true,
                opacity: alpha,
                depthWrite: t > 0.80,
                depthTest: true
            });

            const cube = new THREE.Mesh(boxGeometry, material);

            cube.position.set(
                scaleX(v.x_center),
                scaleY(v.y_center),
                scaleZ(v.z_center)
            );

            cube.renderOrder = 10 + Math.round(t * 500) + counter * 0.0001;

            voxelsGroup.add(cube);
            counter += 1;
        }

        mainGroup.add(voxelsGroup);

        function makeLine(a, b, color = 0x111111, opacity = 0.90) {
            const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);

            const material = new THREE.LineBasicMaterial({
                color: color,
                transparent: true,
                opacity: opacity,
                depthTest: true,
                depthWrite: false
            });

            return new THREE.Line(geometry, material);
        }

        function makeArrowHead(position, direction, color = 0x111111) {
            const geometry = new THREE.ConeGeometry(0.075, 0.24, 24);

            const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.95
            });

            const cone = new THREE.Mesh(geometry, material);
            cone.position.copy(position);

            const up = new THREE.Vector3(0, 1, 0);
            cone.quaternion.setFromUnitVectors(up, direction.clone().normalize());

            return cone;
        }

        const axesGroup = new THREE.Group();

        const originCorner = new THREE.Vector3(-half, -half, -half);
        const xEnd = new THREE.Vector3(half + 0.45, -half, -half);
        const yEnd = new THREE.Vector3(-half, half + 0.45, -half);
        const zEnd = new THREE.Vector3(-half, -half, half + 0.45);

        axesGroup.add(makeLine(originCorner, xEnd, 0x111111, 0.92));
        axesGroup.add(makeLine(originCorner, yEnd, 0x111111, 0.92));
        axesGroup.add(makeLine(originCorner, zEnd, 0x111111, 0.92));

        axesGroup.add(makeArrowHead(xEnd, new THREE.Vector3(1, 0, 0), 0x111111));
        axesGroup.add(makeArrowHead(yEnd, new THREE.Vector3(0, 1, 0), 0x111111));
        axesGroup.add(makeArrowHead(zEnd, new THREE.Vector3(0, 0, 1), 0x111111));

        mainGroup.add(axesGroup);

        function makeTextSprite(text, position, size = 0.28, color = "#111111") {
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 160;

            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.font = "bold 46px Arial";
            ctx.fillStyle = color;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text, canvas.width / 2, canvas.height / 2);

            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;

            const material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                opacity: 0.96,
                depthTest: false,
                depthWrite: false
            });

            const sprite = new THREE.Sprite(material);
            sprite.position.copy(position);
            sprite.scale.set(size * 3.4, size * 1.05, 1);
            sprite.renderOrder = 9999;

            scene.add(sprite);
            return sprite;
        }

        if (options.showAxisLabels) {
            makeTextSprite("X", new THREE.Vector3(half + 0.90, -half, -half), 0.30);
            makeTextSprite("Y", new THREE.Vector3(-half, half + 0.90, -half), 0.30);
            makeTextSprite("Z", new THREE.Vector3(-half, -half, half + 0.90), 0.30);
        }

        function linspace(a, b, n) {
            const arr = [];

            for (let i = 0; i < n; i++) {
                arr.push(a + (b - a) * i / (n - 1));
            }

            return arr;
        }

        if (options.showTicks) {
            const tickN = 4;
            const tickLen = 0.11;

            for (const tx of linspace(payload.xMin, payload.xMax, tickN)) {
                const sx = scaleX(tx);

                axesGroup.add(makeLine(
                    new THREE.Vector3(sx, -half, -half),
                    new THREE.Vector3(sx, -half - tickLen, -half),
                    0x111111,
                    0.70
                ));

                makeTextSprite(
                    tx.toFixed(1),
                    new THREE.Vector3(sx, -half - 0.34, -half - 0.13),
                    0.15,
                    "#222222"
                );
            }

            for (const ty of linspace(payload.yMin, payload.yMax, tickN)) {
                const sy = scaleY(ty);

                axesGroup.add(makeLine(
                    new THREE.Vector3(-half, sy, -half),
                    new THREE.Vector3(-half - tickLen, sy, -half),
                    0x111111,
                    0.70
                ));

                makeTextSprite(
                    ty.toFixed(1),
                    new THREE.Vector3(-half - 0.38, sy, -half - 0.13),
                    0.15,
                    "#222222"
                );
            }

            for (const tz of linspace(payload.zMin, payload.zMax, tickN)) {
                const sz = scaleZ(tz);

                axesGroup.add(makeLine(
                    new THREE.Vector3(-half, -half, sz),
                    new THREE.Vector3(-half - tickLen, -half, sz),
                    0x111111,
                    0.70
                ));

                makeTextSprite(
                    tz.toFixed(1),
                    new THREE.Vector3(-half - 0.38, -half - 0.20, sz),
                    0.15,
                    "#222222"
                );
            }
        }

        function fitCameraToObject(camera, object, controls, offset = 1.38) {
            const box = new THREE.Box3().setFromObject(object);
            const size = new THREE.Vector3();
            const center = new THREE.Vector3();

            box.getSize(size);
            box.getCenter(center);

            const maxDim = Math.max(size.x, size.y, size.z);

            const fovRad = THREE.MathUtils.degToRad(camera.fov);
            const fitHeightDistance = maxDim / (2 * Math.tan(fovRad / 2));
            const fitWidthDistance = fitHeightDistance / Math.max(camera.aspect, 1e-6);
            const distance = offset * Math.max(fitHeightDistance, fitWidthDistance);

            const direction = new THREE.Vector3(1.05, 0.82, 1.18).normalize();

            camera.position.copy(center).add(direction.multiplyScalar(distance));
            camera.near = Math.max(distance / 200, 0.01);
            camera.far = distance * 200;
            camera.updateProjectionMatrix();

            controls.target.copy(center);
            controls.minDistance = Math.max(distance * 0.24, 1.20);
            controls.maxDistance = distance * 4.20;

            controls.update();
        }

        fitCameraToObject(camera, mainGroup, controls, 1.42);

        function resizeRenderer() {
            const w = Math.max(container.clientWidth, 1);
            const h = Math.max(container.clientHeight, 1);

            camera.aspect = w / h;
            camera.updateProjectionMatrix();

            renderer.setSize(w, h);
        }

        window.addEventListener("resize", resizeRenderer);

        let resizeObserver = null;

        if ("ResizeObserver" in window) {
            resizeObserver = new ResizeObserver(resizeRenderer);
            resizeObserver.observe(container);
        }

        let disposed = false;

        function animate() {
            if (disposed) return;

            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }

        animate();

        container.__automindVoxelCleanup = function cleanup() {
            disposed = true;

            window.removeEventListener("resize", resizeRenderer);

            if (resizeObserver) {
                resizeObserver.disconnect();
            }

            controls.dispose();
            disposeObject3D(THREE, scene);
            renderer.dispose();

            if (renderer.domElement && renderer.domElement.parentNode) {
                renderer.domElement.parentNode.removeChild(renderer.domElement);
            }
        };

        return {
            payload,
            scene,
            camera,
            renderer,
            controls,
            destroy: container.__automindVoxelCleanup
        };
    }

    window.AutoMindVoxel3D = {
        render,
        makeVoxelPayload,
        version: "1.0.0"
    };

    window.renderAutoMindVoxel3D = render;

})();
