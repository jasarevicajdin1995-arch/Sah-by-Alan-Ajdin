import * as THREE from "three";
import { GLTFLoader }      from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment }  from "three/addons/environments/RoomEnvironment.js";
import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

// ═══════════════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════════════
const chess = new Chess();
const FILES = ["a","b","c","d","e","f","g","h"];

let selectedSquare    = null;
let legalTargets      = [];
let lastMoveSquares   = [];
let engineBusy        = false;
let engineReady       = false;
let engineStartSent   = false;
let pendingEngineMove = false;
let engineLoadTimer   = null;
let isAnimating       = false;

// ═══════════════════════════════════════════════════════════════
//  DOM
// ═══════════════════════════════════════════════════════════════
const statusTextEl   = document.getElementById("status-text");
const lastMoveEl     = document.getElementById("last-move-text");
const mateBannerEl   = document.getElementById("mate-banner");
const newGameBtn     = document.getElementById("new-game");
const toggleMusicBtn = document.getElementById("toggle-music");
const prevSongBtn    = document.getElementById("prev-song");
const nextSongBtn    = document.getElementById("next-song");
const songNameEl     = document.getElementById("song-name");
const musicStateEl   = document.getElementById("music-state");
const canvasEl       = document.getElementById("board-canvas");
const boardContainer = document.getElementById("board-container");
const diffBtns       = document.querySelectorAll(".diff-btn");

// ═══════════════════════════════════════════════════════════════
//  DIFFICULTY
// ═══════════════════════════════════════════════════════════════
const DIFFICULTY = {
  easy:   { skill: 2,  depth: 5,  label: "🟢 Lako"    },
  medium: { skill: 10, depth: 12, label: "🟡 Srednje"  },
  hard:   { skill: 20, depth: 18, label: "🔴 Teško"    },
};

let currentDifficulty = "medium";

diffBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    currentDifficulty = btn.dataset.level;
    diffBtns.forEach(b => b.classList.toggle("active", b === btn));
    // Apply skill level immediately if engine is ready
    if (engine && engineReady) {
      engine.postMessage(`setoption name Skill Level value ${DIFFICULTY[currentDifficulty].skill}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
//  RENDERER
// ═══════════════════════════════════════════════════════════════
const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled    = true;
renderer.shadowMap.type       = THREE.PCFSoftShadowMap;
renderer.outputColorSpace     = THREE.SRGBColorSpace;
renderer.toneMapping          = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure  = 1.1;

// ═══════════════════════════════════════════════════════════════
//  SCENE  +  ROOM ENVIRONMENT (gives metallic reflections)
// ═══════════════════════════════════════════════════════════════
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0e06);

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment()).texture;
scene.environment = envMap;
pmrem.dispose();

// ═══════════════════════════════════════════════════════════════
//  CAMERA  (GLB space — board ≈ 19 units wide)
// ═══════════════════════════════════════════════════════════════
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);
// Board center XZ ≈ (-0.1, -0.7).  Look from white's side (z positive).
camera.position.set(-0.1, 32, 24);
camera.lookAt(-0.1, 0, -2);

// ═══════════════════════════════════════════════════════════════
//  LIGHTS
// ═══════════════════════════════════════════════════════════════
scene.add(new THREE.AmbientLight(0xfff4e8, 0.3));

const key = new THREE.DirectionalLight(0xfff8f0, 1.6);
key.position.set(-5, 45, 25);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1; key.shadow.camera.far = 100;
key.shadow.camera.left = key.shadow.camera.bottom = -16;
key.shadow.camera.right= key.shadow.camera.top    =  16;
key.shadow.bias = -0.0005;
scene.add(key);

const fill = new THREE.DirectionalLight(0x9ab8e0, 0.5);
fill.position.set(10, 20, -20);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xffe0b0, 0.25);
rim.position.set(0, 10, -30);
scene.add(rim);

// ═══════════════════════════════════════════════════════════════
//  GLB COORDINATE SYSTEM
//  Board spans X: -9.8…+9.5 (8 files, step≈2.74)
//               Z: -10.4…+9.0 (8 ranks, step≈2.76)
//  Rank 1 (white) at z≈+9,  Rank 8 (black) at z≈-10.4
// ═══════════════════════════════════════════════════════════════
const GLB_X0 = -9.68;   // file-a center X
const GLB_XS =  2.74;   // X step per file
const GLB_Z0 = -10.36;  // rank-8 center Z  (black back rank)
const GLB_ZS =  2.76;   // Z step per rank (toward white = +Z)
const GLB_Y  =  0.0;    // board surface Y

function glbPos(sq) {
  const fi = sq.charCodeAt(0) - 97;      // a=0 … h=7
  const rk = parseInt(sq[1]);             // 1–8
  return new THREE.Vector3(
    GLB_X0 + fi * GLB_XS,
    GLB_Y,
    GLB_Z0 + (8 - rk) * GLB_ZS
  );
}

// ═══════════════════════════════════════════════════════════════
//  PIECE MATERIALS  — metallic PBR
// ═══════════════════════════════════════════════════════════════
const MAT_W = new THREE.MeshStandardMaterial({
  color: 0xddd5b8, roughness: 0.14, metalness: 0.35, envMapIntensity: 1.6,
});
// Dark rosewood/walnut — clearly visible silhouettes, warm brown not pitch-black
const MAT_B = new THREE.MeshStandardMaterial({
  color: 0x5a2d0c, roughness: 0.30, metalness: 0.20, envMapIntensity: 1.0,
});
const MAT_BOARD_BOOST = { envMapIntensity: 0.7 };

// ═══════════════════════════════════════════════════════════════
//  PIECE TRACKING
// ═══════════════════════════════════════════════════════════════
// Maps chess square → the THREE.Object3D (parent group of the piece mesh)
const pieceAtSquare = new Map();

// Templates for cloning (promotions)
// templates[color][type] = { obj: Object3D, homeSq: string }
const templates = { w: {}, b: {} };

// Cloned promotion pieces (so we can remove them on new game)
const promotionPieces = [];

// ═══════════════════════════════════════════════════════════════
//  GLB LOADING
// ═══════════════════════════════════════════════════════════════
function loadGLB() {
  return new Promise((resolve) => {
    new GLTFLoader().load(
      "./assets/chess-set.glb",
      (gltf) => {
        const root = gltf.scene;
        scene.add(root);

        // ── Identify piece meshes by material name ──────────────
        // aiStandardSurface1 = white pieces
        // aiStandardSurface2 = black pieces
        // aiStandardSurface3 = board
        const pieceMeshes = [];   // { mesh, color }

        root.traverse(obj => {
          if (!obj.isMesh) return;

          const matName = obj.material?.name ?? "";
          obj.castShadow    = true;
          obj.receiveShadow = true;

          if (matName === "aiStandardSurface1") {
            obj.material = MAT_W;
            pieceMeshes.push({ mesh: obj, color: "w" });
          } else if (matName === "aiStandardSurface2") {
            obj.material = MAT_B;
            pieceMeshes.push({ mesh: obj, color: "b" });
          } else {
            // Board — keep original material, boost environment reflections
            if (obj.material) {
              obj.material = obj.material.clone();
              obj.material.envMapIntensity = MAT_BOARD_BOOST.envMapIntensity;
            }
            obj.receiveShadow = true;
            obj.castShadow    = false;
          }
        });

        // ── Map each piece mesh → nearest chess square ──────────
        // Use its world-space bounding box center (geometry is in world/root space
        // since all node transforms are identity)
        const initialBoard = chess.board();

        function boardPieceAt(sq) {
          const fi = sq.charCodeAt(0) - 97;
          const ri = 8 - parseInt(sq[1]);
          return initialBoard[ri][fi];
        }

        for (const { mesh, color } of pieceMeshes) {
          // Compute world-space bbox center (in GLB/root space)
          const bbox = new THREE.Box3().setFromObject(mesh);
          const cx = (bbox.min.x + bbox.max.x) / 2;
          const cz = (bbox.min.z + bbox.max.z) / 2;

          // Find nearest starting square for this color
          let bestSq = null, bestDist = Infinity;
          for (let ri = 0; ri < 8; ri++) {
            for (let fi = 0; fi < 8; fi++) {
              const sq  = FILES[fi] + (8 - ri);
              const bp  = boardPieceAt(sq);
              if (!bp || bp.color !== color) continue;   // skip squares of wrong color or empty

              const pos  = glbPos(sq);
              const dist = Math.hypot(cx - pos.x, cz - pos.z);
              if (dist < bestDist) { bestDist = dist; bestSq = sq; }
            }
          }

          if (!bestSq || bestDist > 2.5) {
            // Couldn't match — skip (board mesh etc.)
            continue;
          }

          // Use the mesh's DIRECT PARENT as the moveable object
          // (so we translate the group containing the mesh)
          const moveable = mesh.parent ?? mesh;

          pieceAtSquare.set(bestSq, moveable);

          // Record as template for this piece type
          const type = boardPieceAt(bestSq).type;   // k/q/b/n/r/p
          if (!templates[color][type]) {
            templates[color][type] = { obj: moveable, homeSq: bestSq };
          }
        }

        resolve();
      },
      undefined,
      (err) => { console.error("GLB load error:", err); resolve(); }
    );
  });
}

// ═══════════════════════════════════════════════════════════════
//  PIECE MOVEMENT HELPERS
// ═══════════════════════════════════════════════════════════════
function movePieceObjTo(obj, fromSq, toSq) {
  // Translate the object by the delta in GLB units
  const from = glbPos(fromSq);
  const to   = glbPos(toSq);
  obj.position.x += to.x - from.x;
  obj.position.z += to.z - from.z;
  obj.position.y  = 0;
}

function removePiece(sq) {
  const obj = pieceAtSquare.get(sq);
  if (obj) { obj.visible = false; pieceAtSquare.delete(sq); }
}

function cloneForPromotion(color, type, toSq) {
  const tmpl = templates[color][type];
  if (!tmpl) return null;

  const clone = tmpl.obj.clone(true);
  clone.visible = true;
  // Set position: delta from template's home square to target square
  const from = glbPos(tmpl.homeSq);
  const to   = glbPos(toSq);
  clone.position.set(to.x - from.x, 0, to.z - from.z);
  clone.traverse(c => {
    if (c.isMesh) {
      c.material    = color === "w" ? MAT_W : MAT_B;
      c.castShadow  = true;
    }
  });
  scene.add(clone);
  promotionPieces.push(clone);
  return clone;
}

// ═══════════════════════════════════════════════════════════════
//  HIGHLIGHTS
// ═══════════════════════════════════════════════════════════════
const hlMeshes  = [];
const SQ_SIZE   = 2.6;
const HL_Y      = 0.5;  // slightly above board surface

function clearHighlights() { hlMeshes.forEach(m => scene.remove(m)); hlMeshes.length = 0; }

function addOverlay(sq, color, opacity) {
  const p = glbPos(sq);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(SQ_SIZE, SQ_SIZE),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(p.x, HL_Y, p.z);
  m.renderOrder = 2;
  scene.add(m); hlMeshes.push(m);
}

function addDot(sq) {
  const p = glbPos(sq);
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 16),
    new THREE.MeshBasicMaterial({ color: 0x228844, transparent: true, opacity: 0.78, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(p.x, HL_Y + 0.05, p.z);
  m.renderOrder = 2;
  scene.add(m); hlMeshes.push(m);
}

function updateHighlights() {
  clearHighlights();
  lastMoveSquares.forEach(sq => addOverlay(sq, 0xddcc22, 0.42));
  if (selectedSquare) {
    addOverlay(selectedSquare, 0x88dd22, 0.52);
    legalTargets.forEach(sq =>
      chess.get(sq) ? addOverlay(sq, 0x22bb44, 0.45) : addDot(sq)
    );
  }
}

// ═══════════════════════════════════════════════════════════════
//  INVISIBLE HIT-TEST SQUARES  (for raycasting)
// ═══════════════════════════════════════════════════════════════
const hitSquares = new Map();
const hitGeo = new THREE.PlaneGeometry(SQ_SIZE, SQ_SIZE);
const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

function buildHitSquares() {
  for (let ri = 0; ri < 8; ri++) {
    for (let fi = 0; fi < 8; fi++) {
      const sq = FILES[fi] + (8 - ri);
      const p  = glbPos(sq);
      const m  = new THREE.Mesh(hitGeo, hitMat);
      m.rotation.x    = -Math.PI / 2;
      m.position.set(p.x, HL_Y + 0.1, p.z);
      m.userData.square = sq;
      hitSquares.set(sq, m);
      scene.add(m);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════════════
let renderPending = false;

function requestRender() {
  if (renderPending || isAnimating) return;
  renderPending = true;
  requestAnimationFrame(() => { renderer.render(scene, camera); renderPending = false; });
}

function resizeRenderer() {
  const w = boardContainer.clientWidth, h = boardContainer.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}

new ResizeObserver(resizeRenderer).observe(boardContainer);

// ═══════════════════════════════════════════════════════════════
//  ANIMATION  (arc)
// ═══════════════════════════════════════════════════════════════
function animateMove(fromSq, toSq, extraObjRemove, onComplete) {
  const obj = pieceAtSquare.get(fromSq);
  if (!obj) { onComplete(); return; }

  // Remove captured piece immediately
  if (extraObjRemove) { extraObjRemove.visible = false; }

  const fromPos = glbPos(fromSq);
  const toPos   = glbPos(toSq);
  const dx = toPos.x - fromPos.x;
  const dz = toPos.z - fromPos.z;
  const dist = Math.hypot(dx, dz);
  const ARC  = Math.min(dist * 0.25, 4.0);
  const T    = 320;

  const sx = obj.position.x, sz = obj.position.z;

  pieceAtSquare.delete(fromSq);
  pieceAtSquare.set(toSq, obj);

  isAnimating = true;
  const t0 = performance.now();

  (function step(now) {
    const raw = Math.min((now - t0) / T, 1);
    const t   = raw < 0.5 ? 2*raw*raw : -1+(4-2*raw)*raw;
    obj.position.set(sx + dx*t, Math.sin(t*Math.PI)*ARC, sz + dz*t);
    renderer.render(scene, camera);
    if (raw < 1) requestAnimationFrame(step);
    else {
      obj.position.set(sx + dx, 0, sz + dz);
      isAnimating = false;
      onComplete();
    }
  })(t0);
}

// ═══════════════════════════════════════════════════════════════
//  BOARD REBUILD  (after special moves: castling, en-passant, promotion)
// ═══════════════════════════════════════════════════════════════
function syncPiecesToBoard() {
  // After a move, chess.js has the new board state.
  // We need to handle:
  //  - En passant (captured pawn removed from a non-destination square)
  //  - Castling (rook moved separately)
  //  - Promotion (pawn → queen etc.)
  //
  // Strategy: compare pieceAtSquare to chess.board() and fix discrepancies.
  const board = chess.board();

  for (let ri = 0; ri < 8; ri++) {
    for (let fi = 0; fi < 8; fi++) {
      const sq  = FILES[fi] + (8 - ri);
      const bp  = board[ri][fi];
      const has = pieceAtSquare.has(sq);

      if (!bp && has) {
        // Piece exists visually but not in game → it was captured (en passant)
        pieceAtSquare.get(sq).visible = false;
        pieceAtSquare.delete(sq);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  INTERACTION
// ═══════════════════════════════════════════════════════════════
const raycaster = new THREE.Raycaster();
const pointer   = new THREE.Vector2();

function handleSquareClick(sq) {
  if (isAnimating || chess.turn() !== "w" || engineBusy || chess.isGameOver()) return;
  const piece = chess.get(sq);

  if (selectedSquare) {
    if (legalTargets.includes(sq))  { executePlayerMove(selectedSquare, sq); return; }
    if (piece?.color === "w")        { selectSquare(sq); return; }
    deselect();
    return;
  }
  if (piece?.color === "w") selectSquare(sq);
}

function selectSquare(sq) {
  selectedSquare = sq;
  legalTargets   = chess.moves({ square: sq, verbose: true }).map(m => m.to);
  playLiftSound(); updateHighlights(); requestRender();
}

function deselect() {
  selectedSquare = null; legalTargets = [];
  updateHighlights(); requestRender();
}

function executePlayerMove(from, to) {
  const capturePieceObj = pieceAtSquare.get(to) ?? null;

  // Apply move in chess.js first
  const move = chess.move({ from, to, promotion: "q" });
  if (!move) { deselect(); return; }

  lastMoveSquares = [from, to];
  selectedSquare  = null; legalTargets = [];
  updateHighlights();
  playMoveSound(!!move.captured);

  animateMove(from, to, capturePieceObj, () => {
    // Handle castling / en-passant / promotion visuals
    handleSpecialMove(move);
    syncPiecesToBoard();
    updateAfterMove(move, "Ti");
    if (!chess.isGameOver()) requestEngineMove();
  });
}

function handleSpecialMove(move) {
  // ── Castling: move the rook ──────────────────────────────────
  if (move.flags.includes("k") || move.flags.includes("q")) {
    const rank = move.color === "w" ? "1" : "8";
    const kside = move.flags.includes("k");
    const rookFrom = (kside ? "h" : "a") + rank;
    const rookTo   = (kside ? "f" : "d") + rank;
    const rookObj  = pieceAtSquare.get(rookFrom);
    if (rookObj) {
      movePieceObjTo(rookObj, rookFrom, rookTo);
      pieceAtSquare.delete(rookFrom);
      pieceAtSquare.set(rookTo, rookObj);
    }
  }

  // ── Promotion: swap pawn for queen visually ──────────────────
  if (move.flags.includes("p")) {
    const pawnObj = pieceAtSquare.get(move.to);
    if (pawnObj) { pawnObj.visible = false; pieceAtSquare.delete(move.to); }
    const newPiece = cloneForPromotion(move.color, move.promotion || "q", move.to);
    if (newPiece) pieceAtSquare.set(move.to, newPiece);
  }
}

canvasEl.addEventListener("pointerdown", event => {
  event.preventDefault(); unlockAudio();
  if (isAnimating) return;

  const rect = canvasEl.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width)  *  2 - 1,
    ((event.clientY - rect.top)  / rect.height) * -2 + 1
  );
  raycaster.setFromCamera(pointer, camera);

  // 1. Pieces first (higher priority)
  const pieceParts = [];
  pieceAtSquare.forEach(obj => obj.traverse(c => { if (c.isMesh) pieceParts.push(c); }));
  const ph = raycaster.intersectObjects(pieceParts);
  if (ph.length) {
    let o = ph[0].object;
    // Walk up until we find a parent that's tracked in pieceAtSquare
    const tracked = new Set(pieceAtSquare.values());
    while (o && !tracked.has(o)) o = o.parent;
    if (o) {
      let sq = null;
      pieceAtSquare.forEach((v,k) => { if (v === o) sq = k; });
      if (sq) { handleSquareClick(sq); return; }
    }
  }

  // 2. Hit-test squares
  const sh = raycaster.intersectObjects([...hitSquares.values()]);
  if (sh.length) handleSquareClick(sh[0].object.userData.square);
});

// ═══════════════════════════════════════════════════════════════
//  STOCKFISH ENGINE  (unchanged)
// ═══════════════════════════════════════════════════════════════
const engine = (() => {
  try {
    const w = new Worker("./stockfish-worker.js");
    w.onmessage = handleEngineMsg;
    w.onerror   = () => { engineReady = engineBusy = false; setStatus("Stockfish se nije učitao."); };
    engineLoadTimer = setTimeout(() => { if (!engineReady) setStatus("Stockfish se još učitava…"); }, 5000);
    w.postMessage("uci");
    w.postMessage(`setoption name Skill Level value ${DIFFICULTY[currentDifficulty].skill}`);
    w.postMessage("isready");
    engineStartSent = true;
    return w;
  } catch { setStatus("Stockfish nije dostupan."); return null; }
})();

function requestEngineMove() {
  if (!engine) { setStatus("Stockfish nije dostupan."); return; }
  if (!engineReady) {
    pendingEngineMove = true;
    if (!engineStartSent) { engine.postMessage("uci"); engine.postMessage("isready"); engineStartSent = true; }
    setStatus("Stockfish se priprema…"); return;
  }
  pendingEngineMove = false; engineBusy = true;
  setStatus("Stockfish razmišlja…");
  engine.postMessage("ucinewgame");
  engine.postMessage(`position fen ${chess.fen()}`);
  engine.postMessage(`go depth ${DIFFICULTY[currentDifficulty].depth}`);
}

function handleEngineMsg(event) {
  const text = (typeof event.data === "string") ? event.data.trim() : "";
  if (!text) return;
  if (text === "uciok")   { engineStartSent = true; return; }
  if (text === "readyok") {
    engineReady = true;
    engine.postMessage(`setoption name Skill Level value ${DIFFICULTY[currentDifficulty].skill}`);
    if (engineLoadTimer) { clearTimeout(engineLoadTimer); engineLoadTimer = null; }
    if (pendingEngineMove && chess.turn() === "b" && !chess.isGameOver()) requestEngineMove();
    else refreshStatus(); return;
  }
  if (text.startsWith("bestmove ")) {
    engineBusy = false;
    const bm = text.split(/\s+/)[1];
    if (!bm || bm === "(none)") { refreshStatus(); return; }
    const from = bm.slice(0,2), to = bm.slice(2,4), pro = bm.slice(4,5)||"q";

    const capturePieceObj = pieceAtSquare.get(to) ?? null;
    const move = chess.move({ from, to, promotion: pro });
    if (!move) { refreshStatus(); return; }

    lastMoveSquares = [from, to];
    playMoveSound(!!move.captured);

    animateMove(from, to, capturePieceObj, () => {
      handleSpecialMove(move);
      syncPiecesToBoard();
      updateAfterMove(move, "Stockfish");
    });
    updateHighlights(); requestRender();
  }
}

// ═══════════════════════════════════════════════════════════════
//  STATUS
// ═══════════════════════════════════════════════════════════════
function setStatus(msg) { statusTextEl.textContent = msg; }

function updateAfterMove(move, actor) {
  lastMoveEl.textContent = `${actor}: ${move.san || move.from+"→"+move.to}`;
  mateBannerEl.classList.add("hidden");
  if (chess.isCheckmate()) {
    const won = actor === "Ti";
    mateBannerEl.textContent = won ? "Mat! Pobijedio si! 🏆" : "Mat! Izgubio si.";
    mateBannerEl.classList.remove("hidden");
    setStatus(won ? "Čestitamo! Pobijedio si Stockfish!" : "Mat! Stockfish je pobijedio."); return;
  }
  if (chess.isStalemate()) { setStatus("Pat! Remi."); return; }
  if (chess.isDraw())      { setStatus("Remi! Partija je završila izjednačeno."); return; }
  if (chess.isCheck())     { setStatus(actor==="Ti" ? "Šah! Stockfish je u šahu." : "Šah! Ti si u šahu."); return; }
  refreshStatus();
}

function refreshStatus() {
  if (chess.isGameOver()) return;
  if (chess.turn()==="w") setStatus("Tvoj potez. Bijeli igraju.");
  else if (engineBusy)    setStatus("Stockfish razmišlja…");
  else if (engineReady)   setStatus("Stockfish je na potezu.");
  else                    setStatus("Stockfish se priprema…");
}

// ═══════════════════════════════════════════════════════════════
//  NEW GAME  — reset all piece positions & visibility
// ═══════════════════════════════════════════════════════════════
newGameBtn.addEventListener("click", () => {
  unlockAudio();

  // Remove cloned promotion pieces
  promotionPieces.forEach(p => scene.remove(p));
  promotionPieces.length = 0;

  // Reset all tracked pieces to starting positions
  pieceAtSquare.forEach((obj, sq) => {
    obj.position.set(0, 0, 0);
    obj.visible = true;
  });
  pieceAtSquare.clear();

  // Re-show ALL template objects (some were hidden as captures)
  for (const color of ["w","b"]) {
    for (const type of ["k","q","b","n","r","p"]) {
      const tmpl = templates[color][type];
      if (tmpl) { tmpl.obj.visible = true; }
    }
    // Also show all non-template pieces (pawns, second rook etc.)
  }

  // Walk ALL mesh children and reset their parent groups
  scene.traverse(obj => {
    if (!obj.isMesh) return;
    const matName = obj.material?.name ?? "";
    const isPiece = matName === "aiStandardSurface1" || matName === "aiStandardSurface2"
                    || obj.material === MAT_W || obj.material === MAT_B;
    if (isPiece) {
      const g = obj.parent ?? obj;
      g.position.set(0, 0, 0);
      g.visible = true;
    }
  });

  // Rebuild pieceAtSquare from fresh chess state
  chess.reset();
  rebuildPieceAtSquare();

  selectedSquare = null; legalTargets = []; lastMoveSquares = [];
  engineBusy = false; pendingEngineMove = false;
  mateBannerEl.classList.add("hidden");
  lastMoveEl.textContent = "Još nema poteza.";

  if (engine) { engineReady = false; engine.postMessage("uci"); engine.postMessage("isready"); }
  setStatus("Nova partija. Ti si bijeli.");
  updateHighlights(); requestRender();
});

function rebuildPieceAtSquare() {
  // Re-map all piece groups to their starting squares based on bounding box
  pieceAtSquare.clear();

  const initialBoard = chess.board();
  function boardPieceAt(sq) {
    const fi = sq.charCodeAt(0) - 97;
    const ri = 8 - parseInt(sq[1]);
    return initialBoard[ri][fi];
  }

  const used = new Set();

  scene.traverse(obj => {
    if (!obj.isMesh) return;
    const isPiece = obj.material === MAT_W || obj.material === MAT_B;
    if (!isPiece) return;

    const color = obj.material === MAT_W ? "w" : "b";
    const moveable = obj.parent ?? obj;
    if (used.has(moveable)) return;

    const bbox = new THREE.Box3().setFromObject(obj);
    const cx = (bbox.min.x + bbox.max.x) / 2;
    const cz = (bbox.min.z + bbox.max.z) / 2;

    let bestSq = null, bestDist = Infinity;
    for (let ri = 0; ri < 8; ri++) {
      for (let fi = 0; fi < 8; fi++) {
        const sq = FILES[fi] + (8-ri);
        const bp = boardPieceAt(sq);
        if (!bp || bp.color !== color) continue;
        if (pieceAtSquare.has(sq)) continue;  // already taken
        const p = glbPos(sq);
        const d = Math.hypot(cx - p.x, cz - p.z);
        if (d < bestDist) { bestDist = d; bestSq = sq; }
      }
    }

    if (bestSq && bestDist < 2.5) {
      pieceAtSquare.set(bestSq, moveable);
      used.add(moveable);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  AUDIO
// ═══════════════════════════════════════════════════════════════
let audioCtx = null, sfxGain = null, audioReady = false;

function unlockAudio() {
  if (audioReady) { if (audioCtx.state === "suspended") audioCtx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx = new AC(); sfxGain = audioCtx.createGain();
  sfxGain.gain.value = 0.72; sfxGain.connect(audioCtx.destination);
  audioReady = true;
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (musicEnabled && songs.length) playCurrentSong();
}

function playMoveSound(isCapture = false) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime, len = isCapture ? 0.20 : 0.14;
  const sz = Math.ceil(audioCtx.sampleRate*(len+0.05));
  const buf = audioCtx.createBuffer(1,sz,audioCtx.sampleRate);
  const d = buf.getChannelData(0); for (let i=0;i<sz;i++) d[i]=Math.random()*2-1;
  const noise = audioCtx.createBufferSource(); noise.buffer=buf;
  const bp = audioCtx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=isCapture?700:480; bp.Q.value=2.5;
  const lp = audioCtx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=2400;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0,now); g.gain.linearRampToValueAtTime(isCapture?1.0:0.85,now+0.004);
  g.gain.exponentialRampToValueAtTime(0.001,now+len);
  const echo=audioCtx.createDelay(); echo.delayTime.value=0.024;
  const eg=audioCtx.createGain(); eg.gain.setValueAtTime(0,now); eg.gain.linearRampToValueAtTime(0.28,now+0.028);
  eg.gain.exponentialRampToValueAtTime(0.001,now+len+0.07);
  noise.connect(bp); bp.connect(lp); lp.connect(g); g.connect(sfxGain);
  bp.connect(echo); echo.connect(eg); eg.connect(sfxGain);
  noise.start(now); noise.stop(now+len+0.1);
}

function playLiftSound() {
  if (!audioCtx) return;
  const now=audioCtx.currentTime, sz=Math.ceil(audioCtx.sampleRate*0.060);
  const buf=audioCtx.createBuffer(1,sz,audioCtx.sampleRate); const d=buf.getChannelData(0);
  for(let i=0;i<sz;i++) d[i]=Math.random()*2-1;
  const noise=audioCtx.createBufferSource(); noise.buffer=buf;
  const bp=audioCtx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=920; bp.Q.value=3.2;
  const g=audioCtx.createGain(); g.gain.setValueAtTime(0,now);
  g.gain.linearRampToValueAtTime(0.38,now+0.003); g.gain.exponentialRampToValueAtTime(0.001,now+0.060);
  noise.connect(bp); bp.connect(g); g.connect(sfxGain); noise.start(now); noise.stop(now+0.07);
}

// ═══════════════════════════════════════════════════════════════
//  MUSIC PLAYER
// ═══════════════════════════════════════════════════════════════
let songs=[],currentIdx=0,musicEnabled=true,musicAudio=null,musicStarted=false;

async function loadSongs() {
  // Try static songs.json first (works on GitHub Pages)
  // Fall back to /api/songs (works with local Node server)
  try {
    const res = await fetch("./assets/music/songs.json");
    if (res.ok) { songs = await res.json(); }
    else { throw new Error("songs.json not found"); }
  } catch {
    try {
      const res2 = await fetch("/api/songs");
      if (res2.ok) songs = await res2.json();
    } catch { songs = []; }
  }
  if (!songs.length) { songNameEl.textContent="Uredi songs.json za muziku"; prevSongBtn.disabled=nextSongBtn.disabled=true; musicStateEl.textContent=""; return; }
  for (let i=songs.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [songs[i],songs[j]]=[songs[j],songs[i]]; }
  currentIdx=0; updateSongDisplay();
  if (audioReady && musicEnabled) playCurrentSong();
}
function updateSongDisplay() {
  if (!songs.length) return;
  songNameEl.textContent=songs[currentIdx].name;
  musicStateEl.textContent=musicEnabled?(musicStarted?"▶ svira":"▶ čeka klik"):"⏸ pauza";
}
function playCurrentSong() {
  if (!songs.length) return;
  if (!musicAudio) { musicAudio=new Audio(); musicAudio.volume=0.50; musicAudio.addEventListener("ended",()=>{ currentIdx=(currentIdx+1)%songs.length; playCurrentSong(); }); }
  musicAudio.src=songs[currentIdx].file; musicAudio.load();
  musicAudio.play().then(()=>{ musicStarted=true; updateSongDisplay(); }).catch(()=>{});
}
function stopCurrentSong() { if (musicAudio) { musicAudio.pause(); musicAudio.currentTime=0; } musicStarted=false; }
prevSongBtn.addEventListener("click",()=>{ unlockAudio(); currentIdx=((currentIdx-1)+songs.length)%songs.length; if(musicEnabled&&songs.length){stopCurrentSong();playCurrentSong();}else updateSongDisplay(); });
nextSongBtn.addEventListener("click",()=>{ unlockAudio(); currentIdx=(currentIdx+1)%songs.length; if(musicEnabled&&songs.length){stopCurrentSong();playCurrentSong();}else updateSongDisplay(); });
toggleMusicBtn.addEventListener("click",()=>{ unlockAudio(); musicEnabled=!musicEnabled; toggleMusicBtn.textContent=musicEnabled?"Muzika: uključena":"Muzika: isključena"; if(musicEnabled&&songs.length)playCurrentSong();else stopCurrentSong(); updateSongDisplay(); });

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
async function init() {
  resizeRenderer();
  setStatus("Učitavanje 3D modela…");
  await loadGLB();
  buildHitSquares();
  updateHighlights();
  refreshStatus();
  loadSongs();
  requestRender();
}

init();
