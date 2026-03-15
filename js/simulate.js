/**
 * Browser-side Monte Carlo game simulator.
 * Ported from predict_score.py — runs entirely client-side using sim_profiles.json.
 */

// ── Constants (from predict_score.py) ──
const PACE_STD = 3.0;
const MAX_FOUL_PROB = 0.30;
const STINT_LENGTH = 10;
const OT_POSSESSIONS = 5;
const DEF_ADJ_CLAMP_LO = 0.80;
const DEF_ADJ_CLAMP_HI = 1.20;
const N_SIMS_DEFAULT = 1000;

// ── Profile cache ──
let simData = null;
let loadingPromise = null;

export async function loadSimProfiles() {
    if (simData) return simData;
    if (loadingPromise) return loadingPromise;
    loadingPromise = fetch('data/sim_profiles.json')
        .then(r => { if (!r.ok) throw new Error('No sim profiles'); return r.json(); })
        .then(d => { simData = d; return d; });
    return loadingPromise;
}

export function getProfile(teamId) {
    if (!simData || !simData.teams) return null;
    return simData.teams[String(teamId)] || null;
}

// ── Random helpers (Box-Muller) ──
function randNormal(mean, std) {
    const u1 = Math.random();
    const u2 = Math.random();
    return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function weightedChoice(weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
    }
    return weights.length - 1;
}

function weightedSampleWithout(weights, k) {
    // Weighted sampling without replacement
    const n = weights.length;
    k = Math.min(k, n);
    const used = new Set();
    const result = [];
    const w = weights.slice();
    for (let pick = 0; pick < k; pick++) {
        let total = 0;
        for (let i = 0; i < n; i++) {
            if (!used.has(i)) total += w[i];
        }
        let r = Math.random() * total;
        for (let i = 0; i < n; i++) {
            if (used.has(i)) continue;
            r -= w[i];
            if (r <= 0) {
                result.push(i);
                used.add(i);
                break;
            }
        }
        if (result.length <= pick) {
            // fallback
            for (let i = 0; i < n; i++) {
                if (!used.has(i)) { result.push(i); used.add(i); break; }
            }
        }
    }
    return result;
}

// ── Simulation engine ──

export function samplePossessions(profileA, profileB) {
    const expected = (profileA.possessions_per_game + profileB.possessions_per_game) / 2;
    const perTeam = Math.round(randNormal(expected, PACE_STD));
    return Math.max(perTeam, 40);
}

function pickLineup(rotation) {
    const weights = rotation.map(p => p.minutes_share);
    const indices = weightedSampleWithout(weights, Math.min(5, rotation.length));
    return indices.map(i => rotation[i]);
}

function simulatePossession(teamOff, teamDef, lineup, leagueAvg) {
    const stats = {};
    const ensure = (name) => {
        if (!stats[name]) stats[name] = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, to: 0 };
        return stats[name];
    };

    // 1. Turnover check
    if (Math.random() < teamOff.team_turnover_rate) {
        const toWeights = lineup.map(p => p.turnover_rate);
        const idx = weightedChoice(toWeights);
        ensure(lineup[idx].name).to += 1;
        return { points: 0, stats, event: { outcome: 'turnover', player: lineup[idx].name, points: 0 } };
    }

    // Defensive adjustment
    const oppAdjD = teamDef.adj_d || leagueAvg;
    let defAdj = oppAdjD / Math.max(leagueAvg, 1);
    defAdj = Math.max(DEF_ADJ_CLAMP_LO, Math.min(defAdj, DEF_ADJ_CLAMP_HI));

    // Shot attempt loop (handles offensive rebounds)
    while (true) {
        // 2. Select shooter by usage
        const usageWeights = lineup.map(p => p.usage_rate);
        const shooterIdx = weightedChoice(usageWeights);
        const shooter = lineup[shooterIdx];
        const s = ensure(shooter.name);

        // 3. Foul drawn?
        let foulProb = shooter.foul_draw_rate * teamDef.foul_rate;
        foulProb = Math.min(foulProb, MAX_FOUL_PROB);
        if (Math.random() < foulProb) {
            let ftPts = 0;
            for (let ft = 0; ft < 2; ft++) {
                s.fta += 1;
                if (Math.random() < shooter.ft_pct) {
                    s.ftm += 1;
                    s.pts += 1;
                    ftPts += 1;
                }
            }
            return { points: ftPts, stats, event: { outcome: 'foul', player: shooter.name, points: ftPts } };
        }

        // 4. Shot type
        const threeShare = shooter.three_share;
        if (Math.random() < threeShare) {
            // Three-pointer
            s.tpa += 1;
            s.fga += 1;
            if (Math.random() < shooter.three_pct * defAdj) {
                s.tpm += 1;
                s.fgm += 1;
                s.pts += 3;
                return { points: 3, stats, event: { outcome: 'made3', player: shooter.name, points: 3 } };
            }
        } else {
            // Two-pointer
            s.fga += 1;
            if (Math.random() < shooter.two_pct * defAdj) {
                s.fgm += 1;
                s.pts += 2;
                return { points: 2, stats, event: { outcome: 'made2', player: shooter.name, points: 2 } };
            }
        }

        // 5. Miss -> offensive rebound check
        const missEvent = s.tpa > s.tpm && s.fga === s.tpa ? 'miss3' : 'miss2';
        if (Math.random() < teamOff.off_reb_rate) {
            continue; // new shot attempt
        }
        return { points: 0, stats, event: { outcome: missEvent, player: shooter.name, points: 0 } };
    }
}

