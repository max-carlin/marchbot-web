#!/usr/bin/env node
/**
 * Precompute bracket results for XGBoost and Monte Carlo methods.
 * Reads data/bracket.json, data/predictions.json, data/sim_profiles.json
 * Outputs data/bracket_results.json
 *
 * Uses a seeded PRNG so results are reproducible (same seed → same upsets).
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Seeded PRNG (mulberry32) ──
function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Load data ──
const bracket = JSON.parse(readFileSync(join(ROOT, 'data/bracket.json'), 'utf8'));
const predictions = JSON.parse(readFileSync(join(ROOT, 'data/predictions.json'), 'utf8'));
const simProfiles = JSON.parse(readFileSync(join(ROOT, 'data/sim_profiles.json'), 'utf8'));

// ── Probability calibration ──
// The XGBoost probabilities are compressed toward 0.5 and often predict upsets
// where higher seeds should be favored. We calibrate by:
// 1. Stretching log-odds (k > 1 amplifies the model's signal)
// 2. Shifting log-odds toward the higher seed based on seed differential
// This preserves the model's team-specific knowledge while anchoring to
// tournament seed expectations.
const CALIBRATION_K = 1.5;
const SEED_WEIGHT = 0.2; // log-odds shift per seed difference

function calibrate(p, seedA, seedB) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const logit = Math.log(p / (1 - p));
    // seedDiff > 0 when A is the higher seed (lower seed number)
    const seedDiff = (seedB || 8) - (seedA || 8);
    const adjusted = CALIBRATION_K * logit + SEED_WEIGHT * seedDiff;
    return 1 / (1 + Math.exp(-adjusted));
}

// ── XGBoost prediction lookup (with seed-aware calibration) ──
function getXGBoostProb(teamA, teamB) {
    const idA = parseInt(teamA.id);
    const idB = parseInt(teamB.id);
    const smaller = Math.min(idA, idB);
    const larger = Math.max(idA, idB);
    const key = `${smaller}_${larger}`;

    if (!(key in predictions.matchups)) return 0.5;

    const smallerWinProb = predictions.matchups[key];
    const raw = idA === smaller ? smallerWinProb : 1 - smallerWinProb;
    return calibrate(raw, teamA.seed, teamB.seed);
}

// ── Monte Carlo simulation engine (ported from simulate.js) ──
const PACE_STD = 3.0;
const MAX_FOUL_PROB = 0.30;
const STINT_LENGTH = 10;
const OT_POSSESSIONS = 5;
const DEF_ADJ_CLAMP_LO = 0.80;
const DEF_ADJ_CLAMP_HI = 1.20;
const N_SIMS = 1000;

let rng; // will be set per-method

function randNormal(mean, std) {
    const u1 = rng();
    const u2 = rng();
    return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function weightedChoice(weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let r = rng() * total;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
    }
    return weights.length - 1;
}

function weightedSampleWithout(weights, k) {
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
        let r = rng() * total;
        for (let i = 0; i < n; i++) {
            if (used.has(i)) continue;
            r -= w[i];
            if (r <= 0) { result.push(i); used.add(i); break; }
        }
        if (result.length <= pick) {
            for (let i = 0; i < n; i++) {
                if (!used.has(i)) { result.push(i); used.add(i); break; }
            }
        }
    }
    return result;
}

function pickLineup(rotation) {
    const weights = rotation.map(p => p.minutes_share);
    const indices = weightedSampleWithout(weights, Math.min(5, rotation.length));
    return indices.map(i => rotation[i]);
}

function simulatePossession(teamOff, teamDef, lineup, leagueAvg) {
    if (rng() < teamOff.team_turnover_rate) return 0;

    const oppAdjD = teamDef.adj_d || leagueAvg;
    let defAdj = oppAdjD / Math.max(leagueAvg, 1);
    defAdj = Math.max(DEF_ADJ_CLAMP_LO, Math.min(defAdj, DEF_ADJ_CLAMP_HI));

    while (true) {
        const usageWeights = lineup.map(p => p.usage_rate);
        const shooterIdx = weightedChoice(usageWeights);
        const shooter = lineup[shooterIdx];

        let foulProb = shooter.foul_draw_rate * teamDef.foul_rate;
        foulProb = Math.min(foulProb, MAX_FOUL_PROB);
        if (rng() < foulProb) {
            let pts = 0;
            for (let ft = 0; ft < 2; ft++) {
                if (rng() < shooter.ft_pct) pts++;
            }
            return pts;
        }

        if (rng() < shooter.three_share) {
            if (rng() < shooter.three_pct * defAdj) return 3;
        } else {
            if (rng() < shooter.two_pct * defAdj) return 2;
        }

        if (rng() < teamOff.off_reb_rate) continue;
        return 0;
    }
}

function simulateGame(profileA, profileB, leagueAvg) {
    const expected = (profileA.possessions_per_game + profileB.possessions_per_game) / 2;
    const nPoss = Math.max(Math.round(randNormal(expected, PACE_STD)), 40);
    let scoreA = 0, scoreB = 0;

    const runPoss = (off, def, n) => {
        let total = 0;
        let lineup = pickLineup(off.rotation);
        for (let i = 0; i < n; i++) {
            if (i > 0 && i % STINT_LENGTH === 0) lineup = pickLineup(off.rotation);
            total += simulatePossession(off, def, lineup, leagueAvg);
        }
        return total;
    };

    scoreA = runPoss(profileA, profileB, nPoss);
    scoreB = runPoss(profileB, profileA, nPoss);
    while (scoreA === scoreB) {
        scoreA += runPoss(profileA, profileB, OT_POSSESSIONS);
        scoreB += runPoss(profileB, profileA, OT_POSSESSIONS);
    }
    return { scoreA, scoreB };
}

function getMonteCarloProb(teamA, teamB) {
    const profileA = simProfiles.teams[String(teamA.id)];
    const profileB = simProfiles.teams[String(teamB.id)];
    if (!profileA || !profileB) return 0.5;

    const leagueAvg = simProfiles.league_avg_eff || 100.0;
    let winsA = 0;
    for (let i = 0; i < N_SIMS; i++) {
        const { scoreA, scoreB } = simulateGame(profileA, profileB, leagueAvg);
        if (scoreA > scoreB) winsA++;
    }
    return winsA / N_SIMS;
}

// ── Tournament simulation ──
function simulateTournament(getWinProb, seed) {
    rng = mulberry32(seed);

    const regions = bracket.regions;
    const allRounds = []; // round 0 = R64, round 5 = championship

    // Regional rounds (R64 through Elite 8) for each region
    const regionWinners = [];

    for (const regionName of regions) {
        const regionTeams = bracket.teams[regionName] || [];
        if (regionTeams.length < 2) {
            console.warn(`Region ${regionName} has ${regionTeams.length} teams, skipping`);
            regionWinners.push(regionTeams[0] || null);
            continue;
        }

        // R64: pairs are index 0v1, 2v3, 4v5, etc.
        let currentTeams = [...regionTeams];
        const regionRounds = [];

        // Play through regional rounds until 1 team left
        while (currentTeams.length > 1) {
            const roundGames = [];
            const nextTeams = [];
            for (let i = 0; i < currentTeams.length; i += 2) {
                const teamA = currentTeams[i];
                const teamB = currentTeams[i + 1];
                if (!teamB) {
                    // Odd team gets a bye
                    nextTeams.push(teamA);
                    continue;
                }

                const winProb = getWinProb(teamA, teamB);
                const coinFlip = rng();
                const winner = coinFlip < winProb ? teamA : teamB;

                roundGames.push({
                    teamA: { ...teamA, region: regionName },
                    teamB: { ...teamB, region: regionName },
                    winProb: roundFloat(winProb),
                    winnerId: winner.id,
                });
                nextTeams.push(winner);
            }
            regionRounds.push(roundGames);
            currentTeams = nextTeams;
        }

        regionWinners.push({ ...currentTeams[0], region: regionName });

        // Store regional round games
        for (let r = 0; r < regionRounds.length; r++) {
            if (!allRounds[r]) allRounds[r] = [];
            allRounds[r].push(...regionRounds[r]);
        }
    }

    // Final Four: region 0 vs region 1, region 2 vs region 3
    const ffGames = [];
    const ffWinners = [];
    const ffPairs = [[0, 1], [2, 3]];

    for (const [i, j] of ffPairs) {
        const teamA = regionWinners[i];
        const teamB = regionWinners[j];
        if (!teamA || !teamB) {
            ffWinners.push(teamA || teamB);
            continue;
        }
        const winProb = getWinProb(teamA, teamB);
        const winner = rng() < winProb ? teamA : teamB;
        ffGames.push({
            teamA,
            teamB,
            winProb: roundFloat(winProb),
            winnerId: winner.id,
        });
        ffWinners.push(winner);
    }
    allRounds.push(ffGames);

    // Championship
    const champGames = [];
    if (ffWinners.length >= 2 && ffWinners[0] && ffWinners[1]) {
        const teamA = ffWinners[0];
        const teamB = ffWinners[1];
        const winProb = getWinProb(teamA, teamB);
        const winner = rng() < winProb ? teamA : teamB;
        champGames.push({
            teamA,
            teamB,
            winProb: roundFloat(winProb),
            winnerId: winner.id,
        });
        allRounds.push(champGames);

        return {
            rounds: allRounds,
            champion: winner,
        };
    }

    allRounds.push(champGames);
    return {
        rounds: allRounds,
        champion: ffWinners[0] || null,
    };
}

function roundFloat(n) {
    return Math.round(n * 1000) / 1000;
}

// ── Main ──
const SEED = 2026;

console.log('Generating XGBoost bracket...');
const xgboostResult = simulateTournament(getXGBoostProb, SEED);
console.log(`  Champion: (${xgboostResult.champion?.seed}) ${xgboostResult.champion?.name}`);
for (let i = 0; i < xgboostResult.rounds.length; i++) {
    console.log(`  Round ${i}: ${xgboostResult.rounds[i].length} games`);
}

console.log('\nGenerating Monte Carlo bracket...');
// Use a different seed offset for MC so results differ from XGBoost
const mcResult = simulateTournament(getMonteCarloProb, 3035);
console.log(`  Champion: (${mcResult.champion?.seed}) ${mcResult.champion?.name}`);
for (let i = 0; i < mcResult.rounds.length; i++) {
    console.log(`  Round ${i}: ${mcResult.rounds[i].length} games`);
}

const output = {
    generated: new Date().toISOString(),
    xgboost: xgboostResult,
    montecarlo: mcResult,
};

const outPath = join(ROOT, 'data/bracket_results.json');
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\nWrote ${outPath}`);
