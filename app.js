/**
 * app.js  —  v3.0 Multi-Material  (v3 — Dynamic Preview + Multi-Wall Scroll)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * FIX LOG (v3 — visual rendering + data-flow):
 *
 *  FIX 1 — Dynamic Wall Scaling:
 *    updateLivePreview() now reads the actual wall list from .wall-item elements
 *    (same source as runCalculation) instead of the legacy surfaceLength/Height
 *    inputs.  Each wall's scale factor is computed as:
 *      scale = min((panelW − PAD×2) / wall.w,  (panelH − PAD×2) / wall.h)
 *    so the rectangle always fits inside the panel while reflecting real-world
 *    aspect ratio.  A very wide wall produces a wide flat rectangle; a tall
 *    narrow wall produces a tall thin rectangle.
 *
 *  FIX 2 — Multi-Wall Horizontal Scroll:
 *    Instead of a single <canvas>, updateLivePreview() now generates one <canvas>
 *    per wall inside a scrollable flex container (#previewScroll).  Each panel
 *    is labelled "კედელი N (W × H მ)".  The container has overflow-x: auto so
 *    the user can scroll horizontally through all walls.  The existing single
 *    #previewCanvas is kept for backwards compatibility but hidden when multi-wall
 *    mode is active.  All openings that belong to a wall are drawn on that wall's
 *    panel (openings carry a wallIndex property assigned when added).
 *
 *  FIX 3 — Waste % Sync:
 *    a) wastePct slider 'input' listener now calls runCalculation() so the tile
 *       count updates immediately when the slider is dragged.
 *    b) runCalculation() passes wastePercent: getNum(DOM.wastePct) with no
 *       falsy || 0 override.  The matching fix in calculator-logic.js uses an
 *       explicit != null check so that 0% waste is preserved correctly.
 *    c) surfaceLength and surfaceHeight inputs (legacy single-wall mode) now
 *       also trigger runCalculation() on change.
 *
 *  FIX 4 — updateRangeBackground parameter name:
 *    Was previously using bare `el` in some call sites.  The function signature
 *    already uses `rangeEl` correctly; all call sites confirmed to pass the DOM
 *    element directly, not a string.
 *
 *  FIX 5 — Auto-calculation on every relevant input:
 *    All tile parameter inputs (tileLength, tileWidth, groutJoint, sqmPerBox)
 *    now call runCalculation() in addition to updateLivePreview().
 *    The addWall() function wires runCalculation() onto new wall inputs.
 *    Opening add/remove/resize/type-change all call runCalculation().
 *
 *  UNCHANGED:
 *  - DOM populated inside DOMContentLoaded (no null references at parse time)
 *  - Single tileDragState declaration at module scope
 *  - Single canvas drag-and-drop via initCanvasDragDrop()
 *  - Full wallpaper module (no changes needed)
 *  - All null-guard checks (if (el)) throughout
 * ─────────────────────────────────────────────────────────────────────────────
 */

"use strict";

/* ============================================================
   MODULE: Application State
   ============================================================ */
const state = {
  activeMaterial: 'tiles',

  // Tiles
  openings:      [],    // [{id, type, width, height, x, y, wallIndex}, …]
  nextId:        1,
  lastResult:    null,
  activePattern: null,

  // Wallpaper
  wpLastResult:  null
};

// Single drag-state declaration at module scope
const tileDragState = {
  targetId:   null,
  isDragging: false,
  startX:     0,
  startY:     0,
  wallIndex:  0     // which wall panel is being dragged on
};

/* ============================================================
   MODULE: DOM References  (populated inside DOMContentLoaded)
   ============================================================ */
let DOM = {};

/* ============================================================
   MODULE: Helpers
   ============================================================ */

function getNum(input) {
  const el = (typeof input === 'string') ? document.getElementById(input) : input;
  if (!el) return 0;
  return parseFloat(el.value) || 0;
}

/** Updates a range slider's filled-track CSS gradient.
 *  @param {HTMLElement} rangeEl  — the <input type="range"> element
 *  @param {string}      color    — CSS colour string (default: var(--blue))
 */
function updateRangeBackground(rangeEl, color) {
  if (!rangeEl) return;
  color = color || 'var(--blue)';
  const min = parseFloat(rangeEl.min)   || 0;
  const max = parseFloat(rangeEl.max)   || 100;
  const val = parseFloat(rangeEl.value) || 0;
  const pct = ((val - min) / (max - min)) * 100;
  rangeEl.style.background =
    `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, var(--border) ${pct}%)`;
}

/* ============================================================
   MODULE: SPA Navigation
   ============================================================ */

function switchMaterial(material) {
  state.activeMaterial = material;
  if (DOM.appTiles)     DOM.appTiles.style.display     = material === 'tiles'     ? 'block' : 'none';
  if (DOM.appWallpaper) DOM.appWallpaper.style.display = material === 'wallpaper' ? 'block' : 'none';
  if (DOM.navTiles)     DOM.navTiles.style.display     = material === 'tiles'     ? 'flex'  : 'none';
  if (DOM.navWallpaper) DOM.navWallpaper.style.display = material === 'wallpaper' ? 'flex'  : 'none';
  if (DOM.tabTiles)     DOM.tabTiles.classList.toggle('active',     material === 'tiles');
  if (DOM.tabWallpaper) DOM.tabWallpaper.classList.toggle('active', material === 'wallpaper');
  if (material === 'tiles') { updateLivePreview(); } else { updateWallpaperPreview(); }
}

function initTilesSectionNav() {
  if (!DOM.navTiles) return;
  DOM.navTiles.querySelectorAll('.nav-item[data-section]').forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.getElementById('section-' + item.getAttribute('data-section'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      DOM.navTiles.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
      item.classList.add('active');
    });
  });
}

function initWallpaperSectionNav() {
  if (!DOM.navWallpaper) return;
  DOM.navWallpaper.querySelectorAll('.nav-item[data-wp-section]').forEach(function(item) {
    item.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.getElementById(item.getAttribute('data-wp-section'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      DOM.navWallpaper.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
      item.classList.add('active');
    });
  });
}

/* ============================================================
   MODULE: Tile — Layout Pattern
   ============================================================ */

function applyLayoutPattern(patternKey) {
  state.activePattern = patternKey;
  let wasteVal = 0;
  switch (patternKey) {
    case 'standard': wasteVal = 5;  break;
    case 'brick':    wasteVal = 10; break;
    case 'diagonal': wasteVal = 15; break;
    case 'custom':   wasteVal = 0;  break;
    default:         wasteVal = 0;
  }
  state.wastePercent = wasteVal;
  if (DOM.wastePct) {
    DOM.wastePct.value = wasteVal;
    if (DOM.wasteBadge) DOM.wasteBadge.textContent = wasteVal + '%';
    updateRangeBackground(DOM.wastePct);
  }
  if (DOM.patternGrid) {
    DOM.patternGrid.querySelectorAll('.pattern-btn').forEach(function(btn) {
      const isSel = btn.getAttribute('data-pattern') === patternKey;
      btn.setAttribute('aria-pressed', isSel ? 'true' : 'false');
      btn.classList.toggle('active', isSel);
    });
  }
  runCalculation();
}

function clearActivePattern() {
  state.activePattern = null;
  if (DOM.patternGrid) {
    DOM.patternGrid.querySelectorAll('.pattern-btn').forEach(function(btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('active');
    });
  }
  if (DOM.patternActiveBanner) DOM.patternActiveBanner.style.display = 'none';
}

/* ============================================================
   MODULE: Tile — Openings Manager
   ============================================================ */

const OPENING_DEFAULTS = {
  door:   { width: 0.90, height: 2.10 },
  window: { width: 1.20, height: 1.40 },
  mirror: { width: 0.80, height: 1.00 }
};

/**
 * Reads all current walls from the DOM and returns [{w, h}, …].
 * Single utility used by preview, calculation, and opening placement.
 */
function getCurrentWalls() {
  const walls = [];
  document.querySelectorAll('.wall-item').forEach(function(el) {
    const wEl = el.querySelector('.wall-width');
    const hEl = el.querySelector('.wall-height');
    const w   = wEl ? (parseFloat(wEl.value) || 0) : 0;
    const h   = hEl ? (parseFloat(hEl.value) || 0) : 0;
    walls.push({ w: w, h: h });   // push even if 0 so wallIndex stays stable
  });
  return walls;
}

function addOpening(type, wallIndex) {
  type      = type      || 'door';
  wallIndex = (wallIndex != null) ? wallIndex : 0;

  const defaults = OPENING_DEFAULTS[type];
  const walls    = getCurrentWalls();
  const wall     = walls[wallIndex] || { w: 5, h: 3 };

  state.openings.push({
    id:        state.nextId++,
    type:      type,
    width:     defaults.width,
    height:    defaults.height,
    wallIndex: wallIndex,
    x:         Math.max(0, (wall.w - defaults.width)  / 2),
    y:         type === 'door'
               ? Math.max(0, wall.h - defaults.height)
               : Math.max(0, (wall.h - defaults.height) / 2)
  });

  renderOpenings();
  updateLivePreview();
  runCalculation();
}