export function simulateGame(profileA, profileB, leagueAvg, traceGame) {
    const nPoss = samplePossessions(profileA, profileB);
    const boxA = {};
    const boxB = {};
    let scoreA = 0;
    let scoreB = 0;
    const trace = traceGame ? [] : null;

    const mergeStats = (box, possStats) => {
        for (const [name, s] of Object.entries(possStats)) {
            if (!box[name]) box[name] = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, to: 0 };
            const b = box[name];
            b.pts += s.pts; b.fgm += s.fgm; b.fga += s.fga;
            b.tpm += s.tpm; b.tpa += s.tpa; b.ftm += s.ftm; b.fta += s.fta; b.to += s.to;
        }
    };

    const runPossessions = (teamOff, teamDef, nPoss, box, teamLabel) => {
        let total = 0;
        let lineup = pickLineup(teamOff.rotation);
        for (let i = 0; i < nPoss; i++) {
            if (i > 0 && i % STINT_LENGTH === 0) {
                lineup = pickLineup(teamOff.rotation);
            }
            const result = simulatePossession(teamOff, teamDef, lineup, leagueAvg);
            total += result.points;
            mergeStats(box, result.stats);
            if (trace) {
                trace.push({
                    team: teamLabel,
                    ...result.event,
                    scoreA: teamLabel === 'A' ? scoreA + total : scoreA,
                    scoreB: teamLabel === 'B' ? scoreB + total : scoreB,
                });
            }
        }
        return total;
    };

    // Interleave possessions for trace (A, B, A, B, ...)
    if (traceGame) {
        let lineupA = pickLineup(profileA.rotation);
        let lineupB = pickLineup(profileB.rotation);
        for (let i = 0; i < nPoss; i++) {
            if (i > 0 && i % STINT_LENGTH === 0) {
                lineupA = pickLineup(profileA.rotation);
                lineupB = pickLineup(profileB.rotation);
            }
            // Team A possession
            const resA = simulatePossession(profileA, profileB, lineupA, leagueAvg);
            scoreA += resA.points;
            mergeStats(boxA, resA.stats);
            trace.push({ team: 'A', ...resA.event, scoreA, scoreB });

            // Team B possession
            const resB = simulatePossession(profileB, profileA, lineupB, leagueAvg);
            scoreB += resB.points;
            mergeStats(boxB, resB.stats);
            trace.push({ team: 'B', ...resB.event, scoreA, scoreB });
        }
        // Overtime
        while (scoreA === scoreB) {
            for (let i = 0; i < OT_POSSESSIONS; i++) {
                const resA = simulatePossession(profileA, profileB, pickLineup(profileA.rotation), leagueAvg);
                scoreA += resA.points;
                mergeStats(boxA, resA.stats);
                trace.push({ team: 'A', ...resA.event, scoreA, scoreB });
                const resB = simulatePossession(profileB, profileA, pickLineup(profileB.rotation), leagueAvg);
                scoreB += resB.points;
                mergeStats(boxB, resB.stats);
                trace.push({ team: 'B', ...resB.event, scoreA, scoreB });
            }
        }
    } else {
        scoreA = runPossessions(profileA, profileB, nPoss, boxA, 'A');
        scoreB = runPossessions(profileB, profileA, nPoss, boxB, 'B');
        while (scoreA === scoreB) {
            scoreA += runPossessions(profileA, profileB, OT_POSSESSIONS, boxA, 'A');
            scoreB += runPossessions(profileB, profileA, OT_POSSESSIONS, boxB, 'B');
        }
    }

    return { scoreA, scoreB, boxA, boxB, trace };
}

