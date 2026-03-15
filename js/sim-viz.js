/**
 * Interactive simulation visualization controller.
 * Renders a 6-scene animated canvas walkthrough of the Monte Carlo prediction engine.
 */

import { loadSimProfiles, getProfile, simulateGame, samplePossessions } from './simulate.js';
import {
    TitleCardScene, TeamProfilesScene, PaceSamplingScene,
    SingleGameTraceScene, MonteCarloScene, FinalResultsScene,
} from './sim-viz-scenes.js';

const SCENE_LABELS = ['Title', 'Profiles', 'Pace', 'Game', 'Monte Carlo', 'Results'];
const CROSSFADE_DURATION = 0.3;
const N_SIMS = 1000;
const BATCH_SIZE = 50;

// ── Controller ──

class SimVizController {
    constructor(container) {
        this.container = container;
        this.scenes = [];
        this.currentScene = 0;
        this.sceneElapsed = 0;
        this.playing = true;
        this.transitioning = false;
        this.transitionAlpha = 0;
        this.rafId = null;
        this.lastTimestamp = null;
        this.colors = {};

        this._buildDOM();
        this._readColors();
    }

    _buildDOM() {
        this.container.innerHTML = '';

        // Loading state
        this.loadingEl = document.createElement('div');
        this.loadingEl.className = 'sim-viz-loading';
        this.loadingEl.innerHTML = `
            <div class="sim-spinner"></div>
            <span>Preparing simulation...</span>
            <div class="progress-bar" style="width:200px;margin-top:8px">
                <div class="progress-fill sim-viz-progress-fill" style="width:0%"></div>
            </div>
        `;
        this.container.appendChild(this.loadingEl);

        // Canvas wrap
        this.canvasWrap = document.createElement('div');
        this.canvasWrap.className = 'sim-viz-canvas-wrap';
        this.canvasWrap.style.display = 'none';

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'sim-viz-canvas';
        this.canvasWrap.appendChild(this.canvas);

        // Tooltip
        this.tooltipEl = document.createElement('div');
        this.tooltipEl.className = 'sim-viz-tooltip';
        this.canvasWrap.appendChild(this.tooltipEl);

        this.container.appendChild(this.canvasWrap);

        // Controls
        this.controlsEl = document.createElement('div');
        this.controlsEl.className = 'sim-viz-controls';
        this.controlsEl.style.display = 'none';
        this.container.appendChild(this.controlsEl);

        // Progress bar
        this.progressBar = document.createElement('div');
        this.progressBar.className = 'sim-viz-progress';
        this.progressBar.innerHTML = '<div class="sim-viz-progress-inner"></div>';
        this.progressBar.style.display = 'none';
        this.container.appendChild(this.progressBar);

        // Hover handler
        this.canvas.addEventListener('mousemove', (e) => this._onHover(e));
        this.canvas.addEventListener('mouseleave', () => this._hideTooltip());
    }

    _readColors() {
        const s = getComputedStyle(document.documentElement);
        this.colors = {
            teamA: s.getPropertyValue('--blue').trim() || '#1d3557',
            teamB: s.getPropertyValue('--red').trim() || '#c1121f',
            green: s.getPropertyValue('--green').trim() || '#2d6a4f',
            orange: s.getPropertyValue('--orange').trim() || '#e76f51',
            text: s.getPropertyValue('--text').trim() || '#1a1a1a',
            dim: s.getPropertyValue('--text-dim').trim() || '#666666',
            surface: s.getPropertyValue('--surface').trim() || '#f5f5f5',
            bg: s.getPropertyValue('--bg').trim() || '#ffffff',
        };
    }

    async start(teamAId, teamBId) {
        // Show loading
        this.loadingEl.style.display = '';
        this.canvasWrap.style.display = 'none';
        this.controlsEl.style.display = 'none';
        this.progressBar.style.display = 'none';

        const data = await loadSimProfiles();
        const profileA = getProfile(teamAId);
        const profileB = getProfile(teamBId);

        if (!profileA || !profileB) {
            this.loadingEl.innerHTML = '<span>Simulation data unavailable for this matchup</span>';
            return;
        }

        const nameA = profileA.name;
        const nameB = profileB.name;
        const leagueAvg = data.league_avg_eff || 100;

        // Run 1 traced game
        const tracedGame = simulateGame(profileA, profileB, leagueAvg, true);

        // Sample pace for scene 3
        const sampledPace = samplePossessions(profileA, profileB);

        // Batch 1000 sims
        const scoresA = [];
        const scoresB = [];
        const aggBoxA = {};
        const aggBoxB = {};

        const progressFill = this.loadingEl.querySelector('.sim-viz-progress-fill');

        const addBox = (agg, box) => {
            for (const [name, s] of Object.entries(box)) {
                if (!agg[name]) agg[name] = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, to: 0 };
                const a = agg[name];
                a.pts += s.pts; a.fgm += s.fgm; a.fga += s.fga;
                a.tpm += s.tpm; a.tpa += s.tpa; a.ftm += s.ftm; a.fta += s.fta; a.to += s.to;
            }
        };