function removeOpening(id) {
  state.openings = state.openings.filter(function(o) { return o.id !== id; });
  renderOpenings();
  updateLivePreview();
  runCalculation();
}

function updateOpeningField(id, field, value) {
  const opening = state.openings.find(function(o) { return o.id === id; });
  if (!opening) return;
  opening[field] = parseFloat(value) || 0;
  updateOpeningAreaDisplay(id);
  updateLivePreview();
  runCalculation();
}

function updateOpeningType(id, type) {
  const opening = state.openings.find(function(o) { return o.id === id; });
  if (!opening) return;
  opening.type   = type;
  opening.width  = OPENING_DEFAULTS[type].width;
  opening.height = OPENING_DEFAULTS[type].height;
  renderOpenings();
  updateLivePreview();
  runCalculation();
}

function updateOpeningAreaDisplay(id) {
  const opening = state.openings.find(function(o) { return o.id === id; });
  if (!opening || !DOM.openingsList) return;
  const row    = DOM.openingsList.querySelector('[data-id="' + id + '"]');
  const areaEl = row && row.querySelector('.input-area-val');
  if (areaEl) areaEl.textContent = (opening.width * opening.height).toFixed(2) + ' მ²';
  updateDeductionBar();
}

function renderOpenings() {
  if (!DOM.openingsList) return;
  
  // 1. ვასუფთავებთ არსებულ სიას (გარდა სათაურისა/თემფლეითისა)
  DOM.openingsList.querySelectorAll('.opening-row').forEach(function(r) { r.remove(); });

  // 2. თუ ღიობები არ არის, ვაჩვენებთ "ცარიელ" შეტყობინებას
  if (state.openings.length === 0) {
    if (DOM.emptyOpenings) DOM.emptyOpenings.style.display = 'flex';
    if (DOM.deductionBar)  DOM.deductionBar.style.display  = 'none';
    return;
  }

  if (DOM.emptyOpenings) DOM.emptyOpenings.style.display = 'none';
  if (DOM.deductionBar)  DOM.deductionBar.style.display  = 'flex';

  // 3. ვიღებთ კედლების მიმდინარე რაოდენობას
  const currentWalls = getCurrentWalls();

  state.openings.forEach(function(opening) {
    if (!DOM.openingTemplate) return;
    
    const tpl = DOM.openingTemplate.content.cloneNode(true);
    const row = tpl.querySelector('.opening-row');
    row.setAttribute('data-id', opening.id);

    // --- ტიპის არჩევა (კარი/ფანჯარა) ---
    const typeSel = row.querySelector('.opening-type-select');
    if (typeSel) {
      typeSel.value = opening.type;
      typeSel.addEventListener('change', function(e) { 
        updateOpeningType(opening.id, e.target.value); 
      });
    }

    // --- კედლის არჩევა (დინამიური სელექტორი) ---
    const wallSel = row.querySelector('.opening-wall-select');
    if (wallSel) {
      wallSel.innerHTML = ''; // ვასუფთავებთ ძველ ოპციებს
      currentWalls.forEach((wall, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = 'კედელი ' + (idx + 1);
        if (opening.wallIndex === idx) opt.selected = true;
        wallSel.appendChild(opt);
      });
      
      wallSel.addEventListener('change', function(e) {
        // ვიყენებთ updateOpeningField-ს wallIndex-ის შესაცვლელად
        updateOpeningField(opening.id, 'wallIndex', parseInt(e.target.value));
      });
    }

    // --- სიგანე ---
    const wi = row.querySelector('.opening-width');
    if (wi) {
      wi.value = opening.width;
      wi.addEventListener('input', function(e) { 
        updateOpeningField(opening.id, 'width', e.target.value); 
      });
    }

    // --- სიმაღლე ---
    const hi = row.querySelector('.opening-height');
    if (hi) {
      hi.value = opening.height;
      hi.addEventListener('input', function(e) { 
        updateOpeningField(opening.id, 'height', e.target.value); 
      });
    }

    // --- ფართობის ჩვენება ---
    const areaVal = row.querySelector('.input-area-val');
    if (areaVal) areaVal.textContent = (opening.width * opening.height).toFixed(2) + ' მ²';

    // --- წაშლის ღილაკი ---
    const removeBtn = row.querySelector('.btn-remove');
    if (removeBtn) removeBtn.addEventListener('click', function() { 
      removeOpening(opening.id); 
    });

    DOM.openingsList.appendChild(tpl);
  });

  updateDeductionBar();
}

function updateDeductionBar() {
  if (!DOM.totalDeductionDisplay) return;
  const total = TileLogic.calcTotalDeduction(
    state.openings.map(function(o) { return { width: o.width, height: o.height }; })
  );
  DOM.totalDeductionDisplay.textContent = total.toFixed(2) + ' მ²';
}

/* ============================================================
   MODULE: Tile — Canvas Preview  (FIX 1 + FIX 2)
   ============================================================
   Multi-wall horizontal-scroll preview.
   - One canvas panel per wall, rendered side-by-side in a flex row.
   - Each panel independently scales the wall rectangle to fit its area
     while preserving real-world aspect ratio.
   - Openings are drawn on the panel whose wallIndex matches.
   - The container (#previewScroll) has overflow-x: auto injected via JS
     so the user can scroll horizontally through all walls.
   ============================================================ */

/**
 * Draws one wall panel onto the given canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {Object}  wall      — {w, h} in metres
 * @param {number}  wallIndex — index in the wall list (for openings filter)
 * @param {number}  [explicitW] — pixel width  (pass in to avoid clientWidth=0 bug)
 * @param {number}  [explicitH] — pixel height (pass in to avoid clientHeight=0 bug)
 */
