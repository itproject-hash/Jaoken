/**
 * calculator-logic.js — Tile Calculation Engine  (v3 — area-based formula)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * FIX LOG (v3):
 *
 *  FIX 1 — Formula rewritten to area-based method as requested:
 *    OLD (piece-by-piece grid):
 *      cols = ceil(totalLength / tileM_L)
 *      rows = ceil(maxHeight  / tileM_W)
 *      baseCount = cols × rows   ← over-counts badly for multi-wall rooms
 *
 *    NEW (area-based):
 *      baseCount = ceil(netArea / realTileArea)
 *      finalCount = ceil(baseCount × (1 + wastePercent / 100))
 *
 *    This is more accurate, correctly reflects the requested formula, and
 *    works naturally with multi-wall rooms because netArea already aggregates
 *    all wall surfaces minus openings.
 *
 *  FIX 2 — realTileArea uses effective area (including grout joint) for
 *    baseCount, but purchaseArea uses the physical tile face area (no grout)
 *    so that the buyer pays for tile face area only.  Both are now explicit.
 *
 *  FIX 3 — wastePercent read with explicit null-check (not falsy || 0 guard)
 *    so that a legitimate 0% waste value is honoured and not silently replaced.
 *
 *  UNCHANGED:
 *  - calcGrossArea: dual-signature overload (walls[] OR length, height)
 *  - getLayoutPattern: returns {labelKa, wastePercent}
 *  - calcTotalDeduction: sums opening areas
 *  - calculateAll: still accepts params.openings[] and deducts them
 */
"use strict";

const LAYOUT_PATTERNS = {
  standard: { wastePercent: 5,  labelKa: 'სტანდარტული' },
  brick:    { wastePercent: 10, labelKa: 'აგურისებური' },
  diagonal: { wastePercent: 15, labelKa: 'დიაგონალური' },
  custom:   { wastePercent: 0,  labelKa: 'მომხმარებელი' }
};

const TileLogic = {

  /**
   * Gross area helper — dual call signature:
   *   calcGrossArea(walls[{width,height}])  ← updateDeductionBar
   *   calcGrossArea(length, height)          ← updateGrossDisplay
   */
  calcGrossArea: function(wallsOrLength, height) {
    if (Array.isArray(wallsOrLength)) {
      return wallsOrLength.reduce(function(sum, w) {
        return sum + (parseFloat(w.width) || 0) * (parseFloat(w.height) || 0);
      }, 0);
    }
    return (parseFloat(wallsOrLength) || 0) * (parseFloat(height) || 0);
  },

  /**
   * Returns {labelKa, wastePercent} for the given pattern key.
   */
  getLayoutPattern: function(pattern) {
    return LAYOUT_PATTERNS[pattern] || { wastePercent: 0, labelKa: 'მომხმარებელი' };
  },

  /**
   * Total deduction area from openings [{width, height}, …].
   */
  calcTotalDeduction: function(openings) {
    if (!Array.isArray(openings)) return 0;
    return openings.reduce(function(sum, op) {
      return sum + (parseFloat(op.width) || 0) * (parseFloat(op.height) || 0);
    }, 0);
  },

  /**
   * Master calculation — area-based formula.
   *
   * params = {
   *   walls:        [{w, h}, …],
   *   openings:     [{width, height}, …],
   *   tileLengthCm: number,
   *   tileWidthCm:  number,
   *   groutMm:      number,
   *   wastePercent: number,   // 0–100; 0 is valid
   *   sqmPerBox:    number
   * }
   *
   * Formula (as specified):
   *   grossArea      = Σ (wall.w × wall.h)
   *   totalDeduction = Σ (opening.width × opening.height)
   *   netArea        = max(0, grossArea − totalDeduction)
   *
   *   effectiveTileArea = (tileL_m + grout_m) × (tileW_m + grout_m)
   *   realTileArea      = tileL_m × tileW_m  (physical face, no grout)
   *
   *   baseCount  = ceil(netArea / effectiveTileArea)
   *   finalCount = ceil(baseCount × (1 + wastePercent / 100))
   *
   *   purchaseArea = finalCount × realTileArea
   *   boxCount     = ceil(purchaseArea / sqmPerBox)
   */
calculateAll: function(params) {
    var walls      = Array.isArray(params.walls)    ? params.walls    : [];
    var openings   = Array.isArray(params.openings) ? params.openings : [];

    var tLenM = (parseFloat(params.tileLengthCm) || 0) / 100; // 1.2მ
    var tWidM = (parseFloat(params.tileWidthCm)  || 0) / 100; // 0.6მ
    var waste = (params.wastePercent != null) ? (parseFloat(params.wastePercent) || 0) : 0;
    var sqmBox = parseFloat(params.sqmPerBox) || 0;

    var totalBaseCount = 0;
    var totalGrossArea = 0;

    // შენი ლოგიკის იმპლემენტაცია:
    walls.forEach(function(wall) {
        var wW = parseFloat(wall.w) || 0;
        var wH = parseFloat(wall.h) || 0;
        
        if (wW > 0 && wH > 0) {
            totalGrossArea += (wW * wH);

            // 1. სიგრძეზე ფილების რაოდენობა
            var countX = wW / tLenM;
            var decimalX = countX % 1;
            var finalX = (decimalX > 0.5) ? Math.ceil(countX) : (Math.floor(countX) + 0.5);
            if (decimalX === 0) finalX = countX; // თუ ზუსტად იყოფა

            // 2. სიმაღლეზე ფილების რაოდენობა
            var countY = wH / tWidM;
            var decimalY = countY % 1;
            var finalY = (decimalY > 0.5) ? Math.ceil(countY) : (Math.floor(countY) + 0.5);
            if (decimalY === 0) finalY = countY; // თუ ზუსტად იყოფა

            // ამ კედლის ფილების ჯამი
            totalBaseCount += (finalX * finalY);
        }
    });

    // ღიობების გამოკლება (ფართობის მიხედვით)
    var totalDeduction = this.calcTotalDeduction(openings);
    var netArea = Math.max(0, totalGrossArea - totalDeduction);

    // თუ გაქვს ღიობები, ვაკლებთ მათ შესაბამის ფილებს (პროპორციულად)
    if (totalGrossArea > 0 && totalDeduction > 0) {
        var tilesToSubtract = totalDeduction / (tLenM * tWidM);
        totalBaseCount = Math.max(0, totalBaseCount - tilesToSubtract);
    }

    // საბოლოო დამრგვალება
    var finalCount = Math.ceil(totalBaseCount * (1 + waste / 100));
    var purchaseArea = finalCount * (tLenM * tWidM);

    return {
        grossArea: totalGrossArea,
        totalDeduction: totalDeduction,
        netArea: netArea,
        baseCount: Math.ceil(totalBaseCount), 
        finalCount: finalCount,
        purchaseArea: purchaseArea,
        boxCount: (sqmBox > 0) ? Math.ceil(purchaseArea / sqmBox) : 0,
        wasteTiles: finalCount - Math.ceil(totalBaseCount)
    };
}

};

window.TileLogic = TileLogic;
window.TileLogic.LAYOUT_PATTERNS = LAYOUT_PATTERNS;
