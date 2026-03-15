import { drawCourtBackground, drawCourtLines } from './court.js';

/**
 * Render a shot chart with heatmap and scatter overlay.
 * @param {HTMLCanvasElement} canvas
 * @param {Array} shots - [{coordinate_x, coordinate_y, scoring_play}]
 */
export function renderShotChart(canvas, shots) {
    const courtW = 600;
    const courtH = 460;
    const legendMargin = 50; // space for legend to the right
    const W = courtW + legendMargin;
    const H = courtH;
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');

    // 1. Draw court background (white fill over entire canvas)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const { cx, cy, scaleX, scaleY } = drawCourtBackground(ctx, courtW, courtH);

    if (!shots.length) {
        // Still draw lines even with no shots
        drawCourtLines(ctx, W, H, cx, cy, scaleX, scaleY);
        return;
    }

    const allX = shots.map(s => s.coordinate_x);
    const allY = shots.map(s => s.coordinate_y);

    // Build heatmap histogram (200x200)
    const res = 200;
    const xMin = 0, xMax = 50, yMin = -2, yMax = 35;
    const heatmap = new Float32Array(res * res);

    for (let i = 0; i < allX.length; i++) {
        const xi = Math.floor((allX[i] - xMin) / (xMax - xMin) * (res - 1));
        const yi = Math.floor((allY[i] - yMin) / (yMax - yMin) * (res - 1));
        if (xi >= 0 && xi < res && yi >= 0 && yi < res) {
            heatmap[yi * res + xi] += 1;
        }
    }

    // Separable gaussian blur (sigma=6)
    const sigma = 6;
    const kSize = Math.ceil(sigma * 3) * 2 + 1;
    const kernel = new Float32Array(kSize);
    const half = Math.floor(kSize / 2);
    let kSum = 0;
    for (let i = 0; i < kSize; i++) {
        const d = i - half;
        kernel[i] = Math.exp(-0.5 * (d * d) / (sigma * sigma));
        kSum += kernel[i];
    }
    for (let i = 0; i < kSize; i++) kernel[i] /= kSum;

    // Horizontal pass
    const temp = new Float32Array(res * res);
    for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
            let val = 0;
            for (let k = 0; k < kSize; k++) {
                const sx = x + k - half;
                if (sx >= 0 && sx < res) {
                    val += heatmap[y * res + sx] * kernel[k];
                }
            }
            temp[y * res + x] = val;
        }
    }
    // Vertical pass
    const blurred = new Float32Array(res * res);
    for (let x = 0; x < res; x++) {
        for (let y = 0; y < res; y++) {
            let val = 0;
            for (let k = 0; k < kSize; k++) {
                const sy = y + k - half;
                if (sy >= 0 && sy < res) {
                    val += temp[sy * res + x] * kernel[k];
                }
            }
            blurred[y * res + x] = val;
        }
    }

    // Find max for normalization
    let maxVal = 0;
    for (let i = 0; i < blurred.length; i++) {
        if (blurred[i] > maxVal) maxVal = blurred[i];
    }

    // Blue-to-red heatmap colormap
    function heatColor(t) {
        // t: 0..1 — cool blue → warm red
        if (t < 0.33) {
            const s = t / 0.33;
            return [Math.round(70 + s * 20), Math.round(130 + s * 50), Math.round(180 + s * 30)];
        } else if (t < 0.66) {
            const s = (t - 0.33) / 0.33;
            return [Math.round(90 + s * 140), Math.round(180 - s * 50), Math.round(210 - s * 140)];
        } else {
            const s = (t - 0.66) / 0.34;
            return [Math.round(230 + s * 15), Math.round(130 - s * 80), Math.round(70 - s * 50)];
        }
    }

    // 2. Render heatmap on top of background
    if (maxVal > 0) {
        const imgData = ctx.createImageData(res, res);
        for (let y = 0; y < res; y++) {
            for (let x = 0; x < res; x++) {
                const val = blurred[y * res + x] / maxVal;
                const idx = ((res - 1 - y) * res + x) * 4; // flip Y for canvas
                if (val > 0.02) {
                    const [r, g, b] = heatColor(val);
                    imgData.data[idx] = r;
                    imgData.data[idx + 1] = g;
                    imgData.data[idx + 2] = b;
                    imgData.data[idx + 3] = Math.round(val * 180); // alpha
                } else {
                    imgData.data[idx + 3] = 0;
                }
            }
        }

        // Draw heatmap to an offscreen canvas then scale to main
        const offscreen = document.createElement('canvas');
        offscreen.width = res;
        offscreen.height = res;
        offscreen.getContext('2d').putImageData(imgData, 0, 0);

        // Map court extent to canvas coords
        const dstX = cx(xMin);
        const dstY = cy(yMax);
        const dstW = cx(xMax) - cx(xMin);
        const dstH = cy(yMin) - cy(yMax);
        ctx.drawImage(offscreen, dstX, dstY, dstW, dstH);
    }

    // 3. Draw court lines ON TOP of heatmap
    drawCourtLines(ctx, W, H, cx, cy, scaleX, scaleY);

    // 4. Scatter: misses as red X, makes as green circles (on top of everything)
    for (const shot of shots) {
        const px = cx(shot.coordinate_x);
        const py = cy(shot.coordinate_y);

        if (shot.scoring_play) {
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(39, 174, 96, 0.45)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        } else {
            ctx.strokeStyle = 'rgba(192, 57, 43, 0.35)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(px - 2.5, py - 2.5);
            ctx.lineTo(px + 2.5, py + 2.5);
            ctx.moveTo(px + 2.5, py - 2.5);
            ctx.lineTo(px - 2.5, py + 2.5);
            ctx.stroke();
        }
    }

    // 5. Color scale legend (right of court, centered vertically)
    const legendW = 28;
    const legendH = 192;
    const legendX = courtW + (legendMargin - legendW) / 2;
    const legendY = (H - legendH) / 2;

    for (let i = 0; i < legendH; i++) {
        const t = 1 - i / (legendH - 1); // top=1 (hot), bottom=0 (cold)
        const [r, g, b] = heatColor(t);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(legendX, legendY + i, legendW, 1);
    }

    // Legend border
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, legendY, legendW, legendH);

    // Labels
    ctx.fillStyle = '#999';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Hot', legendX + legendW / 2, legendY - 4);
    ctx.fillText('Cold', legendX + legendW / 2, legendY + legendH + 12);
}