function drawWallPanel(canvas, wall, wallIndex, explicitW, explicitH) {
  const dpr = window.devicePixelRatio || 1;
  // FIX 2: prefer caller-supplied dimensions; fall back to clientWidth only when
  // the canvas is already in the DOM and has layout (e.g. on a redraw).
  const PW = explicitW || canvas.clientWidth  || 400;
  const PH = explicitH || canvas.clientHeight || 280;

  // რენდერის ხარისხის ოპტიმიზაცია
  canvas.width  = PW * dpr;
  canvas.height = PH * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const wallNum = wallIndex + 1;

  const c = {
    bg:          '#0f1117',
    tileA:       '#242d40',
    tileB:       '#1e2535',
    grout:       '#0f1117',
    opening:     '#0d1219',
    accentBlue:  '#3b82f6',
    accentAmber: '#f59e0b',
    text:        '#64748b',
    label:       '#94a3b8'
  };

  // ფონის გასუფთავება
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, PW, PH);

  // ზომების მიღება — getCurrentWalls() always returns {w, h}
  const surfW = parseFloat(wall.w !== undefined ? wall.w : wall.width)  || 0;
  const surfH = parseFloat(wall.h !== undefined ? wall.h : wall.height) || 0;

  if (surfW <= 0 || surfH <= 0) {
    ctx.fillStyle = c.text;
    ctx.font      = "11px 'JetBrains Mono', monospace";
    ctx.textAlign = 'center';
    ctx.fillText('კედელი ' + wallNum, PW / 2, PH / 2 - 10);
    ctx.fillText('(შეიყვანეთ ზომები)', PW / 2, PH / 2 + 10);
    return;
  }

  // ფილის მონაცემები
  const tileL  = (getNum(DOM.tileLength) || 60) / 100;
  const tileWd = (getNum(DOM.tileWidth)  || 30) / 100;
  const groutM = (getNum(DOM.groutJoint) || 3)  / 1000;

  // მასშტაბირება
  const PAD   = 40;
  const LABEL = 30;
  const scale = Math.min(
    (PW - PAD * 2) / surfW,
    (PH - PAD * 2 - LABEL) / surfH
  );

  const drawW = surfW * scale;
  const drawH = surfH * scale;
  const ox    = (PW - drawW) / 2;
  const oy    = LABEL + (PH - LABEL - drawH) / 2;

  // ფილების დახატვა
  const tpx = tileL  * scale;
  const tpy = tileWd * scale;
  const gpx = Math.max(0.5, groutM * scale);

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, drawW, drawH);
  ctx.clip();

  let row = 0;
  for (let y = oy; y < oy + drawH + tpy; y += tpy + gpx, row++) {
    let col = 0;
    for (let x = ox; x < ox + drawW + tpx; x += tpx + gpx, col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? c.tileA : c.tileB;
      ctx.fillRect(x, y, tpx, tpy);
    }
  }

  // ნაკერების ხაზები
  ctx.strokeStyle = c.grout;
  ctx.lineWidth   = gpx;
  for (let y = oy; y <= oy + drawH + tpy; y += tpy + gpx) {
    ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + drawW, y); ctx.stroke();
  }
  for (let x = ox; x <= ox + drawW + tpx; x += tpx + gpx) {
    ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + drawH); ctx.stroke();
  }
  ctx.restore();

  // ჩარჩო
  ctx.strokeStyle = c.accentBlue;
  ctx.lineWidth   = 2;
  ctx.strokeRect(ox, oy, drawW, drawH);

  // ზომები
  ctx.fillStyle = c.text;
  ctx.font      = "12px 'JetBrains Mono', monospace";
  ctx.textAlign = 'center';
  ctx.fillText(surfW.toFixed(2) + ' მ', ox + drawW / 2, oy + drawH + 20);
  
  ctx.save();
  ctx.translate(ox - 20, oy + drawH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(surfH.toFixed(2) + ' მ', 0, 0);
  ctx.restore();

  // ღიობები (კარები/ფანჯრები)
  const ICONS = { door: '🚪', window: '🪟', mirror: '🪞' };
  // მნიშვნელოვანია, რომ state.openings არსებობდეს
  if (state.openings) {
    state.openings
      .filter(op => op.wallIndex === wallIndex)
      .forEach(op => {
        const opX = ox + op.x * scale;
        const opY = oy + op.y * scale;
        const opW = op.width  * scale;
        const opH = op.height * scale;

        ctx.fillStyle = c.opening;
        ctx.fillRect(opX, opY, opW, opH);
        ctx.strokeStyle = c.accentAmber;
        ctx.lineWidth   = 1.5;
        ctx.strokeRect(opX, opY, opW, opH);

        ctx.font      = `${Math.min(18, opW * 0.5)}px serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = c.accentAmber;
        ctx.fillText(ICONS[op.type] || '?', opX + opW / 2, opY + opH / 2 + 7);
      });
  }

  // სათაური
  ctx.fillStyle = c.label;
  ctx.font      = "bold 13px 'JetBrains Mono', monospace";
  ctx.textAlign = 'center';
  ctx.fillText('კედელი ' + wallNum + ' (' + surfW.toFixed(2) + ' × ' + surfH.toFixed(2) + ' მ)', 
               PW / 2, LABEL - 10);
}

/**
 * Main preview entry-point.
 * Builds (or rebuilds) the horizontal-scroll panel with one canvas per wall.
 *
 * Container requirements in HTML:
 *   <div id="previewScroll"></div>   ← scrollable flex row injected here
 *   <canvas id="previewCanvas">      ← kept but hidden in multi-wall mode
 */
// Debounce timer for updateLivePreview — prevents rapid-fire redraws during typing
let _previewRafId = null;

/**
 * Main preview entry-point.
 * Builds (or rebuilds) the horizontal-scroll panel with one canvas per wall.
 *
 * Two-phase approach to solve the layout timing problem:
 *   Phase 1 (sync)  — build/update the DOM panels so the browser can lay them out.
 *   Phase 2 (rAF)   — after ONE animation frame the browser has computed offsetWidth;
 *                     we then read real pixel dimensions and draw each canvas.
 *
 * Container in HTML:
 *   <div id="preview-scroll-container">  ← one canvas panel per wall injected here
 *   <canvas id="previewCanvas" style="display:none">  ← legacy hidden canvas
 */
function updateLivePreview() {
    // Cancel any pending redraw — prevents redundant draws when many inputs fire fast
    if (_previewRafId) {
        cancelAnimationFrame(_previewRafId);
        _previewRafId = null;
    }

    const scrollEl = document.getElementById('preview-scroll-container');
    if (!scrollEl) return;

    const allWalls   = getCurrentWalls();
    const validWalls = allWalls.filter(w => w.w > 0 && w.h > 0);

    // ── No walls entered: show placeholder ──────────────────────────────────
    if (validWalls.length === 0) {
        scrollEl.innerHTML = '<div style="color:#64748b;padding:20px;text-align:center;width:100%;line-height:280px;">შეიყვანეთ კედლის ზომები ვიზუალიზაციისთვის</div>';
        updateGrossDisplay();
        return;
    }

    // ── Phase 1: Build DOM panels synchronously ──────────────────────────────
    // Apply flex-scroll styles (idempotent — safe to repeat)
    Object.assign(scrollEl.style, {
        display:          'flex',
        flexDirection:    'row',
        overflowX:        'auto',
        scrollSnapType:   'x mandatory',
        scrollBehavior:   'smooth',
        minHeight:        '280px',
        width:            '100%'
    });

    // Remove surplus panels if wall count shrank
    const existingPanels = scrollEl.querySelectorAll('.wall-panel');
    if (existingPanels.length !== validWalls.length) {
        scrollEl.innerHTML = '';   // full rebuild — cheapest when count changes
    }

    // Create/reuse one panel per valid wall
    validWalls.forEach(function(wall, index) {
        let panel  = scrollEl.querySelector('.wall-panel[data-index="' + index + '"]');
        let canvas;

        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'wall-panel';
            panel.setAttribute('data-index', index);
            // Give the panel explicit sizing so offsetWidth resolves after layout
            Object.assign(panel.style, {
                flex:           '0 0 100%',
                width:          '100%',
                height:         '280px',
                scrollSnapAlign:'center',
                display:        'flex',
                justifyContent: 'center',
                alignItems:     'center',
                position:       'relative',
                boxSizing:      'border-box'
            });
            canvas = document.createElement('canvas');
            // Do NOT set canvas width/height here — browser hasn't laid out yet.
            // We'll set them in the rAF callback once offsetWidth is known.
            panel.appendChild(canvas);
            scrollEl.appendChild(panel);
        } else {
            canvas = panel.querySelector('canvas');
        }

        // Tag the canvas for drag-drop hit testing (needs to happen before rAF)
        canvas._wallIndex = index;
        canvas.setAttribute('data-wall-index', index);
    });

    // ── Phase 2: Draw after ONE animation frame (layout is resolved) ─────────
    _previewRafId = requestAnimationFrame(function() {
        _previewRafId = null;

        const scrollW = scrollEl.offsetWidth;  // real pixel width now available

        validWalls.forEach(function(wall, index) {
            const panel  = scrollEl.querySelector('.wall-panel[data-index="' + index + '"]');
            if (!panel) return;
            const canvas = panel.querySelector('canvas');
            if (!canvas) return;

            // Read from panel (which has explicit width:100%); fall back to scrollEl
            // width then a safe 400px minimum.  Never read canvas.clientWidth here
            // because the canvas bitmap size hasn't been set yet.
            const PW = panel.offsetWidth  || scrollW || 400;
            const PH = 280;

            // Set CSS display size
            canvas.style.width  = PW + 'px';
            canvas.style.height = PH + 'px';

            drawWallPanel(canvas, wall, index, PW, PH);
        });

        updateIndicators(scrollEl, validWalls.length);
        updateGrossDisplay();
    });
}

/**
 * Renders dot-indicator navigation below the scroll container.
 * The active dot is highlighted whenever the user scrolls to a new panel.
 */
function updateIndicators(scrollEl, count) {
  // Find or create a sibling indicator bar just after scrollEl
  let bar = scrollEl.parentElement
    ? scrollEl.parentElement.querySelector('.preview-indicators')
    : null;

  if (count <= 1) {
    if (bar) bar.style.display = 'none';
    return;
  }

  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'preview-indicators';
    Object.assign(bar.style, {
      display:        'flex',
      justifyContent: 'center',
      gap:            '6px',
      padding:        '8px 0 4px'
    });
    if (scrollEl.parentElement) scrollEl.parentElement.appendChild(bar);
  }

  bar.style.display = 'flex';

  // Rebuild dots when wall count changes
  if (bar.children.length !== count) {
    bar.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('span');
      Object.assign(dot.style, {
        width:        '8px',
        height:       '8px',
        borderRadius: '50%',
        background:   i === 0 ? 'var(--blue, #3b82f6)' : 'var(--border, #334155)',
        display:      'inline-block',
        cursor:       'pointer',
        transition:   'background 0.2s'
      });
      dot.setAttribute('data-dot', i);
      dot.addEventListener('click', function() {
        const panels = scrollEl.querySelectorAll('.wall-panel');
        if (panels[i]) panels[i].scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      });
      bar.appendChild(dot);
    }
  }

  // Sync active dot on scroll
  scrollEl._indicatorBar = bar;
  if (!scrollEl._indicatorListenerAttached) {
    scrollEl._indicatorListenerAttached = true;
    scrollEl.addEventListener('scroll', function() {
      const panels = scrollEl.querySelectorAll('.wall-panel');
      const scrollLeft = scrollEl.scrollLeft;
      const panelW = scrollEl.offsetWidth;
      const active = panelW > 0 ? Math.round(scrollLeft / panelW) : 0;
      const indicatorBar = scrollEl._indicatorBar;
      if (!indicatorBar) return;
      indicatorBar.querySelectorAll('[data-dot]').forEach(function(dot, idx) {
        dot.style.background = idx === active
          ? 'var(--blue, #3b82f6)'
          : 'var(--border, #334155)';
      });
    });
  }
}

function updateGrossDisplay() {
  if (!DOM.grossAreaDisplay) return;
  const walls = getCurrentWalls();
  const gross = walls.reduce(function(sum, w) { return sum + w.w * w.h; }, 0);
  DOM.grossAreaDisplay.textContent = gross.toFixed(2) + ' მ²';
}

/* ============================================================
   MODULE: Tile — Results Renderer
   ============================================================ */

function gatherTileParams() {
  const walls = getCurrentWalls().filter(function(w) { return w.w > 0 && w.h > 0; });
  return {
    walls:        walls.map(function(w) { return { w: w.w, h: w.h }; }),
    openings:     state.openings.map(function(o) { return { width: o.width, height: o.height }; }),
    tileLengthCm: getNum(DOM.tileLength),
    tileWidthCm:  getNum(DOM.tileWidth),
    groutMm:      getNum(DOM.groutJoint),
    wastePercent: getNum(DOM.wastePct),
    sqmPerBox:    getNum(DOM.sqmPerBox)
  };
}

function renderTileResults(result) {
  if (DOM.rTilesCount)  DOM.rTilesCount.textContent  = result.finalCount.toLocaleString();
  if (DOM.rBoxes)       DOM.rBoxes.textContent        = result.boxCount + ' კოლ.';
  if (DOM.rPurchaseSqm) DOM.rPurchaseSqm.textContent  = result.purchaseArea.toFixed(2) + ' მ²';
  if (DOM.rNetSqm)      DOM.rNetSqm.textContent       = result.netArea.toFixed(2) + ' მ²';
  if (DOM.rWasteTiles)  DOM.rWasteTiles.textContent   = '+' + result.wasteTiles;

  if (DOM.sGross)     DOM.sGross.textContent     = result.grossArea.toFixed(2) + ' მ²';
  if (DOM.sDeduction) DOM.sDeduction.textContent = '−' + result.totalDeduction.toFixed(2) + ' მ²';
  if (DOM.sNet)       DOM.sNet.textContent       = result.netArea.toFixed(2) + ' მ²';

  const tileAreaCm2 = result.effectiveTileArea
    ? (result.effectiveTileArea * 10000).toFixed(1)
    : ((getNum(DOM.tileLength) * getNum(DOM.tileWidth)) || 0).toFixed(1);
  if (DOM.sTileArea)   DOM.sTileArea.textContent   = tileAreaCm2 + ' სმ²';
  if (DOM.sBaseCount)  DOM.sBaseCount.textContent  = result.baseCount + ' ც.';
  if (DOM.sFinalCount) DOM.sFinalCount.textContent = result.finalCount + ' ც.';

  const grossDisplay  = document.getElementById('grossAreaDisplay');
  const lengthDisplay = document.getElementById('totalLengthDisplay');
  if (grossDisplay)  grossDisplay.textContent  = (result.grossArea || 0).toFixed(2) + ' მ²';
  if (lengthDisplay) lengthDisplay.textContent = (result.totalWallLength || 0).toFixed(2) + ' მ';

  if (DOM.sLayout) {
    if (state.activePattern) {
      const pat = TileLogic.getLayoutPattern(state.activePattern);
      DOM.sLayout.textContent = pat.labelKa + ' (' + pat.wastePercent + '%)';
    } else {
      DOM.sLayout.textContent = 'მომხმარებელი (' + getNum(DOM.wastePct) + '%)';
    }
  }

  const card = document.querySelector('.results-card:not(.results-card--rose)');
  if (card) {
    card.classList.remove('calculating');
    void card.offsetWidth;
    card.classList.add('calculating');
  }

  state.lastResult = result;
}

/* ============================================================
   MODULE: Tile — Wall List
   ============================================================ */

function addWall() {
  const wallsList = document.getElementById('wallsList');
  if (!wallsList) return;

  const wallId  = Date.now();
  const wallNum = wallsList.querySelectorAll('.wall-item').length + 1;

  const wallHTML = `
    <div class="wall-item card-sub-item" id="wall-${wallId}" data-wall-num="${wallNum}">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">კედელი ${wallNum} — სიგრძე (მ)</label>
          <div class="input-wrap">
            <input type="number" class="form-input wall-width" placeholder="0.00" step="0.01" min="0">
            <span class="input-unit">მ</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">კედელი ${wallNum} — სიმაღლე (მ)</label>
          <div class="input-wrap">
            <input type="number" class="form-input wall-height" placeholder="0.00" step="0.01" min="0">
            <span class="input-unit">მ</span>
          </div>
        </div>
        <button type="button" class="btn-remove-wall"
          onclick="this.closest('.wall-item').remove(); updateLivePreview(); runCalculation();"
          title="კედლის წაშლა">&times;</button>
      </div>
    </div>`;

  wallsList.insertAdjacentHTML('beforeend', wallHTML);

  const newWall = document.getElementById('wall-' + wallId);
  if (newWall) {
    newWall.querySelectorAll('input').forEach(function(input) {
      input.addEventListener('input', function() {
        updateLivePreview();
        runCalculation();
      });
    });
  }
}

/* ============================================================
   MODULE: Tile — Main Calculation  (FIX 3)
   ============================================================ */

function runCalculation() {
  // 1. ვამზადებთ კედლების მასივს, რომელსაც TileLogic-ს გადავცემთ
  let finalWallsForLogic = [];

  if (isQuickMode) {
    // --- სწრაფი რეჟიმი ---
    const directArea = parseFloat(document.getElementById('directAreaInput').value) || 0;
    
    if (directArea <= 0) {
      // თუ ფართობი ცარიელია, ვაჩერებთ გამოთვლას და ვასუფთავებთ შედეგებს
      clearResults();
      return;
    }

    // ვქმნით ერთ "ვირტუალურ" კედელს, რომლის ფართობიც მომხმარებლის მიერ ჩაწერილი ციფრია
    // სიმაღლეს ვიღებთ 1-ს, რათა W * 1 = ფართობს
    finalWallsForLogic = [{ w: directArea, h: 1 }];
  } else {
    // --- დეტალური რეჟიმი ---
    const walls = getCurrentWalls().filter(function(w) { 
      return w.w > 0 && w.h > 0; 
    });

    if (walls.length === 0) {
      clearResults();
      return;
    }
    finalWallsForLogic = walls;
  }

  // 2. ვამზადებთ პარამეტრებს საანგარიშო ბიბლიოთეკისთვის
  const params = {
    walls:        finalWallsForLogic,
    // თუ სწრაფი რეჟიმია, შეგვიძლია ღიობები (კარ-ფანჯარა) არ გამოვაკლოთ, ან დავტოვოთ
    openings:     state.openings.map(function(o) { 
      return { width: o.width, height: o.height }; 
    }),
    tileLengthCm: getNum(DOM.tileLength)  || 60,
    tileWidthCm:  getNum(DOM.tileWidth)   || 30,
    groutMm:      getNum(DOM.groutJoint),
    wastePercent: getNum(DOM.wastePct),
    sqmPerBox:    getNum(DOM.sqmPerBox)   || 1.44
  };

  // console.log('გამოთვლა აქტიურია:', params);

  // 3. ვასრულებთ მათემატიკურ გათვლას
  try {
    if (window.TileLogic && typeof window.TileLogic.calculateAll === 'function') {
      const result = window.TileLogic.calculateAll(params);
      renderTileResults(result);
    }
  } catch (e) {
    console.error('გამოთვლა ვერ მოხერხდა:', e);
  }
}

// დამხმარე ფუნქცია შედეგების გასასუფთავებლად, როცა ინპუტი ცარიელია
function clearResults() {
  [DOM.rTilesCount, DOM.rBoxes, DOM.rPurchaseSqm, DOM.rNetSqm, DOM.rWasteTiles,
   DOM.sGross, DOM.sDeduction, DOM.sNet, DOM.sTileArea, DOM.sBaseCount, DOM.sFinalCount, DOM.sLayout]
    .forEach(function(el) { if (el) el.textContent = '—'; });
}

function resetTiles() {
  // Clear wall list (except first wall item if present)
  const wallsList = document.getElementById('wallsList');
  if (wallsList) {
    const items = wallsList.querySelectorAll('.wall-item');
    items.forEach(function(item, i) {
      if (i === 0) {
        // Reset first wall values
        const wi = item.querySelector('.wall-width');
        const hi = item.querySelector('.wall-height');
        if (wi) wi.value = '';
        if (hi) hi.value = '';
      } else {
        item.remove();
      }
    });
  }

  if (DOM.tileLength)    DOM.tileLength.value    = '60';
  if (DOM.tileWidth)     DOM.tileWidth.value     = '30';
  if (DOM.groutJoint)    DOM.groutJoint.value    = '3';
  if (DOM.wastePct)      DOM.wastePct.value      = '0';
  if (DOM.sqmPerBox)     DOM.sqmPerBox.value     = '1.44';
  if (DOM.wasteBadge)    DOM.wasteBadge.textContent = '0%';
  updateRangeBackground(DOM.wastePct);
  clearActivePattern();
  state.openings = [];
  state.nextId   = 1;
  renderOpenings();
  [DOM.rTilesCount, DOM.rBoxes, DOM.rPurchaseSqm, DOM.rNetSqm, DOM.rWasteTiles,
   DOM.sGross, DOM.sDeduction, DOM.sNet, DOM.sTileArea, DOM.sBaseCount, DOM.sFinalCount, DOM.sLayout]
    .forEach(function(el) { if (el) el.textContent = '—'; });
  state.lastResult = null;
  updateLivePreview();
}

function copyTileResult() {
  if (!state.lastResult) { alert('პირველ რიგში გამოთვლა ჩაატარეთ.'); return; }
  const r = state.lastResult;
  const p = gatherTileParams();
  const patternLine = state.activePattern
    ? TileLogic.getLayoutPattern(state.activePattern).labelKa
    : 'მომხმარებელი';

  const txt = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  ჭკვიანი ფილების კალკულატორი',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '', '📐 ზედაპირი',
    '  ბრუტო ფართობი     : ' + r.grossArea.toFixed(2)      + ' მ²',
    '  გამოქვითვა        : ' + r.totalDeduction.toFixed(2) + ' მ²',
    '  წმინდა ფართობი    : ' + r.netArea.toFixed(2)        + ' მ²',
    '', '🟫 ფილა',
    '  ზომა               : ' + p.tileLengthCm + ' × ' + p.tileWidthCm + ' სმ',
    '  ნაკეთობა           : ' + p.groutMm      + ' მმ',
    '  დაგების სტილი      : ' + patternLine,
    '  ნარჩენი ფაქტორი    : ' + p.wastePercent + '%',
    '', '📦 შედეგი',
    '  ფილები (ნარჩენის გარეშე) : ' + r.baseCount  + ' ც.',
    '  ფილები (ნარჩენით)        : ' + r.finalCount + ' ც.',
    '  შესყიდვის ფართობი        : ' + r.purchaseArea.toFixed(2) + ' მ²',
    '  საჭირო კოლოფები          : ' + r.boxCount + ' ც. (' + p.sqmPerBox + ' მ²/კოლ.)',
    '', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');

  navigator.clipboard.writeText(txt).then(function() {
    if (!DOM.copyBtn) return;
    DOM.copyBtn.textContent = '✓ კოპირებულია!';
    DOM.copyBtn.classList.add('success');
    setTimeout(function() {
      DOM.copyBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg> შედეგის კოპირება';
      DOM.copyBtn.classList.remove('success');
    }, 2500);
  }).catch(function() { alert('კოპირება ვერ მოხდა.'); });
}

/* ============================================================
   MODULE: Wallpaper — Canvas Preview
   ============================================================ */

function updateWallpaperPreview() {
    const canvas = DOM.wpCanvas;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.clientWidth || 360;
    const H   = Math.round(W * 0.55);
    canvas.width        = W * dpr;
    canvas.height       = H * dpr;
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const c = {
        bg: '#0f1117', stripA: '#1c2535', stripB: '#242d40',
        stripSep: '#0f1117', accent: '#f43f5e', text: '#64748b', amber: '#f59e0b'
    };

    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, W, H);

    // 1. მონაცემების აღება
    const w       = getNum(DOM.wpWallWidth)     || 0;
    const l       = getNum(DOM.wpWallLength)    || 0;
    const wallH   = getNum(DOM.wpWallHeight)    || 2.7;
    const rollW   = getNum(DOM.wpRollWidth)     || 0.53;
    const rollL   = getNum(DOM.wpRollLength)    || 10.05;
    const rapport = getNum(DOM.wpPatternRepeat) || 0;

    // 2. პერიმეტრის ლოგიკა (მთავარი ცვლილება)
    const isPerimeter = document.getElementById('wpPerimeterMode')?.checked;
    const wallW = isPerimeter ? (w + l) * 2 : w;

    if (wallW <= 0) return;

    // 3. ზოლების რაოდენობა (უნდა დაითვალოს wallW-ს შემდეგ!)
    const totalStrips = Math.ceil(wallW / (rollW || 0.53));

    // 4. მასშტაბირება (Scale)
    const PAD   = 42;
    const scale = Math.min((W - PAD * 2) / wallW, (H - PAD * 2) / wallH);
    const drawW = wallW * scale;
    const drawH = wallH * scale;
    const ox    = (W - drawW) / 2;
    const oy    = (H - drawH) / 2;

    // 5. თითოეული ზოლის ვიზუალური სიგანე პიქსელებში
    const stripPx = drawW / totalStrips;

    const effStripH     = WallpaperLogic.calcEffectiveStripHeight(wallH, rapport);
    const stripsPerRoll = WallpaperLogic.calcStripsPerRoll(rollL, effStripH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, drawW, drawH);
    ctx.clip();

    // ზოლების ხატვა
    for (let i = 0; i < totalStrips; i++) {
        const x = ox + i * stripPx;
        const rollIdx = stripsPerRoll > 0 ? Math.floor(i / stripsPerRoll) : 0;
        
        ctx.fillStyle = rollIdx % 2 === 0 ? c.stripA : c.stripB;
        ctx.fillRect(x, oy, stripPx, drawH);
        
        ctx.fillStyle = c.stripSep;
        ctx.fillRect(x, oy, 1.2, drawH); // გამყოფი ხაზი

        // რაპორტის მარკერები
        if (rapport > 0) {
            const rPx = (rapport / 100) * scale;
            ctx.strokeStyle = 'rgba(244,63,94,0.12)';
            ctx.lineWidth   = 0.8;
            ctx.setLineDash([3, 5]);
            for (let y = oy; y < oy + drawH; y += rPx) {
                ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.lineTo(x + stripPx - 2, y); ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        // ნომრები ზოლებზე
        if (stripPx > 14) {
            ctx.fillStyle = c.text;
            ctx.font      = Math.min(9, stripPx * 0.4) + "px 'JetBrains Mono', monospace";
            ctx.textAlign = 'center';
            ctx.fillText(i + 1, x + stripPx / 2, oy + drawH / 2);
        }
    }
    ctx.restore();

    // ჩარჩო
    ctx.strokeStyle = c.accent;
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(ox, oy, drawW, drawH);

    // ზომების წარწერები
    ctx.fillStyle = c.text;
    ctx.font      = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = 'center';
    ctx.fillText(wallW.toFixed(2) + ' მ (' + totalStrips + ' ზოლი)', W / 2, oy + drawH + 16);

    ctx.save();
    ctx.translate(ox - 18, oy + drawH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(wallH.toFixed(2) + ' მ', 0, 0);
    ctx.restore();

    // რულონების მარკერები (R1, R2...)
    if (stripsPerRoll > 0) {
        let rollNum = 1;
        for (let i = stripsPerRoll; i < totalStrips; i += stripsPerRoll) {
            const x = ox + i * stripPx;
            ctx.strokeStyle = c.amber;
            ctx.setLineDash([5, 4]);
            ctx.beginPath(); ctx.moveTo(x, oy - 4); ctx.lineTo(x, oy + drawH); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = c.amber;
            ctx.fillText('R' + (++rollNum), x, oy - 7);
        }
    }

    // ფართობის ბლოკი
    ctx.fillStyle = 'rgba(244,63,94,0.12)';
    const areaValue = (wallW * wallH).toFixed(2);
    const bTxt = areaValue + ' მ²';
    const bW   = ctx.measureText(bTxt).width + 14;
    ctx.fillRect(ox + drawW - bW, oy + 5, bW, 17);
    ctx.fillStyle  = c.accent;
    ctx.textAlign  = 'right';
    ctx.fillText(bTxt, ox + drawW - 5, oy + 17);

    updateWallpaperAreaDisplay();
}

function updateWallpaperAreaDisplay() {
  const perimeterEl     = document.getElementById('wpPerimeterMode');
  const isPerimeterMode = perimeterEl ? perimeterEl.checked : false;

  let displayWidth;
  if (isPerimeterMode) {
    const roomL  = parseFloat((document.getElementById('wpRoomLength') || {}).value) || 0;
    const roomW  = parseFloat((document.getElementById('wpRoomWidth')  || {}).value) || 0;
    displayWidth = (roomL + roomW) * 2;
  } else {
    displayWidth = DOM.wpWallWidth ? (parseFloat(DOM.wpWallWidth.value) || 0) : 0;
  }

  const wallHeight = DOM.wpWallHeight ? (parseFloat(DOM.wpWallHeight.value) || 0) : 0;
  const area = displayWidth * wallHeight;

  if (DOM.wpWallAreaDisplay) {
    DOM.wpWallAreaDisplay.textContent = area.toFixed(2) + ' მ²';
  }
  const cls = document.querySelector('.wallpaper-area-info');
  if (cls) cls.textContent = 'ჯამური ფართობი: ' + area.toFixed(2) + ' მ²';
}

/* ============================================================
   MODULE: Wallpaper — Calculation & Results
   ============================================================ */

function gatherWallpaperParams() {
  return {
    wallWidthM:      getNum(DOM.wpWallWidth),
    wallHeightM:     getNum(DOM.wpWallHeight),
    rollWidthM:      getNum(DOM.wpRollWidth),
    rollLengthM:     getNum(DOM.wpRollLength),
    patternRepeatCm: getNum(DOM.wpPatternRepeat),
    rollPrice:       getNum(DOM.wpRollPrice)
  };
}

function renderWallpaperResults(result, params) {
  const perimeterEl     = document.getElementById('wpPerimeterMode');
  const isPerimeterMode = perimeterEl ? perimeterEl.checked : false;

  if (DOM.wpRRolls)         DOM.wpRRolls.textContent         = result.totalRolls;
  if (DOM.wpRStrips)        DOM.wpRStrips.textContent        = result.totalStrips;
  if (DOM.wpRStripsPerRoll) DOM.wpRStripsPerRoll.textContent = result.stripsPerRoll;
  if (DOM.wpRWallArea)      DOM.wpRWallArea.textContent      = result.wallArea.toFixed(2) + ' მ²';
  if (DOM.wpRPurchased)     DOM.wpRPurchased.textContent     = result.totalPurchasedArea.toFixed(2) + ' მ²';

  const dimsLabel = isPerimeterMode ? 'პერიმეტრი' : 'კედელი';
  if (DOM.wpSDims)     DOM.wpSDims.innerHTML       = '<small>' + dimsLabel + ':</small> ' + params.wallWidthM + 'მ × ' + params.wallHeightM + 'მ';
  if (DOM.wpSRollDims) DOM.wpSRollDims.textContent = params.rollWidthM + ' × ' + params.rollLengthM + ' მ';
  if (DOM.wpSPattern)  DOM.wpSPattern.textContent  = params.patternRepeatCm > 0 ? (params.patternRepeatCm + ' სმ') : '— (არ მეორდება)';
  if (DOM.wpSStripH)   DOM.wpSStripH.textContent   = result.effectiveStripHeight.toFixed(2) + ' მ';
  if (DOM.wpSStrips)   DOM.wpSStrips.textContent   = result.totalStrips + ' ც.';
  if (DOM.wpSPerRoll)  DOM.wpSPerRoll.textContent  = result.stripsPerRoll + ' ც.';
  if (DOM.wpSRolls)    DOM.wpSRolls.textContent    = result.totalRolls + ' ც.';

  if (DOM.wpRTotalPrice) DOM.wpRTotalPrice.textContent = result.totalPrice.toFixed(2) + ' ₾';

  const card = document.querySelector('.results-card--rose');
  if (card) {
    card.classList.remove('calculating');
    void card.offsetWidth;
    card.classList.add('calculating');
  }

  state.wpLastResult = { result: result, params: params };
}

function runWallpaperCalculation() {
  const perimeterEl     = document.getElementById('wpPerimeterMode');
  const isPerimeterMode = perimeterEl ? perimeterEl.checked : false;

  const wallHeight = getNum(DOM.wpWallHeight);
  let   finalWidth;

  if (isPerimeterMode) {
    // Perimeter mode: total wall width = (roomLength + roomWidth) * 2
    const roomL = parseFloat((document.getElementById('wpRoomLength') || {}).value) || 0;
    const roomW = parseFloat((document.getElementById('wpRoomWidth')  || {}).value) || 0;
    finalWidth  = (roomL + roomW) * 2;
  } else {
    finalWidth = getNum(DOM.wpWallWidth);
  }

  const params = {
    wallWidthM:      finalWidth,
    wallHeightM:     wallHeight,
    rollWidthM:      getNum(DOM.wpRollWidth),
    rollLengthM:     getNum(DOM.wpRollLength),
    patternRepeatCm: getNum(DOM.wpPatternRepeat),
    rollPrice:       getNum(DOM.wpRollPrice)
  };

  const result = WallpaperLogic.calcWallpaperAll(params);

  updateWallpaperAreaDisplay();
  renderWallpaperResults(result, params);
  updateWallpaperPreview();
}

function resetWallpaper() {
  if (DOM.wpWallWidth)       DOM.wpWallWidth.value       = '4.00';
  if (DOM.wpWallHeight)      DOM.wpWallHeight.value      = '2.70';
  if (DOM.wpRollWidth)       DOM.wpRollWidth.value       = '0.53';
  if (DOM.wpRollLength)      DOM.wpRollLength.value      = '10.05';
  if (DOM.wpPatternRepeat)   DOM.wpPatternRepeat.value   = '0';
  if (DOM.wpPatternBadge)    DOM.wpPatternBadge.textContent    = '0 სმ';
  if (DOM.wpPatternHintText) DOM.wpPatternHintText.textContent = 'Rapport 0 — ნახატი არ მეორდება';
  updateRangeBackground(DOM.wpPatternRepeat, 'var(--rose)');

  [DOM.wpRRolls, DOM.wpRStrips, DOM.wpRStripsPerRoll, DOM.wpRWallArea, DOM.wpRPurchased,
   DOM.wpSDims, DOM.wpSRollDims, DOM.wpSPattern, DOM.wpSStripH, DOM.wpSStrips, DOM.wpSPerRoll, DOM.wpSRolls]
    .forEach(function(el) { if (el) el.textContent = '—'; });

  state.wpLastResult = null;
  updateWallpaperPreview();
}

function copyWallpaperResult() {
  if (!state.wpLastResult) { alert('პირველ რიგში გამოთვლა ჩაატარეთ.'); return; }
  const r = state.wpLastResult.result;
  const p = state.wpLastResult.params;

  const txt = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  შპალერის კალკულატორი',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '', '🏠 კედელი',
    '  სიგ. × სიმ.          : ' + p.wallWidthM + ' × ' + p.wallHeightM + ' მ',
    '  კედლის ფართობი       : ' + r.wallArea.toFixed(2) + ' მ²',
    '', '🗞 რულონი',
    '  სიგ. × სიგ.          : ' + p.rollWidthM + ' × ' + p.rollLengthM + ' მ',
    '  ნახატის განმეორება   : ' + (p.patternRepeatCm > 0 ? p.patternRepeatCm + ' სმ' : 'არ მეორდება'),
    '  ეფ. ზოლის სიმ.       : ' + r.effectiveStripHeight.toFixed(2) + ' მ',
    '', '📦 შედეგი',
    '  სულ ზოლები           : ' + r.totalStrips + ' ც.',
    '  ზოლი ერთ რულონში     : ' + r.stripsPerRoll + ' ც.',
    '  საჭირო რულონები      : ' + r.totalRolls + ' ც.',
    '  შეძენილი ფართობი     : ' + r.totalPurchasedArea.toFixed(2) + ' მ²',
    '', '⚠️  შეამოწმეთ Batch Number ყველა რულონზე!',
    '', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');

  navigator.clipboard.writeText(txt).then(function() {
    if (!DOM.wpCopyBtn) return;
    DOM.wpCopyBtn.textContent = '✓ კოპირებულია!';
    DOM.wpCopyBtn.classList.add('success');
    setTimeout(function() {
      DOM.wpCopyBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/></svg> შედეგის კოპირება';
      DOM.wpCopyBtn.classList.remove('success');
    }, 2500);
  }).catch(function() { alert('კოპირება ვერ მოხდა.'); });
}

/* ============================================================
   MODULE: Tile — Canvas Drag & Drop (multi-wall aware)
   ============================================================ */

function initCanvasDragDrop() {
  // FIX 5: ID was mismatched — updateLivePreview uses 'preview-scroll-container'
  const scrollContainer = document.getElementById('preview-scroll-container') || document.body;

  scrollContainer.addEventListener('mousedown', function(e) {
    const canvas = e.target.closest('canvas');
    if (!canvas || canvas._wallIndex === undefined) return;

    const wallIndex = canvas._wallIndex;
    const walls     = getCurrentWalls();
    const wall      = walls[wallIndex] || { w: 5, h: 3 };

    const rect  = canvas.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    const PW    = canvas.clientWidth;
    const PH    = canvas.clientHeight;
    const PAD   = 40;   // FIX 7: must match drawWallPanel
    const LABEL = 30;   // FIX 7: must match drawWallPanel
    const scale = Math.min(
      (PW - PAD * 2) / (wall.w || 1),
      (PH - PAD * 2 - LABEL) / (wall.h || 1)
    );
    const ox = (PW - (wall.w || 0) * scale) / 2;
    const oy = LABEL + (PH - LABEL - (wall.h || 0) * scale) / 2;

    // Find the topmost opening in this wall under the cursor
    const wallOpenings = state.openings.filter(function(op) { return op.wallIndex === wallIndex; });
    for (let i = wallOpenings.length - 1; i >= 0; i--) {
      const op  = wallOpenings[i];
      const opX = ox + op.x * scale;
      const opY = oy + op.y * scale;
      const opW = op.width  * scale;
      const opH = op.height * scale;
      if (mx >= opX && mx <= opX + opW && my >= opY && my <= opY + opH) {
        tileDragState.targetId   = op.id;
        tileDragState.isDragging = true;
        tileDragState.wallIndex  = wallIndex;
        tileDragState.startX     = (mx - opX) / scale;
        tileDragState.startY     = (my - opY) / scale;
        break;
      }
    }
    updateLivePreview();
  });

  window.addEventListener('mousemove', function(e) {
    if (!tileDragState.isDragging) return;

    const op = state.openings.find(function(o) { return o.id === tileDragState.targetId; });
    if (!op) return;

    const wallIndex = tileDragState.wallIndex;
    const canvas    = document.querySelector('[data-wall-index="' + wallIndex + '"]') ||
                      (function() {
                        // Fallback: find by _wallIndex property
                        const all = document.querySelectorAll('#preview-scroll-container canvas');
                        for (let i = 0; i < all.length; i++) {
                          if (all[i]._wallIndex === wallIndex) return all[i];
                        }
                        return null;
                      })();
    if (!canvas) return;

    const walls = getCurrentWalls();
    const wall  = walls[wallIndex] || { w: 5, h: 3 };
    const rect  = canvas.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    const PW    = canvas.clientWidth;
    const PH    = canvas.clientHeight;
    const PAD   = 40;   // FIX 7: must match drawWallPanel
    const LABEL = 30;   // FIX 7: must match drawWallPanel
    const scale = Math.min(
      (PW - PAD * 2) / (wall.w || 1),
      (PH - PAD * 2 - LABEL) / (wall.h || 1)
    );
    const ox = (PW - (wall.w || 0) * scale) / 2;
    const oy = LABEL + (PH - LABEL - (wall.h || 0) * scale) / 2;

    const newX = (mx - ox) / scale - tileDragState.startX;
    const newY = (my - oy) / scale - tileDragState.startY;
    op.x = Math.max(0, Math.min(newX, (wall.w || 0) - op.width));
    op.y = Math.max(0, Math.min(newY, (wall.h || 0) - op.height));
    updateLivePreview();
  });

  window.addEventListener('mouseup', function() {
    if (tileDragState.isDragging) {
      tileDragState.isDragging = false;
      tileDragState.targetId   = null;
      updateLivePreview();
    }
  });

  // Touch support (delegates to mouse events)
  scrollContainer.addEventListener('touchstart', function(e) {
    const canvas = e.target.closest('canvas');
    if (!canvas) return;
    const t = e.touches[0];
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY, bubbles: true }));
    if (tileDragState.isDragging) e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchmove', function(e) {
    if (!tileDragState.isDragging) return;
    const t = e.touches[0];
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY }));
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchend', function() {
    window.dispatchEvent(new MouseEvent('mouseup', {}));
  });
}

/* ============================================================
   INIT
   ============================================================ */

function init() {
  DOM = {
    wpRollPrice:    document.getElementById('wpRollPrice'),
    wpRTotalPrice:  document.getElementById('wpRTotalPrice'),

    appTiles:     document.getElementById('appTiles'),
    appWallpaper: document.getElementById('appWallpaper'),
    tabTiles:     document.getElementById('tabTiles'),
    tabWallpaper: document.getElementById('tabWallpaper'),
    navTiles:     document.getElementById('navTiles'),
    navWallpaper: document.getElementById('navWallpaper'),

    // TILES
    surfaceLength:    document.getElementById('surfaceLength'),
    surfaceHeight:    document.getElementById('surfaceHeight'),
    grossAreaDisplay: document.getElementById('grossAreaDisplay'),

    openingsList:          document.getElementById('openingsList'),
    emptyOpenings:         document.getElementById('emptyOpenings'),
    addOpeningBtn:         document.getElementById('addOpeningBtn'),
    deductionBar:          document.getElementById('deductionBar'),
    totalDeductionDisplay: document.getElementById('totalDeductionDisplay'),

    tileLength:  document.getElementById('tileLength'),
    tileWidth:   document.getElementById('tileWidth'),
    groutJoint:  document.getElementById('groutJoint'),
    wastePct:    document.getElementById('wastePct'),
    wasteBadge:  document.getElementById('wasteBadge'),
    sqmPerBox:   document.getElementById('sqmPerBox'),

    patternGrid:         document.getElementById('patternGrid'),
    patternActiveBanner: document.getElementById('patternActiveBanner'),
    patternActiveName:   document.getElementById('patternActiveName'),
    patternActiveWaste:  document.getElementById('patternActiveWaste'),

    rTilesCount:  document.getElementById('rTilesCount'),
    rBoxes:       document.getElementById('rBoxes'),
    rPurchaseSqm: document.getElementById('rPurchaseSqm'),
    rNetSqm:      document.getElementById('rNetSqm'),
    rWasteTiles:  document.getElementById('rWasteTiles'),

    sLayout:     document.getElementById('sLayout'),
    sGross:      document.getElementById('sGross'),
    sDeduction:  document.getElementById('sDeduction'),
    sNet:        document.getElementById('sNet'),
    sTileArea:   document.getElementById('sTileArea'),
    sBaseCount:  document.getElementById('sBaseCount'),
    sFinalCount: document.getElementById('sFinalCount'),

    calculateBtn:    document.getElementById('calculateBtn'),
    resetBtn:        document.getElementById('resetBtn'),
    copyBtn:         document.getElementById('copyBtn'),
    canvas:          document.getElementById('previewCanvas'),
    openingTemplate: document.getElementById('openingTemplate'),

    // WALLPAPER
    wpWallWidth:        document.getElementById('wpWallWidth'),
    wpWallHeight:       document.getElementById('wpWallHeight'),
    wpWallAreaDisplay:  document.getElementById('wpWallAreaDisplay'),
    wpRollWidth:        document.getElementById('wpRollWidth'),
    wpRollLength:       document.getElementById('wpRollLength'),
    wpPatternRepeat:    document.getElementById('wpPatternRepeat'),
    wpPatternBadge:     document.getElementById('wpPatternBadge'),
    wpPatternHintText:  document.getElementById('wpPatternHintText'),
    wpCalculateBtn:     document.getElementById('wpCalculateBtn'),
    wpResetBtn:         document.getElementById('wpResetBtn'),
    wpCopyBtn:          document.getElementById('wpCopyBtn'),
    wpCanvas:           document.getElementById('wpPreviewCanvas'),
    wpRRolls:           document.getElementById('wpRRolls'),
    wpRStrips:          document.getElementById('wpRStrips'),
    wpRStripsPerRoll:   document.getElementById('wpRStripsPerRoll'),
    wpRWallArea:        document.getElementById('wpRWallArea'),
    wpRPurchased:       document.getElementById('wpRPurchased'),
    wpSDims:            document.getElementById('wpSDims'),
    wpSRollDims:        document.getElementById('wpSRollDims'),
    wpSPattern:         document.getElementById('wpSPattern'),
    wpSStripH:          document.getElementById('wpSStripH'),
    wpSStrips:          document.getElementById('wpSStrips'),
    wpSPerRoll:         document.getElementById('wpSPerRoll'),
    wpSRolls:           document.getElementById('wpSRolls')
  };

  // Material switcher
  [DOM.tabTiles, DOM.tabWallpaper].forEach(function(btn) {
    if (!btn) return;
    btn.addEventListener('click', function() { switchMaterial(btn.getAttribute('data-material')); });
  });

  // TILES: main buttons
  if (DOM.calculateBtn) DOM.calculateBtn.addEventListener('click', runCalculation);
  if (DOM.resetBtn)     DOM.resetBtn.addEventListener('click', resetTiles);
  if (DOM.copyBtn)      DOM.copyBtn.addEventListener('click', copyTileResult);
  if (DOM.addOpeningBtn) DOM.addOpeningBtn.addEventListener('click', function() { addOpening('door', 0); });

  // TILES: layout pattern buttons
  if (DOM.patternGrid) {
    DOM.patternGrid.querySelectorAll('.pattern-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { applyLayoutPattern(btn.getAttribute('data-pattern')); });
    });
  }

  // FIX 5: tile params now trigger both preview AND calculation
  [DOM.tileLength, DOM.tileWidth, DOM.groutJoint, DOM.sqmPerBox].forEach(function(el) {
    if (!el) return;
    el.addEventListener('input', function() {
      updateLivePreview();
      runCalculation();
    });
  });

  // FIX 3a: waste slider now calls runCalculation()
  if (DOM.wastePct) {
    DOM.wastePct.addEventListener('input', function() {
      if (DOM.wasteBadge) DOM.wasteBadge.textContent = DOM.wastePct.value + '%';
      updateRangeBackground(DOM.wastePct);
      state.activePattern = null;
      clearActivePattern();
      runCalculation();   // ← was missing
    });
  }

  // TILES: wallsList delegated input (covers dynamically added walls)
  const wallsList = document.getElementById('wallsList');
  if (wallsList) {
    wallsList.addEventListener('input', function(e) {
      if (e.target.classList.contains('wall-width') || e.target.classList.contains('wall-height')) {
        updateLivePreview();
        runCalculation();
      }
    });
  }

  // TILES: addWallBtn
  const addWallBtn = document.getElementById('addWallBtn');
  if (addWallBtn) addWallBtn.addEventListener('click', addWall);

  // WALLPAPER: buttons
  if (DOM.wpCalculateBtn) DOM.wpCalculateBtn.addEventListener('click', runWallpaperCalculation);
  if (DOM.wpResetBtn)     DOM.wpResetBtn.addEventListener('click', resetWallpaper);
  if (DOM.wpCopyBtn)      DOM.wpCopyBtn.addEventListener('click', copyWallpaperResult);

  // WALLPAPER: pattern repeat slider — badge text update only; recalc via setupWallpaperAutoSync
  if (DOM.wpPatternRepeat) {
    DOM.wpPatternRepeat.addEventListener('input', function() {
      const v = parseInt(DOM.wpPatternRepeat.value, 10);
      if (DOM.wpPatternBadge)    DOM.wpPatternBadge.textContent   = v + ' სმ';
      if (DOM.wpPatternHintText) DOM.wpPatternHintText.textContent = v === 0
        ? 'Rapport 0 — ნახატი არ მეორდება'
        : 'Rapport ' + v + ' სმ — ყოველ ' + v + ' სმ-ზე ნახატი მეორდება';
      updateRangeBackground(DOM.wpPatternRepeat, 'var(--rose)');
      // full recalc is triggered by setupWallpaperAutoSync
    });
  }

  // WALLPAPER: perimeter toggle — show/hide panels; recalc via setupWallpaperAutoSync
  const wpPerimeterToggle = document.getElementById('wpPerimeterMode');
  const wpSingleInputs    = document.getElementById('wpSingleWallInputs');
  const wpRoomInputs      = document.getElementById('wpRoomInputs');
  if (wpPerimeterToggle) {
    wpPerimeterToggle.addEventListener('change', function() {
      if (wpSingleInputs) wpSingleInputs.style.display = this.checked ? 'none'  : 'block';
      if (wpRoomInputs)   wpRoomInputs.style.display   = this.checked ? 'block' : 'none';
      // full recalc triggered by setupWallpaperAutoSync (change event on checkbox)
    });
  }

  // Note: all wallpaper input recalc is handled by setupWallpaperAutoSync() below

  // Keyboard shortcut: Ctrl+Enter
  document.addEventListener('keydown', function(e) {
    if (!e.ctrlKey) return;
    if (e.key === 'Enter') {
      state.activeMaterial === 'tiles' ? runCalculation() : runWallpaperCalculation();
    }
  });

  initTilesSectionNav();
  initWallpaperSectionNav();
  initCanvasDragDrop();

  // ResizeObserver for wallpaper canvas only (tiles use per-wall panels now)
  if (DOM.wpCanvas && DOM.wpCanvas.parentElement) {
    new ResizeObserver(function() {
      if (state.activeMaterial === 'wallpaper') updateWallpaperPreview();
    }).observe(DOM.wpCanvas.parentElement);
  }

  // ResizeObserver for tile preview container — redraws on window/layout resize
  const tileScrollEl = document.getElementById('preview-scroll-container');
  if (tileScrollEl) {
    new ResizeObserver(function() {
      if (state.activeMaterial === 'tiles') updateLivePreview();
    }).observe(tileScrollEl);
  }

  // Initial render
  applyLayoutPattern('custom');
  updateRangeBackground(DOM.wastePct);
  updateRangeBackground(DOM.wpPatternRepeat, 'var(--rose)');
  updateLivePreview();
  updateWallpaperAreaDisplay();

  setupWallpaperAutoSync()
}



//აქ ირთვება ფილებში პერიმეტრით უნდა გამოთვლა თუ კედლების სათითაოდ შეყვანით
let isQuickMode = false;

function toggleCalcMode() {
    const toggleBtn = document.getElementById('modeToggleBtn');
    const quickBlock = document.getElementById('quickAreaBlock');
    const wallsList = document.getElementById('wallsList');
    const addWallBtn = document.getElementById('addWallBtn');

    isQuickMode = !isQuickMode;
    
    if (isQuickMode) {
        toggleBtn.classList.add('active');
        quickBlock.style.display = 'block';
        wallsList.style.opacity = '0.3';
        wallsList.style.pointerEvents = 'none'; // გათიშავს კედლების რედაქტირებას
        addWallBtn.style.display = 'none';
    } else {
        toggleBtn.classList.remove('active');
        quickBlock.style.display = 'none';
        wallsList.style.opacity = '1';
        wallsList.style.pointerEvents = 'all';
        addWallBtn.style.display = 'block';
    }
    
    runCalculation();
}

function exportToPDF() {
    // 1. ვადგენთ რომელი აპლიკაციაა აქტიური (ფილები თუ შპალერი)
    const isTilesActive = document.getElementById('appTiles').style.display !== 'none';
    const activeApp = isTilesActive ? document.getElementById('appTiles') : document.getElementById('appWallpaper');
    
    // 2. ვიღებთ კონკრეტულ შედეგების სვეტს (.output-column) აქტიური აპლიკაციიდან
    const element = activeApp.querySelector('.output-column');
    
    if (!element) {
        console.error("PDF-ის კონტეინერი ვერ მოიძებნა!");
        return;
    }

    const opt = {
        margin:       [10, 10, 10, 10],
        filename:     isTilesActive ? 'ფილების-ანგარიში.pdf' : 'შპალერის-ანგარიში.pdf',
        image:        { type: 'jpeg', quality: 1.0 },
        html2canvas:  { 
            scale: 3, 
            useCORS: true,
            backgroundColor: '#0f1117',
            scrollY: 0,
            letterRendering: true,
            onclone: (clonedDoc) => {
                // აუცილებელია კლონირებულ დოკუმენტშიც ვიპოვოთ აქტიური სექცია
                const clonedAppId = isTilesActive ? 'appTiles' : 'appWallpaper';
                const container = clonedDoc.getElementById(clonedAppId).querySelector('.output-column');

                if (container) {
                    container.style.height = 'auto';
                    container.style.maxHeight = 'none';
                    container.style.overflow = 'visible';
                    container.style.paddingRight = '0';
                    container.style.border = 'none';
                }

                // --- ფილების სპეციფიკური გასწორება ---
                if (isTilesActive) {
                    const scrollEl = clonedDoc.getElementById('preview-scroll-container') || clonedDoc.getElementById('previewScroll');
                    if (scrollEl) {
                        scrollEl.style.display = 'flex';
                        scrollEl.style.flexDirection = 'column';
                        scrollEl.style.gap = '30px';
                        scrollEl.style.overflow = 'visible';
                        scrollEl.style.height = 'auto';
                    }
                    const panels = clonedDoc.querySelectorAll('.wall-panel');
                    panels.forEach(p => {
                        p.style.flex = 'none';
                        p.style.width = '100%';
                        p.style.maxWidth = '600px';
                        p.style.margin = '0 auto 20px auto';
                    });
                } 
                // --- შპალერის სპეციფიკური გასწორება ---
                else {
                    const wpCanvas = clonedDoc.getElementById('wpPreviewCanvas');
                    if (wpCanvas) {
                        wpCanvas.style.width = '100%';
                        wpCanvas.style.height = 'auto';
                        wpCanvas.style.maxWidth = '600px';
                        wpCanvas.style.margin = '0 auto';
                        wpCanvas.style.display = 'block';
                    }
                }

                // მთავარი ციფრების ფერის გასწორება (ლურჯი ფილებისთვის, ვარდისფერი შპალერისთვის)
                const heroNumbers = clonedDoc.querySelectorAll('.hero-number');
                heroNumbers.forEach(n => {
                    n.style.background = 'none';
                    const color = isTilesActive ? '#3b82f6' : '#e11d48';
                    n.style.webkitTextFillColor = color;
                    n.style.color = color;
                });

                // ყველა ღილაკის დამალვა PDF-ში
                const buttons = clonedDoc.querySelectorAll('button');
                buttons.forEach(btn => btn.style.display = 'none');
                
                // "შედეგის კოპირება" ბლოკის დამალვა
                const actions = clonedDoc.querySelectorAll('.results-actions');
                actions.forEach(a => a.style.display = 'none');
            }
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save();
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.classList.toggle('active');
    }
}

// მენიუს ავტომატური ჩაკეტვა ნებისმიერ ტაბზე ან ნავიგაციაზე დაჭერისას
document.addEventListener('click', (e) => {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    const isClickInsideMenu = e.target.closest('.nav-item') || e.target.closest('.material-tab');
    const isBurgerBtn = e.target.closest('.burger-menu-btn');
    const isCloseBtn = e.target.closest('.sidebar-close-btn');

    // თუ დავაჭირეთ მენიუს ელემენტს ან დახურვის ღილაკს
    if ((isClickInsideMenu || isCloseBtn) && window.innerWidth <= 992) {
        sidebar.classList.remove('active');
    }
});
// app.js — Wallpaper Auto-Sync
// Wires every wallpaper input so that any change triggers a full recalculation
// AND a canvas preview redraw — no "Calculate" button click needed.
function setupWallpaperAutoSync() {
    // Collect all relevant inputs. wpRoomLength and wpRoomWidth are the perimeter
    // mode inputs; wpWallWidth is the single-wall mode input.
    const inputs = [
        DOM.wpWallWidth,
        DOM.wpWallHeight,
        DOM.wpRollWidth,
        DOM.wpRollLength,
        DOM.wpPatternRepeat,
        DOM.wpRollPrice,
        document.getElementById('wpPerimeterMode'),
        document.getElementById('wpRoomLength'),
        document.getElementById('wpRoomWidth')
    ];

    inputs.forEach(function(el) {
        if (!el) return;
        // Checkboxes fire 'change'; range/number/select inputs fire 'input'
        const eventName = (el.type === 'checkbox') ? 'change' : 'input';
        el.addEventListener(eventName, function() {
            // Run the full calculation (which also calls updateWallpaperPreview internally)
            runWallpaperCalculation();
        });
    });
}

document.addEventListener('DOMContentLoaded', init);