function runSimulations(profileA, profileB, nSims) {
    const leagueAvg = simData ? simData.league_avg_eff : 100.0;
    const scoresA = [];
    const scoresB = [];
    const aggBoxA = {};
    const aggBoxB = {};

    const addBox = (agg, box) => {
        for (const [name, s] of Object.entries(box)) {
            if (!agg[name]) agg[name] = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, to: 0 };
            const a = agg[name];
            a.pts += s.pts; a.fgm += s.fgm; a.fga += s.fga;
            a.tpm += s.tpm; a.tpa += s.tpa; a.ftm += s.ftm; a.fta += s.fta; a.to += s.to;
        }
    };

    // Run all sims without tracing
    for (let i = 0; i < nSims; i++) {
        const result = simulateGame(profileA, profileB, leagueAvg, false);
        scoresA.push(result.scoreA);
        scoresB.push(result.scoreB);
        addBox(aggBoxA, result.boxA);
        addBox(aggBoxB, result.boxB);
    }

    // Run one traced game for play-by-play
    const tracedGame = simulateGame(profileA, profileB, leagueAvg, true);

    // Stats
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
                ppg: s.pts / nSims,
                fgm: s.fgm / nSims,
                fga: s.fga / nSims,
                fg_pct: s.fga > 0 ? s.fgm / s.fga : 0,
                tpm: s.tpm / nSims,
                tpa: s.tpa / nSims,
                tp_pct: s.tpa > 0 ? s.tpm / s.tpa : 0,
                ftm: s.ftm / nSims,
                fta: s.fta / nSims,
                ft_pct: s.fta > 0 ? s.ftm / s.fta : 0,
                to: s.to / nSims,
            });
        }
        result.sort((a, b) => b.ppg - a.ppg);
        return result;
    };

    return {
        nSims,
        meanA: mean(scoresA),
        meanB: mean(scoresB),
        winProbA: winsA / nSims,
        ci90A: [percentile(scoresA, 5), percentile(scoresA, 95)],
        ci90B: [percentile(scoresB, 5), percentile(scoresB, 95)],
        adjOA: profileA.adj_o, adjDA: profileA.adj_d,
        adjOB: profileB.adj_o, adjDB: profileB.adj_d,
        leagueAvg,
        boxA: formatBox(aggBoxA),
        boxB: formatBox(aggBoxB),
        tracedGame,
    };
}

// ── UI Rendering ──

export function renderSimulateButton(container, team1, team2) {
    const btn = document.createElement('button');
    btn.className = 'simulate-btn';
    btn.textContent = 'Simulate Game';
    btn.addEventListener('click', () => onSimulate(container, team1, team2));
    container.appendChild(btn);
}

async function onSimulate(container, team1, team2) {
    // Remove existing button and results
    const oldBtn = container.querySelector('.simulate-btn');
    if (oldBtn) oldBtn.remove();
    const oldResults = container.querySelector('.simulate-results');
    if (oldResults) oldResults.remove();

    // Show loading
    const loading = document.createElement('div');
    loading.className = 'simulate-loading';
    loading.innerHTML = '<div class="sim-spinner"></div><span>Running 1,000 simulations...</span>';
    container.appendChild(loading);

    // Ensure profiles loaded
    try {
        await loadSimProfiles();
    } catch {
        loading.remove();
        const msg = document.createElement('div');
        msg.className = 'no-data-msg';
        msg.textContent = 'Simulation data unavailable';
        container.appendChild(msg);
        return;
    }

    const profileA = getProfile(team1.id);
    const profileB = getProfile(team2.id);

    if (!profileA || !profileB) {
        loading.remove();
        const msg = document.createElement('div');
        msg.className = 'no-data-msg';
        msg.textContent = 'Simulation data unavailable for this matchup';
        container.appendChild(msg);
        return;
    }

    // Yield to UI thread, then run simulation
    setTimeout(() => {
        const results = runSimulations(profileA, profileB, N_SIMS_DEFAULT);
        loading.remove();
        renderSimulationResults(container, results, team1.name, team2.name);
    }, 0);
}

function pct(val) {
    return (val * 100).toFixed(1) + '%';
}

