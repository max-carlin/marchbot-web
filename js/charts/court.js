/**
 * Draw a half basketball court on an HTML5 Canvas.
 * ESPN coords: x=0-50 (sideline to sideline), y=0 at baseline, basket ~y=4.
 * Canvas is mapped so court coords can be used directly after scaling.
 *
 * Split into background + lines so shot-chart.js can sandwich the heatmap
 * between them (heatmap on top of background, lines on top of heatmap).
 */

const courtColor = '#ffffff';
const lineColor = '#000000';
const lw = 1.5;

const courtXMin = -2, courtXMax = 52;
const courtYMin = -3, courtYMax = 35;

function makeTransforms(width, height) {
    const scaleX = width / (courtXMax - courtXMin);
    const scaleY = height / (courtYMax - courtYMin);
    function cx(x) { return (x - courtXMin) * scaleX; }
    function cy(y) { return height - (y - courtYMin) * scaleY; }
    return { cx, cy, scaleX, scaleY };
}

/**
 * Draw only the court background (white fill). Returns transform helpers.
 */
export function drawCourtBackground(ctx, width, height) {
    const t = makeTransforms(width, height);
    ctx.fillStyle = courtColor;
    ctx.fillRect(0, 0, width, height);
    return t;
}

/**
 * Draw court lines/arcs on top of whatever is already on the canvas.
 */
export function drawCourtLines(ctx, width, height, cx, cy, scaleX, scaleY) {
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lw;

    function line(x1, y1, x2, y2, w) {
        ctx.lineWidth = w || lw;
        ctx.beginPath();
        ctx.moveTo(cx(x1), cy(y1));
        ctx.lineTo(cx(x2), cy(y2));
        ctx.stroke();
    }

    function arc(centerX, centerY, radiusX, radiusY, startDeg, endDeg, dash) {
        ctx.save();
        if (dash) ctx.setLineDash([4, 4]);
        ctx.beginPath();
        const startRad = -endDeg * Math.PI / 180;
        const endRad = -startDeg * Math.PI / 180;
        ctx.ellipse(cx(centerX), cy(centerY), radiusX * scaleX / 2, radiusY * scaleY / 2, 0, startRad, endRad);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    // Outer boundary
    line(0, 0, 0, 47, lw + 0.5);
    line(50, 0, 50, 47, lw + 0.5);
    line(0, 0, 50, 0, lw + 0.5);
    line(0, 47, 50, 47, lw + 0.5);

    // Paint / lane
    line(19, 0, 19, 19);
    line(31, 0, 31, 19);
    line(19, 19, 31, 19);

    // Free throw circle (top half)
    arc(25, 19, 12, 12, 0, 180);
    // Dashed bottom half
    arc(25, 19, 12, 12, 180, 360, true);

    // Basket
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(cx(25), cy(4), 0.75 * scaleX / 2, 0, Math.PI * 2);
    ctx.stroke();

    // Backboard
    line(22, 0.5, 28, 0.5, lw + 1);

    // Restricted arc
    arc(25, 4, 8, 8, 0, 180);

    // Three-point line
    line(3.3, 0, 3.3, 8);
    line(46.7, 0, 46.7, 8);
    arc(25, 4, 43.4, 43.4, 11, 169);

    // Half court line
    line(0, 47, 50, 47);
}

/**
 * Legacy: draw background + lines in one call. Returns transform helpers.
 */
export function drawHalfCourt(ctx, width, height) {
    const t = drawCourtBackground(ctx, width, height);
    drawCourtLines(ctx, width, height, t.cx, t.cy, t.scaleX, t.scaleY);
    return t;
}