        await new Promise((resolve) => {
            let done = 0;
            const runBatch = () => {
                const end = Math.min(done + BATCH_SIZE, N_SIMS);
                for (let i = done; i < end; i++) {
                    const result = simulateGame(profileA, profileB, leagueAvg, false);
                    scoresA.push(result.scoreA);
                    scoresB.push(result.scoreB);
                    addBox(aggBoxA, result.boxA);
                    addBox(aggBoxB, result.boxB);
                }
                done = end;
                if (progressFill) progressFill.style.width = `${(done / N_SIMS * 100).toFixed(0)}%`;
                if (done < N_SIMS) {
                    setTimeout(runBatch, 0);
                } else {
                    resolve();
                }
            };
            runBatch();
        });

        // Compute stats
        const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
        const sorted = arr => arr.slice().sort((a, b) => a - b);
        const percentile = (arr, p) => {
            const s = sorted(arr);
            const idx = Math.floor(s.length * p / 100);
            return s[Math.min(idx, s.length - 1)];
        };

        const winsA = scoresA.filter((s, i) => s > scoresB[i]).length;

        const formatBox = (agg) => {
            const result = [];
            for (const [name, s] of Object.entries(agg)) {
                result.push({
                    name,
                    ppg: s.pts / N_SIMS,
                    fg_pct: s.fga > 0 ? s.fgm / s.fga : 0,
                    tp_pct: s.tpa > 0 ? s.tpm / s.tpa : 0,
                    ft_pct: s.fta > 0 ? s.ftm / s.fta : 0,
                    to: s.to / N_SIMS,
                });
            }
            result.sort((a, b) => b.ppg - a.ppg);
            return result;
        };

        // Convergence milestones
        const milestones = [1, 5, 10, 25, 50, 100, 250, 500, 1000].filter(m => m <= N_SIMS);
        if (milestones[milestones.length - 1] < N_SIMS) milestones.push(N_SIMS);
        const convergence = milestones.map(m => ({
            n: m,
            winProb: scoresA.slice(0, m).filter((s, i) => s > scoresB[i]).length / m,
        }));

        const simResults = {
            meanA: mean(scoresA),
            meanB: mean(scoresB),
            winProbA: winsA / N_SIMS,
            ci90A: [percentile(scoresA, 5), percentile(scoresA, 95)],
            ci90B: [percentile(scoresB, 5), percentile(scoresB, 95)],
            boxA: formatBox(aggBoxA),
            boxB: formatBox(aggBoxB),
            scoresA,
            scoresB,
            convergence,
        };

        const sceneData = {
            nameA, nameB, profileA, profileB, nSims: N_SIMS,
            tracedGame, sampledPace, simResults,
        };

        // Build scenes
        this.scenes = [
            new TitleCardScene(sceneData, this.colors),
            new TeamProfilesScene(sceneData, this.colors),
            new PaceSamplingScene(sceneData, this.colors),
            new SingleGameTraceScene(sceneData, this.colors),
            new MonteCarloScene(sceneData, this.colors),
            new FinalResultsScene(sceneData, this.colors),
        ];

        // Show canvas, build controls
        this.loadingEl.style.display = 'none';
        this.canvasWrap.style.display = '';
        this.controlsEl.style.display = '';
        this.progressBar.style.display = '';

        this._buildControls();
        this._setupResize();

