/**
 * Scene classes for the interactive simulation visualization.
 * Each scene has duration (seconds), update(t), draw(ctx, w, h), and optional onHover(x, y).
 */

// ── Easing & drawing utils ──

export function easeOutCubic(t) {
    return 1 - (1 - t) ** 3;
}

function normalPdf(x, mean, std) {
    const exp = -0.5 * ((x - mean) / std) ** 2;
    return Math.exp(exp) / (std * Math.sqrt(2 * Math.PI));
}

function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawText(ctx, text, x, y, opts = {}) {
    const { size = 14, weight = 'normal', color = '#1a1a1a', align = 'left', baseline = 'top', font = 'Times New Roman' } = opts;
    ctx.font = `${weight} ${size}px '${font}', serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(text, x, y);
}

// ── Decision tree constants (from sim_video.py) ──

const DECISION_TREE_NODES = {
    root:     { x: 0.5,  y: 0.08, label: 'Possession' },
    turnover: { x: 0.15, y: 0.32, label: 'Turnover' },
    no_to:    { x: 0.65, y: 0.32, label: 'No TO' },
    foul:     { x: 0.4,  y: 0.56, label: 'Foul (FTs)' },
    no_foul:  { x: 0.75, y: 0.56, label: 'Shot' },
    two_pt:   { x: 0.6,  y: 0.78, label: '2PT' },
    three_pt: { x: 0.9,  y: 0.78, label: '3PT' },
    make:     { x: 0.75, y: 0.95, label: 'Make' },
    miss:     { x: 0.6,  y: 0.95, label: 'Miss' },
};

const DECISION_TREE_EDGES = [
    ['root', 'turnover'],
    ['root', 'no_to'],
    ['no_to', 'foul'],
    ['no_to', 'no_foul'],
    ['no_foul', 'two_pt'],
    ['no_foul', 'three_pt'],
    ['two_pt', 'make'],
    ['two_pt', 'miss'],
    ['three_pt', 'make'],
    ['three_pt', 'miss'],
];

// Map sim trace outcomes to decision tree paths
function outcomePath(outcome) {
    switch (outcome) {
        case 'turnover': return ['root', 'turnover'];
        case 'foul':     return ['root', 'no_to', 'foul'];
        case 'made2':    return ['root', 'no_to', 'no_foul', 'two_pt', 'make'];
        case 'miss2':    return ['root', 'no_to', 'no_foul', 'two_pt', 'miss'];
        case 'made3':    return ['root', 'no_to', 'no_foul', 'three_pt', 'make'];
        case 'miss3':    return ['root', 'no_to', 'no_foul', 'three_pt', 'miss'];
        default:         return ['root'];
    }
}

function drawDecisionTree(ctx, ox, oy, w, h, highlightPath) {
    const pathSet = new Set(highlightPath || []);

    // Draw edges
    for (const [parentKey, childKey] of DECISION_TREE_EDGES) {
        const parent = DECISION_TREE_NODES[parentKey];
        const child = DECISION_TREE_NODES[childKey];
        const inPath = pathSet.has(parentKey) && pathSet.has(childKey);
        ctx.strokeStyle = inPath ? '#2d6a4f' : '#ddd';
        ctx.lineWidth = inPath ? 3 : 1;
        ctx.beginPath();
        ctx.moveTo(ox + parent.x * w, oy + parent.y * h);
        ctx.lineTo(ox + child.x * w, oy + child.y * h);
        ctx.stroke();
    }

    // Draw nodes
    for (const [key, node] of Object.entries(DECISION_TREE_NODES)) {
        const inPath = pathSet.has(key);
        const nx = ox + node.x * w;
        const ny = oy + node.y * h;
        const r = inPath ? 10 : 6;

        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
        ctx.fillStyle = inPath ? '#2d6a4f' : '#95a5a6';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();

        drawText(ctx, node.label, nx, ny + r + 4, {
            size: inPath ? 10 : 8,
            weight: inPath ? 'bold' : 'normal',
            color: inPath ? '#1a1a1a' : '#95a5a6',
            align: 'center',
            baseline: 'top',
        });
    }
}

// ── Scene 1: Title Card ──

export class TitleCardScene {
    constructor(data, colors) {
        this.duration = 3;
        this.data = data;
        this.c = colors;
        this.t = 0;
    }

    update(t) { this.t = t; }

    draw(ctx, w, h) {
        const { nameA, nameB, profileA, profileB, nSims } = this.data;
        const t = Math.min(this.t / this.duration, 1);
        const alpha = easeOutCubic(Math.min(t * 2, 1));

        ctx.globalAlpha = alpha;

        // Title
        drawText(ctx, `${nameA}  vs  ${nameB}`, w / 2, h * 0.22, {
            size: Math.min(w * 0.042, 32), weight: 'bold', color: this.c.text, align: 'center', baseline: 'middle',
        });

        // Sim count (count up)
        const count = Math.floor(easeOutCubic(Math.min(t * 1.5, 1)) * nSims);
        drawText(ctx, `${count.toLocaleString()} simulations`, w / 2, h * 0.34, {
            size: Math.min(w * 0.028, 18), color: this.c.dim, align: 'center', baseline: 'middle',
        });

        // Team A ratings
        const netA = profileA.adj_o - profileA.adj_d;
        const netB = profileB.adj_o - profileB.adj_d;
        const ratingAlpha = easeOutCubic(Math.max(0, (t - 0.3) / 0.7));
        ctx.globalAlpha = ratingAlpha;

        const colW = w * 0.35;
        const leftX = w * 0.25;
        const rightX = w * 0.75;
        const ratingY = h * 0.52;

        drawText(ctx, nameA, leftX, ratingY, {
            size: Math.min(w * 0.03, 18), weight: 'bold', color: this.c.teamA, align: 'center', baseline: 'middle',
        });
        const statsA = `AdjO: ${profileA.adj_o.toFixed(1)}   AdjD: ${profileA.adj_d.toFixed(1)}   Net: ${netA >= 0 ? '+' : ''}${netA.toFixed(1)}`;
        drawText(ctx, statsA, leftX, ratingY + 28, {
            size: Math.min(w * 0.02, 13), color: this.c.text, align: 'center', baseline: 'middle',
        });

        drawText(ctx, nameB, rightX, ratingY, {
            size: Math.min(w * 0.03, 18), weight: 'bold', color: this.c.teamB, align: 'center', baseline: 'middle',
        });
        const statsB = `AdjO: ${profileB.adj_o.toFixed(1)}   AdjD: ${profileB.adj_d.toFixed(1)}   Net: ${netB >= 0 ? '+' : ''}${netB.toFixed(1)}`;
        drawText(ctx, statsB, rightX, ratingY + 28, {
            size: Math.min(w * 0.02, 13), color: this.c.text, align: 'center', baseline: 'middle',
        });

        // Pace
        const paceY = h * 0.72;
        const paceA = profileA.possessions_per_game.toFixed(0);
        const paceB = profileB.possessions_per_game.toFixed(0);
        drawText(ctx, `Pace: ${paceA}`, leftX, paceY, {
            size: 12, color: this.c.dim, align: 'center', baseline: 'middle',
        });
        drawText(ctx, `Pace: ${paceB}`, rightX, paceY, {
            size: 12, color: this.c.dim, align: 'center', baseline: 'middle',
        });

        ctx.globalAlpha = 1;
    }

    getTooltip() { return null; }
}

// ── Scene 2: Team Profiles ──

export class TeamProfilesScene {
    constructor(data, colors) {
        this.duration = 5;
        this.data = data;
        this.c = colors;
        this.t = 0;
        this.hoverInfo = null;
    }

    update(t) { this.t = t; }

    draw(ctx, w, h) {
        const { nameA, nameB, profileA, profileB } = this.data;
        const t = Math.min(this.t / this.duration, 1);
        const progress = easeOutCubic(Math.min(t * 2.5, 1));

        const rotA = profileA.rotation.slice(0, 6);
        const rotB = profileB.rotation.slice(0, 6);

        const margin = { top: h * 0.08, bottom: h * 0.22, left: w * 0.02, right: w * 0.02 };
        const mid = w / 2;
        const gap = w * 0.04;
        const panelW = mid - gap / 2 - margin.left;
        const barAreaH = h - margin.top - margin.bottom;

        // Store bar rects for hover
        this._barRects = [];

        const drawBars = (rotation, panelX, teamColor, teamName, side) => {
            const n = rotation.length;
            const barH = Math.min((barAreaH - 20) / n - 6, 28);
            const totalBarsH = n * (barH + 6);
            const startY = margin.top + 30;

            // Team name header
            drawText(ctx, teamName, panelX + panelW / 2, margin.top + 6, {
                size: Math.min(w * 0.025, 16), weight: 'bold', color: teamColor, align: 'center',
            });

            const maxUsage = 0.35;

            for (let i = 0; i < n; i++) {
                const p = rotation[i];
                const y = startY + i * (barH + 6);
                const barWidth = (p.usage_rate / maxUsage) * panelW * 0.6 * progress;

                // Player name
                const nameX = side === 'left' ? panelX : panelX;
                drawText(ctx, p.name.length > 14 ? p.name.slice(0, 13) + '...' : p.name, nameX, y + barH / 2, {
                    size: Math.min(w * 0.016, 11), color: this.c.text, baseline: 'middle',
                });

                // Bar
                const barX = panelX + panelW * 0.35;
                const bw = barWidth;
                drawRoundedRect(ctx, barX, y + 2, bw, barH - 4, 3);
                ctx.fillStyle = teamColor;
                ctx.globalAlpha = 0.85;
                ctx.fill();
                ctx.globalAlpha = 1;

                this._barRects.push({
                    x: barX, y: y + 2, w: bw, h: barH - 4,
                    player: p, team: teamName,
                });

                // Shooting annotations
                if (progress > 0.5) {
                    const annotAlpha = Math.min((progress - 0.5) / 0.5, 1);
                    ctx.globalAlpha = annotAlpha;
                    drawText(ctx, `2P:${(p.two_pct * 100).toFixed(0)}% 3P:${(p.three_pct * 100).toFixed(0)}%`, barX + bw + 6, y + barH / 2, {
                        size: Math.min(w * 0.013, 9), color: this.c.dim, baseline: 'middle',
                    });
                    ctx.globalAlpha = 1;
                }
            }
        };

        drawBars(rotA, margin.left, this.c.teamA, nameA, 'left');
        drawBars(rotB, mid + gap / 2, this.c.teamB, nameB, 'right');

        // Team rates at bottom
        const rateY = h - margin.bottom + 16;
        const rateSize = Math.min(w * 0.015, 11);
        ctx.globalAlpha = easeOutCubic(Math.max(0, (t - 0.4) / 0.6));

        const fmtPct = v => (v * 100).toFixed(1) + '%';
        drawText(ctx, `Pace: ${profileA.possessions_per_game.toFixed(0)}  TO%: ${fmtPct(profileA.team_turnover_rate)}  OREB%: ${fmtPct(profileA.off_reb_rate)}  Foul: ${fmtPct(profileA.foul_rate)}`, w * 0.25, rateY, {
            size: rateSize, color: this.c.dim, align: 'center', font: 'monospace',
        });
        drawText(ctx, `Pace: ${profileB.possessions_per_game.toFixed(0)}  TO%: ${fmtPct(profileB.team_turnover_rate)}  OREB%: ${fmtPct(profileB.off_reb_rate)}  Foul: ${fmtPct(profileB.foul_rate)}`, w * 0.75, rateY, {
            size: rateSize, color: this.c.dim, align: 'center', font: 'monospace',
        });

        ctx.globalAlpha = 1;
    }

    getTooltip(mx, my) {
        if (!this._barRects) return null;
        for (const r of this._barRects) {
            if (mx >= r.x && mx <= r.x + r.w + 60 && my >= r.y && my <= r.y + r.h) {
                const p = r.player;
                return {
                    x: mx, y: my,
                    lines: [
                        `${p.name} (${r.team})`,
                        `Usage: ${(p.usage_rate * 100).toFixed(1)}%`,
                        `2PT: ${(p.two_pct * 100).toFixed(1)}%  |  3PT: ${(p.three_pct * 100).toFixed(1)}%`,
                        `FT: ${(p.ft_pct * 100).toFixed(1)}%  |  3P Share: ${(p.three_share * 100).toFixed(0)}%`,
                        `Foul Draw: ${(p.foul_draw_rate * 100).toFixed(1)}%  |  TO: ${(p.turnover_rate * 100).toFixed(1)}%`,
                    ],
                };
            }
        }
        return null;
    }
}

// ── Scene 3: Pace Sampling ──

export class PaceSamplingScene {
    constructor(data, colors) {
        this.duration = 4;
        this.data = data;
        this.c = colors;
        this.t = 0;
    }

    update(t) { this.t = t; }

    draw(ctx, w, h) {
        const { profileA, profileB, sampledPace } = this.data;
        const t = Math.min(this.t / this.duration, 1);
        const PACE_STD = 3.0;

        const expected = (profileA.possessions_per_game + profileB.possessions_per_game) / 2;
        const xMin = expected - 4 * PACE_STD;
        const xMax = expected + 4 * PACE_STD;

        const margin = { top: h * 0.12, bottom: h * 0.14, left: w * 0.1, right: w * 0.08 };
        const plotW = w - margin.left - margin.right;
        const plotH = h - margin.top - margin.bottom;

        // Title
        drawText(ctx, 'Pace Sampling', w / 2, margin.top - 20, {
            size: Math.min(w * 0.03, 18), weight: 'bold', color: this.c.text, align: 'center', baseline: 'bottom',
        });

        // Axes
        ctx.strokeStyle = this.c.dim;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top + plotH);
        ctx.lineTo(margin.left + plotW, margin.top + plotH);
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, margin.top + plotH);
        ctx.stroke();

        // Axis labels
        drawText(ctx, 'Possessions per Team', w / 2, h - 10, {
            size: 11, color: this.c.dim, align: 'center', baseline: 'bottom',
        });

        // Tick labels
        const nTicks = 5;
        for (let i = 0; i <= nTicks; i++) {
            const val = xMin + (xMax - xMin) * i / nTicks;
            const px = margin.left + plotW * i / nTicks;
            drawText(ctx, val.toFixed(0), px, margin.top + plotH + 8, {
                size: 10, color: this.c.dim, align: 'center',
            });
        }

        // Compute curve points
        const nPts = 200;
        const yMax = normalPdf(expected, expected, PACE_STD) * 1.2;
        const toCanvasX = (v) => margin.left + (v - xMin) / (xMax - xMin) * plotW;
        const toCanvasY = (v) => margin.top + plotH - (v / yMax) * plotH;

        // How much of the curve to show
        let curveFrac;
        if (t < 0.25) {
            curveFrac = t / 0.25;
        } else {
            curveFrac = 1;
        }

        const showPts = Math.floor(curveFrac * nPts);

        // Draw filled curve
        if (showPts > 1) {
            ctx.beginPath();
            ctx.moveTo(toCanvasX(xMin), margin.top + plotH);
            for (let i = 0; i < showPts; i++) {
                const xVal = xMin + (xMax - xMin) * i / (nPts - 1);
                const yVal = normalPdf(xVal, expected, PACE_STD);
                ctx.lineTo(toCanvasX(xVal), toCanvasY(yVal));
            }
            const lastX = xMin + (xMax - xMin) * (showPts - 1) / (nPts - 1);
            ctx.lineTo(toCanvasX(lastX), margin.top + plotH);
            ctx.closePath();
            ctx.fillStyle = this.c.teamA + '40';
            ctx.fill();

            // Outline
            ctx.beginPath();
            for (let i = 0; i < showPts; i++) {
                const xVal = xMin + (xMax - xMin) * i / (nPts - 1);
                const yVal = normalPdf(xVal, expected, PACE_STD);
                if (i === 0) ctx.moveTo(toCanvasX(xVal), toCanvasY(yVal));
                else ctx.lineTo(toCanvasX(xVal), toCanvasY(yVal));
            }
            ctx.strokeStyle = this.c.teamA;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Sample line drop (0.25-0.5 of duration)
        if (t >= 0.25) {
            const sampleCX = toCanvasX(sampledPace);
            const samplePdf = normalPdf(sampledPace, expected, PACE_STD);
            const sampleCY = toCanvasY(samplePdf);
            const baseY = margin.top + plotH;

            if (t < 0.5) {
                const dropFrac = (t - 0.25) / 0.25;
                const topY = toCanvasY(yMax * 0.95);
                const currentY = topY + (baseY - topY) * easeOutCubic(dropFrac);
                ctx.strokeStyle = this.c.orange;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(sampleCX, currentY);
                ctx.lineTo(sampleCX, baseY);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(sampleCX, baseY, 5, 0, Math.PI * 2);
                ctx.fillStyle = this.c.orange;
                ctx.fill();
            } else {
                // Hold with annotation
                ctx.strokeStyle = this.c.orange;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(sampleCX, sampleCY);
                ctx.lineTo(sampleCX, baseY);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(sampleCX, baseY, 5, 0, Math.PI * 2);
                ctx.fillStyle = this.c.orange;
                ctx.fill();

                // Annotation
                const annotAlpha = easeOutCubic(Math.min((t - 0.5) / 0.2, 1));
                ctx.globalAlpha = annotAlpha;
                drawText(ctx, `${sampledPace} possessions per team`, sampleCX + 12, sampleCY - 8, {
                    size: Math.min(w * 0.025, 14), weight: 'bold', color: this.c.orange,
                });
                ctx.globalAlpha = 1;
            }
        }
    }

    getTooltip() { return null; }
}

// ── Scene 4: Single Game Trace ──

export class SingleGameTraceScene {
    constructor(data, colors) {
        this.duration = 10;
        this.data = data;
        this.c = colors;
        this.t = 0;
        this._hoverRects = [];
    }

    update(t) { this.t = t; }

    draw(ctx, w, h) {
        const { tracedGame, nameA, nameB } = this.data;
        const trace = tracedGame.trace;
        const nPoss = trace.length;
        const t = Math.min(this.t / this.duration, 1);
        const possIdx = Math.min(Math.floor(t * nPoss), nPoss - 1);

        const margin = { top: h * 0.06, left: w * 0.06, right: w * 0.04, bottom: h * 0.04 };

        // Layout: top 60% = score chart (left 60%) + decision tree (right 40%)
        // bottom 40% = event flash (left 60%) + mini box score (right 40%)
        const splitX = w * 0.6;
        const splitY = h * 0.6;

        // ── Score progression (top-left) ──
        const chartX = margin.left;
        const chartY = margin.top + 20;
        const chartW = splitX - margin.left - 10;
        const chartH = splitY - margin.top - 30;

        // Title
        drawText(ctx, 'Score Progression', chartX + chartW / 2, margin.top, {
            size: Math.min(w * 0.022, 13), weight: 'bold', color: this.c.text, align: 'center',
        });

        // Axes
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartX, chartY + chartH);
        ctx.lineTo(chartX + chartW, chartY + chartH);
        ctx.moveTo(chartX, chartY);
        ctx.lineTo(chartX, chartY + chartH);
        ctx.stroke();

        const maxScore = Math.max(tracedGame.scoreA, tracedGame.scoreB, 20) + 5;
        this._scoreChartRects = { x: chartX, y: chartY, w: chartW, h: chartH, nPoss, maxScore, trace };

        // Draw score lines
        if (possIdx > 0) {
            const drawLine = (getScore, color) => {
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                for (let i = 0; i <= possIdx; i++) {
                    const px = chartX + (i / nPoss) * chartW;
                    const py = chartY + chartH - (getScore(i) / maxScore) * chartH;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.stroke();
            };

            drawLine(i => trace[i].scoreA, this.c.teamA);
            drawLine(i => trace[i].scoreB, this.c.teamB);
        }

        // Legend
        const current = trace[possIdx];
        const legY = chartY + 10;
        ctx.fillStyle = this.c.teamA;
        ctx.fillRect(chartX + 10, legY, 12, 3);
        drawText(ctx, `${nameA}: ${current.scoreA}`, chartX + 26, legY - 3, { size: 10, color: this.c.teamA });

        ctx.fillStyle = this.c.teamB;
        ctx.fillRect(chartX + 10, legY + 16, 12, 3);
        drawText(ctx, `${nameB}: ${current.scoreB}`, chartX + 26, legY + 13, { size: 10, color: this.c.teamB });

        // ── Decision tree (top-right) ──
        const treeX = splitX + 5;
        const treeY = margin.top + 20;
        const treeW = w - splitX - margin.right - 5;
        const treeH = splitY - margin.top - 30;

        drawText(ctx, 'Decision Path', treeX + treeW / 2, margin.top, {
            size: Math.min(w * 0.022, 13), weight: 'bold', color: this.c.text, align: 'center',
        });

        const path = outcomePath(current.outcome);
        drawDecisionTree(ctx, treeX, treeY, treeW, treeH, path);

        // ── Event flash (bottom-left) ──
        const evY = splitY + 10;
        const evH = h - splitY - margin.bottom - 10;
        const teamLabel = current.team === 'A' ? nameA : nameB;
        const teamColor = current.team === 'A' ? this.c.teamA : this.c.teamB;
        const outcomeNames = {
            turnover: 'Turnover', foul: 'Free Throws',
            made3: 'Made 3-Pointer', made2: 'Made 2-Pointer',
            miss3: 'Missed 3-Pointer', miss2: 'Missed Shot',
        };

        drawText(ctx, `${teamLabel}:  ${current.player}  \u2014  ${outcomeNames[current.outcome] || current.outcome}`, chartX + chartW / 2, evY + evH * 0.3, {
            size: Math.min(w * 0.022, 14), weight: 'bold', color: teamColor, align: 'center', baseline: 'middle',
        });

        const ptsText = current.points > 0 ? `+${current.points}` : 'No score';
        const ptsColor = current.points > 0 ? this.c.green : this.c.dim;
        drawText(ctx, ptsText, chartX + chartW / 2, evY + evH * 0.65, {
            size: Math.min(w * 0.035, 22), weight: 'bold', color: ptsColor, align: 'center', baseline: 'middle',
        });

        // ── Mini box score (bottom-right) ──
        const boxX = splitX + 10;
        const boxY = splitY + 10;
        const boxW = w - splitX - margin.right - 10;

        // Build running box scores up to current possession
        const runBoxA = {};
        const runBoxB = {};
        for (let i = 0; i <= possIdx; i++) {
            const p = trace[i];
            const box = p.team === 'A' ? runBoxA : runBoxB;
            if (!box[p.player]) box[p.player] = 0;
            box[p.player] += p.points;
        }

        const sortedA = Object.entries(runBoxA).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const sortedB = Object.entries(runBoxB).sort((a, b) => b[1] - a[1]).slice(0, 3);

        let by = boxY;
        drawText(ctx, `\u2014 ${nameA} \u2014`, boxX + boxW / 2, by, { size: 10, weight: 'bold', color: this.c.teamA, align: 'center' });
        by += 16;
        for (const [name, pts] of sortedA) {
            drawText(ctx, `${name.slice(0, 14)}`, boxX, by, { size: 9, color: this.c.text, font: 'monospace' });
            drawText(ctx, `${pts} pts`, boxX + boxW - 5, by, { size: 9, color: this.c.text, align: 'right', font: 'monospace' });
            by += 14;
        }
        by += 8;
        drawText(ctx, `\u2014 ${nameB} \u2014`, boxX + boxW / 2, by, { size: 10, weight: 'bold', color: this.c.teamB, align: 'center' });
        by += 16;
        for (const [name, pts] of sortedB) {
            drawText(ctx, `${name.slice(0, 14)}`, boxX, by, { size: 9, color: this.c.text, font: 'monospace' });
            drawText(ctx, `${pts} pts`, boxX + boxW - 5, by, { size: 9, color: this.c.text, align: 'right', font: 'monospace' });
            by += 14;
        }
    }

    getTooltip(mx, my) {
        const c = this._scoreChartRects;
        if (!c) return null;
        if (mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h) {
            const idx = Math.min(Math.floor((mx - c.x) / c.w * c.nPoss), c.nPoss - 1);
            if (idx >= 0 && idx < c.trace.length) {
                const p = c.trace[idx];
                return {
                    x: mx, y: my,
                    lines: [`Possession ${idx + 1}`, `Score: ${p.scoreA} - ${p.scoreB}`],
                };
            }
        }
        return null;
    }
}

// ── Scene 5: Monte Carlo ──

export class MonteCarloScene {
    constructor(data, colors) {
        this.duration = 8;
        this.data = data;
        this.c = colors;
        this.t = 0;
        this._histRects = [];
    }

    update(t) { this.t = t; }

    draw(ctx, w, h) {
        const { simResults, nameA, nameB } = this.data;
        const { scoresA, scoresB, convergence } = simResults;
        const t = Math.min(this.t / this.duration, 1);

        const milestones = convergence.map(c => c.n);
        const nMilestones = milestones.length;
        const miIdx = Math.min(Math.floor(t * nMilestones), nMilestones - 1);
        const m = milestones[miIdx];
        const wp = convergence[miIdx].winProb;

        // Compute diffs for current milestone
        const diffsAll = [];
        for (let i = 0; i < m; i++) diffsAll.push(scoresA[i] - scoresB[i]);

        // ── Layout ──
        const margin = { top: h * 0.08, bottom: h * 0.04, left: w * 0.08, right: w * 0.04 };
        const histH = h * 0.48;
        const convH = h * 0.22;
        const infoW = w * 0.25;
        const histW = w - margin.left - margin.right - infoW - 20;

        // ── Histogram ──
        const histX = margin.left;
        const histY = margin.top + 20;

        drawText(ctx, `Score Differential (${nameA} - ${nameB})  |  n=${m.toLocaleString()}`, histX + histW / 2, margin.top, {
            size: Math.min(w * 0.02, 13), weight: 'bold', color: this.c.text, align: 'center',
        });

        // Bin the diffs
        const dMin = Math.min(...diffsAll) - 3;
        const dMax = Math.max(...diffsAll) + 3;
        const binSize = 2;
        const nBins = Math.ceil((dMax - dMin) / binSize);
        const bins = new Array(nBins).fill(0);
        for (const d of diffsAll) {
            const bi = Math.min(Math.floor((d - dMin) / binSize), nBins - 1);
            if (bi >= 0) bins[bi]++;
        }
        const maxBin = Math.max(...bins, 1);

        this._histRects = [];
        const barW = histW / nBins;
        for (let i = 0; i < nBins; i++) {
            const bh = (bins[i] / maxBin) * (histH - 30);
            const bx = histX + i * barW;
            const by = histY + histH - bh;
            drawRoundedRect(ctx, bx + 1, by, barW - 2, bh, 1);
            ctx.fillStyle = this.c.teamA + 'cc';
            ctx.fill();

            this._histRects.push({
                x: bx, y: by, w: barW, h: bh,
                range: `${(dMin + i * binSize).toFixed(0)} to ${(dMin + (i + 1) * binSize).toFixed(0)}`,
                count: bins[i],
            });
        }

        // Zero line
        const zeroX = histX + ((0 - dMin) / (dMax - dMin)) * histW;
        if (zeroX > histX && zeroX < histX + histW) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = this.c.teamB;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(zeroX, histY);
            ctx.lineTo(zeroX, histY + histH);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Mean line
        const meanDiff = diffsAll.reduce((a, b) => a + b, 0) / diffsAll.length;
        const meanX = histX + ((meanDiff - dMin) / (dMax - dMin)) * histW;
        if (meanX > histX && meanX < histX + histW) {
            ctx.strokeStyle = this.c.orange;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(meanX, histY);
            ctx.lineTo(meanX, histY + histH);
            ctx.stroke();
        }

        // X axis
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(histX, histY + histH);
        ctx.lineTo(histX + histW, histY + histH);
        ctx.stroke();

        // ── Info panel (right) ──
        const infoX = histX + histW + 20;
        const infoY = histY;

        drawText(ctx, 'Win Probability', infoX + infoW / 2, infoY, {
            size: 12, weight: 'bold', color: this.c.text, align: 'center',
        });

        // Win prob bar
        const barY = infoY + 22;
        const fullBarW = infoW;
        drawRoundedRect(ctx, infoX, barY, fullBarW * wp, 14, 3);
        ctx.fillStyle = this.c.teamA;
        ctx.fill();
        drawRoundedRect(ctx, infoX + fullBarW * wp, barY, fullBarW * (1 - wp), 14, 3);
        ctx.fillStyle = this.c.teamB;
        ctx.fill();

        drawText(ctx, `${nameA}: ${(wp * 100).toFixed(1)}%`, infoX + infoW / 2, barY + 28, {
            size: 13, weight: 'bold', color: this.c.teamA, align: 'center',
        });
        drawText(ctx, `${nameB}: ${((1 - wp) * 100).toFixed(1)}%`, infoX + infoW / 2, barY + 46, {
            size: 13, weight: 'bold', color: this.c.teamB, align: 'center',
        });

        // Avg score
        const meanA = scoresA.slice(0, m).reduce((a, b) => a + b, 0) / m;
        const meanB = scoresB.slice(0, m).reduce((a, b) => a + b, 0) / m;
        drawText(ctx, 'Avg Score', infoX + infoW / 2, barY + 76, {
            size: 11, weight: 'bold', color: this.c.text, align: 'center',
        });
        drawText(ctx, `${nameA}: ${meanA.toFixed(1)}`, infoX + infoW / 2, barY + 94, {
            size: 12, color: this.c.teamA, align: 'center',
        });
        drawText(ctx, `${nameB}: ${meanB.toFixed(1)}`, infoX + infoW / 2, barY + 112, {
            size: 12, color: this.c.teamB, align: 'center',
        });

        // ── Convergence trace (bottom) ──
        const convX = margin.left;
        const convY = histY + histH + 30;
        const convW = w - margin.left - margin.right;

        drawText(ctx, 'Win Probability Convergence', convX + convW / 2, convY - 6, {
            size: Math.min(w * 0.02, 13), weight: 'bold', color: this.c.text, align: 'center', baseline: 'bottom',
        });

        // Axes
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(convX, convY + convH);
        ctx.lineTo(convX + convW, convY + convH);
        ctx.moveTo(convX, convY);
        ctx.lineTo(convX, convY + convH);
        ctx.stroke();

        // 50% dashed line
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#ddd';
        ctx.beginPath();
        const halfY = convY + convH / 2;
        ctx.moveTo(convX, halfY);
        ctx.lineTo(convX + convW, halfY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Labels
        drawText(ctx, '0%', convX - 6, convY + convH, { size: 9, color: this.c.dim, align: 'right', baseline: 'middle' });
        drawText(ctx, '50%', convX - 6, halfY, { size: 9, color: this.c.dim, align: 'right', baseline: 'middle' });
        drawText(ctx, '100%', convX - 6, convY, { size: 9, color: this.c.dim, align: 'right', baseline: 'middle' });

        // Draw convergence line (log scale)
        const maxN = milestones[milestones.length - 1];
        const logMax = Math.log10(maxN);
        const nPts = miIdx + 1;

        ctx.beginPath();
        ctx.strokeStyle = this.c.green;
        ctx.lineWidth = 2;
        for (let i = 0; i < nPts; i++) {
            const px = convX + (Math.log10(convergence[i].n) / logMax) * convW;
            const py = convY + convH - convergence[i].winProb * convH;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Dots
        for (let i = 0; i < nPts; i++) {
            const px = convX + (Math.log10(convergence[i].n) / logMax) * convW;
            const py = convY + convH - convergence[i].winProb * convH;
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = this.c.green;
            ctx.fill();
        }
    }

    getTooltip(mx, my) {
        for (const r of this._histRects) {
            if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
                return {
                    x: mx, y: my,
                    lines: [`Range: ${r.range}`, `Count: ${r.count}`],
                };
            }
        }
        return null;
    }
}

// ── Scene 6: Final Results ──

export class FinalResultsScene {
    constructor(data, colors) {
        this.duration = 5;
        this.data = data;
        this.c = colors;
        this.t = 0;
        this._boxRects = [];
    }

    update(t) { this.t = t; }

    draw(ctx, w, h) {
        const { simResults, nameA, nameB } = this.data;
        const { meanA, meanB, ci90A, ci90B, winProbA, boxA, boxB, scoresA, scoresB } = simResults;
        const t = Math.min(this.t / this.duration, 1);
        const countUp = easeOutCubic(Math.min(t * 2.5, 1));

        const margin = { top: h * 0.06, left: w * 0.04, right: w * 0.04 };

        // ── Top: Predicted Scores ──
        const topH = h * 0.3;
        const col3W = (w - margin.left - margin.right) / 3;

        // Scores (left)
        const scX = margin.left + col3W * 0.5;
        drawText(ctx, 'Predicted Score', scX, margin.top, {
            size: Math.min(w * 0.025, 14), weight: 'bold', color: this.c.text, align: 'center',
        });
        const displayA = (meanA * countUp).toFixed(1);
        const displayB = (meanB * countUp).toFixed(1);
        drawText(ctx, `${nameA}:  ${displayA}`, scX, margin.top + 36, {
            size: Math.min(w * 0.03, 18), weight: 'bold', color: this.c.teamA, align: 'center',
        });
        drawText(ctx, `90% CI: ${ci90A[0]} \u2013 ${ci90A[1]}`, scX, margin.top + 58, {
            size: 10, color: this.c.dim, align: 'center',
        });
        drawText(ctx, `${nameB}:  ${displayB}`, scX, margin.top + 86, {
            size: Math.min(w * 0.03, 18), weight: 'bold', color: this.c.teamB, align: 'center',
        });
        drawText(ctx, `90% CI: ${ci90B[0]} \u2013 ${ci90B[1]}`, scX, margin.top + 108, {
            size: 10, color: this.c.dim, align: 'center',
        });

        // Win Probability bar (center)
        const wpX = margin.left + col3W;
        const wpCX = wpX + col3W / 2;
        drawText(ctx, 'Win Probability', wpCX, margin.top, {
            size: Math.min(w * 0.025, 14), weight: 'bold', color: this.c.text, align: 'center',
        });

        const barW = col3W * 0.9;
        const barX = wpCX - barW / 2;
        const barY = margin.top + 34;
        const wpA = winProbA * countUp;
        const wpB = (1 - winProbA) * countUp;

        drawRoundedRect(ctx, barX, barY, barW * wpA, 24, 4);
        ctx.fillStyle = this.c.teamA;
        ctx.fill();
        drawRoundedRect(ctx, barX + barW * wpA, barY, barW * wpB, 24, 4);
        ctx.fillStyle = this.c.teamB;
        ctx.fill();

        if (countUp > 0.5) {
            ctx.globalAlpha = Math.min((countUp - 0.5) / 0.5, 1);
            drawText(ctx, `${(winProbA * 100).toFixed(1)}%`, barX + barW * wpA / 2, barY + 12, {
                size: 13, weight: 'bold', color: '#fff', align: 'center', baseline: 'middle',
            });
            drawText(ctx, `${((1 - winProbA) * 100).toFixed(1)}%`, barX + barW * wpA + barW * wpB / 2, barY + 12, {
                size: 13, weight: 'bold', color: '#fff', align: 'center', baseline: 'middle',
            });
            ctx.globalAlpha = 1;
        }

        // Score diff distribution (right)
        const distX = margin.left + col3W * 2 + 10;
        const distW = col3W - 20;
        const distY = margin.top + 20;
        const distH = topH - 40;

        drawText(ctx, 'Score Differential', distX + distW / 2, margin.top, {
            size: Math.min(w * 0.02, 12), weight: 'bold', color: this.c.text, align: 'center',
        });

        // Mini histogram
        const diffs = scoresA.map((a, i) => a - scoresB[i]);
        const dMin = Math.min(...diffs);
        const dMax = Math.max(...diffs);
        const nBins = 20;
        const binSz = (dMax - dMin) / nBins || 1;
        const bins = new Array(nBins).fill(0);
        for (const d of diffs) {
            const bi = Math.min(Math.floor((d - dMin) / binSz), nBins - 1);
            if (bi >= 0) bins[bi]++;
        }
        const maxBin = Math.max(...bins, 1);
        const miniBarW = distW / nBins;

        for (let i = 0; i < nBins; i++) {
            const bh = (bins[i] / maxBin) * (distH - 10);
            ctx.fillStyle = this.c.teamA + 'aa';
            ctx.fillRect(distX + i * miniBarW + 1, distY + distH - bh, miniBarW - 2, bh);
        }

        // Zero line
        const zeroFrac = (0 - dMin) / (dMax - dMin);
        if (zeroFrac > 0 && zeroFrac < 1) {
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = this.c.teamB;
            ctx.lineWidth = 1;
            ctx.beginPath();
            const zx = distX + zeroFrac * distW;
            ctx.moveTo(zx, distY);
            ctx.lineTo(zx, distY + distH);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // ── Bottom: Projected Box Scores ──
        const boxTop = margin.top + topH + 10;
        this._boxRects = [];

        const drawBox = (box, teamName, teamColor, startX, boxW) => {
            drawText(ctx, `${teamName} \u2014 Projected Averages`, startX + boxW / 2, boxTop, {
                size: Math.min(w * 0.02, 12), weight: 'bold', color: teamColor, align: 'center',
            });

            // Header
            const colPositions = [0, 0.45, 0.58, 0.71, 0.84];
            const colLabels = ['Player', 'PPG', 'FG%', '3P%', 'FT%'];
            const headerY = boxTop + 20;
            for (let c = 0; c < colLabels.length; c++) {
                drawText(ctx, colLabels[c], startX + colPositions[c] * boxW, headerY, {
                    size: 9, weight: 'bold', color: this.c.dim, align: c === 0 ? 'left' : 'right',
                    font: 'monospace',
                });
            }

            // Separator
            ctx.strokeStyle = '#ddd';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(startX, headerY + 14);
            ctx.lineTo(startX + boxW, headerY + 14);
            ctx.stroke();

            // Rows
            const top6 = box.slice(0, 6);
            for (let i = 0; i < top6.length; i++) {
                const p = top6[i];
                const ry = headerY + 18 + i * 18;

                // Alternating background
                if (i % 2 === 0) {
                    ctx.fillStyle = this.c.surface + '80';
                    ctx.fillRect(startX - 2, ry - 2, boxW + 4, 18);
                }

                drawText(ctx, p.name.length > 16 ? p.name.slice(0, 15) + '...' : p.name, startX + colPositions[0] * boxW, ry, {
                    size: 10, color: this.c.text, font: 'monospace',
                });
                drawText(ctx, p.ppg.toFixed(1), startX + colPositions[1] * boxW, ry, {
                    size: 10, color: this.c.text, align: 'right', font: 'monospace',
                });
                drawText(ctx, (p.fg_pct * 100).toFixed(0) + '%', startX + colPositions[2] * boxW, ry, {
                    size: 10, color: this.c.text, align: 'right', font: 'monospace',
                });
                drawText(ctx, (p.tp_pct * 100).toFixed(0) + '%', startX + colPositions[3] * boxW, ry, {
                    size: 10, color: this.c.text, align: 'right', font: 'monospace',
                });
                drawText(ctx, (p.ft_pct * 100).toFixed(0) + '%', startX + colPositions[4] * boxW, ry, {
                    size: 10, color: this.c.text, align: 'right', font: 'monospace',
                });

                this._boxRects.push({
                    x: startX - 2, y: ry - 2, w: boxW + 4, h: 18,
                    player: p, team: teamName,
                });
            }
        };

        const halfW = (w - margin.left - margin.right - 20) / 2;
        drawBox(boxA, nameA, this.c.teamA, margin.left, halfW);
        drawBox(boxB, nameB, this.c.teamB, margin.left + halfW + 20, halfW);
    }

    getTooltip(mx, my) {
        for (const r of this._boxRects) {
            if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
                const p = r.player;
                return {
                    x: mx, y: my,
                    lines: [
                        `${p.name} (${r.team})`,
                        `PPG: ${p.ppg.toFixed(1)}  |  FG: ${(p.fg_pct * 100).toFixed(1)}%`,
                        `3PT: ${(p.tp_pct * 100).toFixed(1)}%  |  FT: ${(p.ft_pct * 100).toFixed(1)}%`,
                        `TO: ${p.to.toFixed(1)}`,
                    ],
                };
            }
        }
        return null;
    }
}