function renderSimulationResults(container, data, nameA, nameB) {
    const div = document.createElement('div');
    div.className = 'simulate-results';

    const t1Favored = data.winProbA >= 0.5;
    const netA = data.adjOA - data.adjDA;
    const netB = data.adjOB - data.adjDB;

    div.innerHTML = `
        <div class="sim-scores">
            <div class="sim-score-team">
                <div class="sim-score-name">${nameA}</div>
                <div class="sim-score-num">${data.meanA.toFixed(1)}</div>
                <div class="sim-score-ci">${data.ci90A[0]}-${data.ci90A[1]}</div>
            </div>
            <div class="sim-score-dash">&mdash;</div>
            <div class="sim-score-team">
                <div class="sim-score-name">${nameB}</div>
                <div class="sim-score-num">${data.meanB.toFixed(1)}</div>
                <div class="sim-score-ci">${data.ci90B[0]}-${data.ci90B[1]}</div>
            </div>
        </div>
        <div class="prediction-teams" style="margin-top:12px">
            <div class="prediction-team">
                <div class="prob ${t1Favored ? 'favored' : 'underdog'}">${pct(data.winProbA)}</div>
            </div>
            <div class="prediction-team">
                <div class="prob ${!t1Favored ? 'favored' : 'underdog'}">${pct(1 - data.winProbA)}</div>
            </div>
        </div>
        <div class="prob-bar">
            <div class="prob-bar-fill" style="width: ${(data.winProbA * 100).toFixed(1)}%"></div>
        </div>
        <div class="sim-efficiency">
            <span>${nameA}: AdjO ${data.adjOA.toFixed(1)} / AdjD ${data.adjDA.toFixed(1)} / Net ${netA >= 0 ? '+' : ''}${netA.toFixed(1)}</span>
            <span>${nameB}: AdjO ${data.adjOB.toFixed(1)} / AdjD ${data.adjDB.toFixed(1)} / Net ${netB >= 0 ? '+' : ''}${netB.toFixed(1)}</span>
        </div>
        <div class="sim-subtitle">Avg. per 100 possessions (league avg: ${data.leagueAvg.toFixed(1)})</div>
        ${renderBoxTable(nameA, data.boxA)}
        ${renderBoxTable(nameB, data.boxB)}
    `;

    // "Watch a Game" button
    const traceBtn = document.createElement('button');
    traceBtn.className = 'sim-trace-btn';
    traceBtn.textContent = 'Watch a Game';
    traceBtn.addEventListener('click', () => {
        traceBtn.remove();
        renderPlayByPlay(div, data.tracedGame, nameA, nameB);
    });
    div.appendChild(traceBtn);

    container.appendChild(div);
}

function renderBoxTable(teamName, box) {
    const top6 = box.slice(0, 6);
    let rows = '';
    for (const p of top6) {
        rows += `<tr>
            <td class="sim-box-name">${p.name}</td>
            <td>${p.ppg.toFixed(1)}</td>
            <td>${pct(p.fg_pct)}</td>
            <td>${pct(p.tp_pct)}</td>
            <td>${pct(p.ft_pct)}</td>
            <td>${p.to.toFixed(1)}</td>
        </tr>`;
    }
    return `
        <div class="sim-box-section">
            <div class="sim-team-header">${teamName}</div>
            <table class="sim-box-table">
                <thead><tr>
                    <th>Player</th><th>PPG</th><th>FG%</th><th>3P%</th><th>FT%</th><th>TO</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function renderPlayByPlay(container, tracedGame, nameA, nameB) {
    const feed = document.createElement('div');
    feed.className = 'sim-play-feed';

    const outcomeText = {
        'turnover': 'Turnover',
        'foul': 'Free throws',
        'made3': 'Made 3-pointer',
        'made2': 'Made 2-pointer',
        'miss3': 'Missed 3-pointer',
        'miss2': 'Missed shot',
    };

    for (const play of tracedGame.trace) {
        const isA = play.team === 'A';
        const teamName = isA ? nameA : nameB;
        const teamClass = isA ? 'team-a' : 'team-b';
        const pointsText = play.points > 0 ? ` (+${play.points})` : '';
        const el = document.createElement('div');
        el.className = `sim-play ${teamClass}`;
        el.innerHTML = `
            <div class="sim-play-detail">
                <span class="sim-play-team">${teamName}</span>
                <span class="sim-play-desc">${play.player} — ${outcomeText[play.outcome] || play.outcome}${pointsText}</span>
            </div>
            <div class="sim-play-score">${play.scoreA} - ${play.scoreB}</div>
        `;
        feed.appendChild(el);
    }

    container.appendChild(feed);
    feed.scrollTop = feed.scrollHeight;
}