        this.currentScene = 0;
        this.sceneElapsed = 0;
        this.playing = true;
        this.lastTimestamp = null;
        this.resize();
        this._loop();
    }

    _buildControls() {
        let html = `<button class="sim-viz-play-btn" aria-label="Play/Pause">&#9646;&#9646;</button>`;
        html += '<div class="sim-viz-dots">';
        for (let i = 0; i < this.scenes.length; i++) {
            html += `<button class="sim-viz-scene-dot ${i === 0 ? 'active' : ''}" data-idx="${i}" title="${SCENE_LABELS[i]}"></button>`;
        }
        html += '</div>';
        html += `<span class="sim-viz-scene-label">${SCENE_LABELS[0]}</span>`;
        this.controlsEl.innerHTML = html;

        this.playBtn = this.controlsEl.querySelector('.sim-viz-play-btn');
        this.playBtn.addEventListener('click', () => {
            if (this.playing) this.pause();
            else this.resume();
        });

        this.controlsEl.querySelectorAll('.sim-viz-scene-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                this.skipTo(parseInt(dot.dataset.idx));
            });
        });
    }

    _setupResize() {
        if (this._resizeObserver) this._resizeObserver.disconnect();
        this._resizeObserver = new ResizeObserver(() => this.resize());
        this._resizeObserver.observe(this.canvasWrap);
    }

    resize() {
        const rect = this.canvasWrap.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const cw = rect.width;
        const ch = Math.min(cw * 9 / 16, 600);

        this.canvas.width = cw * dpr;
        this.canvas.height = ch * dpr;
        this.canvas.style.width = cw + 'px';
        this.canvas.style.height = ch + 'px';

        this.displayW = cw;
        this.displayH = ch;
        this.dpr = dpr;
    }

    _loop(timestamp) {
        if (!this.playing && !this.transitioning) {
            this.rafId = requestAnimationFrame((ts) => this._loop(ts));
            return;
        }

        if (this.lastTimestamp === null) this.lastTimestamp = timestamp;
        const dt = (timestamp - this.lastTimestamp) / 1000;
        this.lastTimestamp = timestamp;

        if (this.playing && dt > 0 && dt < 0.5) {
            this.sceneElapsed += dt;

            const scene = this.scenes[this.currentScene];
            if (this.sceneElapsed >= scene.duration) {
                if (this.currentScene < this.scenes.length - 1) {
                    this.currentScene++;
                    this.sceneElapsed = 0;
                    this._updateDots();
                } else {
                    // End — stay on last frame
                    this.sceneElapsed = scene.duration;
                    this.playing = false;
                    this._updatePlayBtn();
                }
            }
        }

        this._draw();
        this._updateProgress();
        this.rafId = requestAnimationFrame((ts) => this._loop(ts));
    }

    _draw() {
        const ctx = this.canvas.getContext('2d');
        const dpr = this.dpr;
        const w = this.displayW * dpr;
        const h = this.displayH * dpr;

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, this.displayW, this.displayH);
        ctx.fillStyle = this.colors.surface;
        ctx.fillRect(0, 0, this.displayW, this.displayH);

        const scene = this.scenes[this.currentScene];
        if (scene) {
            scene.update(this.sceneElapsed);
            scene.draw(ctx, this.displayW, this.displayH);
        }

        ctx.restore();
    }

    _updateProgress() {
        const inner = this.progressBar.querySelector('.sim-viz-progress-inner');
        if (!inner) return;

        let total = 0;
        let elapsed = 0;
        for (let i = 0; i < this.scenes.length; i++) {
            total += this.scenes[i].duration;
            if (i < this.currentScene) elapsed += this.scenes[i].duration;
            else if (i === this.currentScene) elapsed += Math.min(this.sceneElapsed, this.scenes[i].duration);
        }
        inner.style.width = `${(elapsed / total * 100).toFixed(1)}%`;
    }

    _updateDots() {
        this.controlsEl.querySelectorAll('.sim-viz-scene-dot').forEach((dot, i) => {
            dot.classList.toggle('active', i === this.currentScene);
        });
        const label = this.controlsEl.querySelector('.sim-viz-scene-label');
        if (label) label.textContent = SCENE_LABELS[this.currentScene] || '';
    }

    _updatePlayBtn() {
        if (!this.playBtn) return;
        this.playBtn.innerHTML = this.playing ? '&#9646;&#9646;' : '&#9654;';
    }

    pause() {
        this.playing = false;
        this._updatePlayBtn();
    }

    resume() {
        // If we're at the end, restart
        if (this.currentScene === this.scenes.length - 1 &&
            this.sceneElapsed >= this.scenes[this.currentScene].duration) {
            this.currentScene = 0;
            this.sceneElapsed = 0;
            this._updateDots();
        }
        this.playing = true;
        this.lastTimestamp = null;
        this._updatePlayBtn();
    }

    skipTo(index) {
        if (index < 0 || index >= this.scenes.length) return;
        this.currentScene = index;
        this.sceneElapsed = 0;
        this._updateDots();
        if (!this.playing) {
            this._draw();
            this._updateProgress();
        }
    }

    _onHover(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const scene = this.scenes[this.currentScene];
        if (!scene || !scene.getTooltip) {
            this._hideTooltip();
            return;
        }

        const tip = scene.getTooltip(mx, my);
        if (tip) {
            this.tooltipEl.style.display = 'block';
            this.tooltipEl.innerHTML = tip.lines.map(l => `<div>${l}</div>`).join('');

            // Position: prefer right/below cursor, but stay in bounds
            let tx = tip.x + 12;
            let ty = tip.y - 8;
            const tw = this.tooltipEl.offsetWidth;
            const th = this.tooltipEl.offsetHeight;
            if (tx + tw > this.displayW - 10) tx = tip.x - tw - 12;
            if (ty + th > this.displayH - 10) ty = this.displayH - th - 10;
            if (ty < 4) ty = 4;

            this.tooltipEl.style.left = tx + 'px';
            this.tooltipEl.style.top = ty + 'px';
        } else {
            this._hideTooltip();
        }
    }

    _hideTooltip() {
        this.tooltipEl.style.display = 'none';
    }

    destroy() {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        if (this._resizeObserver) this._resizeObserver.disconnect();
        this.container.innerHTML = '';
    }
}

// ── Public API ──

let activeController = null;

export async function renderSimViz(container, teamAId, teamBId) {
    if (activeController) activeController.destroy();
    activeController = new SimVizController(container);
    await activeController.start(teamAId, teamBId);
}

export async function initAutoSimViz() {
    const container = document.getElementById('sim-viz-container');
    if (!container) return;

    try {
        const resp = await fetch('data/upcoming.json');
        if (!resp.ok) return;
        const data = await resp.json();
        const games = data.games || [];
        if (!games.length) return;

        const game = games[0];
        await renderSimViz(container, game.home.id, game.away.id);
    } catch {
        // Silently fail — viz is optional
    }
}
