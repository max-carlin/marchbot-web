import { initDB, getTeams, getTeam, getTeamGames, getTeamTopPlayers,
         getPlayerShots, getPlayer, getPlayerTeamName, getPlayerSeasonStats,
         searchTeams, searchPlayers, getTeamStats } from './db.js';
import { loadPredictions, getPrediction, getPredictionTeams } from './predict.js';
import { renderSimulateButton, loadSimProfiles } from './simulate.js';
import { initAutoSimViz } from './sim-viz.js';
import { renderBracket } from './bracket.js';
import { renderSeasonLog, shortName } from './charts/season-log.js';
import { renderTopPlayersBars, renderTopPlayersScatter } from './charts/top-players.js';
import { renderShotChart } from './charts/shot-chart.js';

const app = document.getElementById('app');

// --- Init ---
async function init() {
    await initDB((progress) => {
        const pct = Math.round(progress * 100);
        document.getElementById('progress-fill').style.width = pct + '%';
        document.getElementById('progress-text').textContent = pct + '%';
    });

    // Load predictions and sim profiles in background (non-blocking)
    loadPredictions().catch(() => {});
    loadSimProfiles().catch(() => {});

    // Setup sidebar
    setupSidebar();
    setupSidebarSearch();

    // Route
    window.addEventListener('hashchange', route);
    route();
}

// --- Sidebar ---
function setupSidebar() {
    const toggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    function open() {
        sidebar.classList.add('open');
        overlay.classList.add('active');
        toggle.classList.add('active');
    }

    function close() {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
        toggle.classList.remove('active');
    }

    toggle.addEventListener('click', () => {
        if (sidebar.classList.contains('open')) close();
        else open();
    });

    overlay.addEventListener('click', close);

    // Close sidebar on navigation
    window.addEventListener('hashchange', close);

    // Close sidebar links
    sidebar.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', close);
    });
}

function setupSidebarSearch() {
    const input = document.getElementById('search-input');
    const dropdown = document.getElementById('search-dropdown');
    let debounceTimer;

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const q = input.value.trim();
            if (q.length < 2) {
                dropdown.classList.add('hidden');
                return;
            }
            showSearchResults(q, dropdown);
        }, 200);
    });

    input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length >= 2) showSearchResults(q, dropdown);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.sidebar-search')) {
            dropdown.classList.add('hidden');
        }
    });
}

function showSearchResults(q, dropdown) {
    const teams = searchTeams(q);
    const players = searchPlayers(q);

    if (!teams.length && !players.length) {
        dropdown.classList.add('hidden');
        return;
    }

    let html = '';
    if (teams.length) {
        html += '<div class="search-group-label">Teams</div>';
        for (const t of teams) {
            html += `<div class="search-item" data-href="#/team/${t.team_id}">
                <span>${t.team_name}</span>
            </div>`;
        }
    }
    if (players.length) {
        html += '<div class="search-group-label">Players</div>';
        for (const p of players) {
            html += `<div class="search-item" data-href="#/player/${p.athlete_id}">
                <span>${p.display_name}</span>
                <span class="meta">${p.position || ''}</span>
            </div>`;
        }
    }

    dropdown.innerHTML = html;
    dropdown.classList.remove('hidden');

    dropdown.querySelectorAll('.search-item').forEach(item => {
        item.addEventListener('click', () => {
            window.location.hash = item.dataset.href;
            dropdown.classList.add('hidden');
            document.getElementById('search-input').value = '';
        });
    });
}

function renderPredictPage() {
    app.innerHTML = `
        <div class="predict-page">
            <h1>Custom Matchup</h1>
            <div class="predict-matchup">
                <div class="team-picker" id="picker1">
                    <input type="text" placeholder="Team 1..." autocomplete="off">
                    <div class="picker-dropdown hidden"></div>
                </div>
                <span class="vs-label">vs</span>
                <div class="team-picker" id="picker2">
                    <input type="text" placeholder="Team 2..." autocomplete="off">
                    <div class="picker-dropdown hidden"></div>
                </div>
            </div>
            <p class="predict-hint">Select any two teams to see win probabilities from the MaxModel💯, assuming a neutral-site game.</p>
            <div class="prediction-result hidden" id="prediction-result"></div>
        </div>
    `;
    let team1 = null, team2 = null;
    setupPicker('picker1', (t) => { team1 = t; showPrediction(team1, team2); });
    setupPicker('picker2', (t) => { team2 = t; showPrediction(team1, team2); });
}

// --- Router ---
function route() {
    const hash = window.location.hash || '#/';
    const parts = hash.slice(2).split('/'); // remove #/

    if (parts[0] === 'team' && parts[1]) {
        renderTeamPage(parts[1]);
    } else if (parts[0] === 'player' && parts[1]) {
        renderPlayerPage(parts[1]);
    } else if (parts[0] === 'predict') {
        renderPredictPage();
    } else if (parts[0] === 'stats') {
        renderStatsPage();
    } else {
        renderHomePage();
    }
}

// --- Pages ---

function renderHomePage() {
    app.innerHTML = `
        <div class="home-page">
            <div class="logo-container">
                <iframe src="output.html" title="marchbot logo"></iframe>
            </div>
        </div>
        <div class="games-backdrop">
            <iframe class="backdrop-iframe" src="dunk.html" title="background animation"></iframe>
            <div class="games-content" id="bracket-container"></div>
        </div>
        <div class="sim-viz-section" id="sim-viz-container"></div>
    `;

    renderBracket(document.getElementById('bracket-container')).catch(() => {});
    initAutoSimViz().catch(() => {});
}

async function loadUpcomingGames() {
    const container = document.getElementById('upcoming-games');
    try {
        const resp = await fetch('data/upcoming.json');
        if (!resp.ok) throw new Error('No upcoming data');
        const data = await resp.json();
        renderUpcomingGames(container, data);
    } catch {
        container.innerHTML = '';
    }
}

function formatGameTime(isoStr) {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function renderUpcomingGames(container, data) {
    const games = data.games || [];
    if (!games.length) {
        container.innerHTML = '';
        return;
    }

    const dateObj = new Date(data.date + 'T12:00:00');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const yyyy = dateObj.getFullYear();
    const dateLabel = `${mm}/${dd}/${yyyy}`;

    let html = '';
    html += '<div class="games-grid">';

    for (const game of games) {
        const home = game.home;
        const away = game.away;
        const homeProb = home.win_prob;
        const awayProb = away.win_prob;
        const hasPrediction = homeProb != null;
        const homeFavored = hasPrediction && homeProb >= 0.5;
        const time = formatGameTime(game.time);

        const homeRank = home.rank < 99 ? `<span class="rank">#${home.rank}</span> ` : '';
        const awayRank = away.rank < 99 ? `<span class="rank">#${away.rank}</span> ` : '';

        const homeTeamLink = `#/team/${home.id}`;
        const awayTeamLink = `#/team/${away.id}`;

        const homeLogo = home.logo || '';
        const awayLogo = away.logo || '';

        html += `
        <div class="game-card">
            <div class="game-meta">
                <span class="game-time">${time}</span>
                ${game.broadcast ? `<span class="game-broadcast">${game.broadcast}</span>` : ''}
                ${game.venue ? `<span class="game-venue">${game.venue}</span>` : ''}
            </div>
            <div class="game-matchup">
                <div class="game-team ${hasPrediction && !homeFavored ? 'underdog' : ''}">
                    <a href="${awayTeamLink}" class="team-name">
                        ${awayLogo ? `<img class="team-logo" src="${awayLogo}" alt="${away.name}">` : ''}
                        ${awayRank}${away.abbreviation || away.name}
                    </a>
                    ${hasPrediction ? `<span class="team-prob ${!homeFavored ? 'favored' : ''}">${(awayProb * 100).toFixed(1)}%</span>` : ''}
                </div>
                <span class="at-label">@</span>
                <div class="game-team ${hasPrediction && homeFavored ? '' : 'underdog'}">
                    <a href="${homeTeamLink}" class="team-name">
                        ${homeLogo ? `<img class="team-logo" src="${homeLogo}" alt="${home.name}">` : ''}
                        ${homeRank}${home.abbreviation || home.name}
                    </a>
                    ${hasPrediction ? `<span class="team-prob ${homeFavored ? 'favored' : ''}">${(homeProb * 100).toFixed(1)}%</span>` : ''}
                </div>
            </div>
            ${hasPrediction ? `
            <div class="game-prob-bar">
                <div class="game-prob-fill" style="width: ${awayProb * 100}%"></div>
            </div>` : ''}
        </div>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

function renderStatsPage() {
    app.innerHTML = `
        <div class="home-page">
            <h1>Stats</h1>
            <p class="subtitle">Browse teams and players</p>
            <div class="stats-search-container">
                <input type="text" id="stats-search" placeholder="Search teams or players..." autocomplete="off">
                <div id="stats-search-dropdown" class="search-dropdown hidden"></div>
            </div>
        </div>
        <div id="top-ranked"></div>
    `;

    setupStatsSearch();
    loadTopRanked();
}

async function loadTopRanked() {
    const container = document.getElementById('top-ranked');
    try {
        const resp = await fetch(
            'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/rankings'
        );
        const data = await resp.json();
        const ap = data.rankings[0]; // AP Top 25
        const top5 = ap.ranks.slice(0, 5);

        let html = `<h2 class="section-title">AP Top 5</h2>`;
        html += '<div class="ranked-list">';

        for (const entry of top5) {
            const t = entry.team;
            const record = entry.recordSummary || '';
            const stats = getTeamStats(t.id);
            const ppg = stats ? stats.ppg : '—';
            const oppPpg = stats ? stats.opp_ppg : '—';
            const margin = stats ? (stats.ppg - stats.opp_ppg).toFixed(1) : '—';
            const marginSign = stats && (stats.ppg - stats.opp_ppg) > 0 ? '+' : '';
            const logo = t.logos && t.logos[0] ? t.logos[0].href : '';

            html += `
            <a href="#/team/${t.id}" class="ranked-card">
                <div class="ranked-rank">${entry.current}</div>
                ${logo ? `<img class="ranked-logo" src="${logo}" alt="">` : ''}
                <div class="ranked-info">
                    <div class="ranked-name">${t.location} ${t.name}</div>
                    <div class="ranked-record">${record}</div>
                </div>
                <div class="ranked-metrics">
                    <div class="ranked-metric">
                        <span class="metric-value">${ppg}</span>
                        <span class="metric-label">PPG</span>
                    </div>
                    <div class="ranked-metric">
                        <span class="metric-value">${oppPpg}</span>
                        <span class="metric-label">OPP</span>
                    </div>
                    <div class="ranked-metric">
                        <span class="metric-value ${stats && (stats.ppg - stats.opp_ppg) > 0 ? 'positive' : 'negative'}">${marginSign}${margin}</span>
                        <span class="metric-label">MARGIN</span>
                    </div>
                </div>
            </a>`;
        }

        html += '</div>';
        container.innerHTML = html;
    } catch {
        container.innerHTML = '';
    }
}

function setupStatsSearch() {
    const input = document.getElementById('stats-search');
    const dropdown = document.getElementById('stats-search-dropdown');
    let debounceTimer;

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const q = input.value.trim();
            if (q.length < 2) {
                dropdown.classList.add('hidden');
                return;
            }
            showSearchResults(q, dropdown);
        }, 200);
    });

    input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length >= 2) showSearchResults(q, dropdown);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.stats-search-container')) {
            dropdown.classList.add('hidden');
        }
    });
}

function renderTeamPage(teamId) {
    const team = getTeam(teamId);
    if (!team) {
        app.innerHTML = '<div class="not-found"><h1>Team not found</h1></div>';
        return;
    }

    const games = getTeamGames(teamId);
    let wins = 0, losses = 0;
    for (const g of games) {
        const isHome = String(g.home_team_id) === String(teamId);
        const teamScore = isHome ? g.home_score : g.away_score;
        const oppScore = isHome ? g.away_score : g.home_score;
        if (teamScore > oppScore) wins++; else losses++;
    }

    app.innerHTML = `
        <div class="team-page">
            <h1>${team.team_name}</h1>
            <div class="record">${wins}-${losses}</div>

            <div class="section-title">Season Game Log</div>
            <div class="chart-container">
                <div class="chart-wrapper" style="height:350px;">
                    <canvas id="season-log-chart"></canvas>
                </div>
            </div>

            <div class="section-title">Top Players</div>
            <div class="top-players-grid">
                <div class="chart-container">
                    <div class="chart-wrapper" style="height:400px;">
                        <canvas id="top-players-bars"></canvas>
                    </div>
                </div>
                <div class="chart-container">
                    <div class="chart-wrapper" style="height:400px;">
                        <canvas id="top-players-scatter"></canvas>
                    </div>
                </div>
            </div>
        </div>
    `;

    const logCanvas = document.getElementById('season-log-chart');
    renderSeasonLog(logCanvas, teamId, games);

    const players = getTeamTopPlayers(teamId);
    if (players.length) {
        renderTopPlayersBars(document.getElementById('top-players-bars'), players);
        renderTopPlayersScatter(document.getElementById('top-players-scatter'), players);

        const barsCanvas = document.getElementById('top-players-bars');
        barsCanvas.style.cursor = 'pointer';
        barsCanvas.addEventListener('click', (evt) => {
            const chart = barsCanvas._chart;
            if (!chart) return;
            const points = chart.getElementsAtEventForMode(evt, 'nearest', { axis: 'y', intersect: false }, false);
            if (points.length) {
                const idx = points[0].index;
                const player = players[idx];
                if (player) window.location.hash = `#/player/${player.athlete_id}`;
            }
        });
    }
}

function renderPlayerPage(athleteId) {
    const player = getPlayer(athleteId);
    if (!player) {
        app.innerHTML = '<div class="not-found"><h1>Player not found</h1></div>';
        return;
    }

    const teamName = player.last_team_id ? getPlayerTeamName(player.last_team_id) : null;
    const shots = getPlayerShots(athleteId);
    const stats = getPlayerSeasonStats(athleteId);

    // Shot zone breakdowns from shot data
    const threeLineY = 8;
    const paintXMin = 19, paintXMax = 31, paintYMax = 19;
    let paintM = 0, paintA = 0, midM = 0, midA = 0, threeM = 0, threeA = 0;
    for (const s of shots) {
        const inPaint = s.coordinate_x >= paintXMin && s.coordinate_x <= paintXMax && s.coordinate_y <= paintYMax;
        // Three-point: beyond the arc (simplified: y > threeLineY or x < 3.3 or x > 46.7)
        const isThree = s.coordinate_y > threeLineY + 2 ||
                        s.coordinate_x < 3.3 || s.coordinate_x > 46.7 ||
                        Math.hypot(s.coordinate_x - 25, s.coordinate_y - 4) > 21.7;
        if (isThree) {
            threeA++; if (s.scoring_play) threeM++;
        } else if (inPaint) {
            paintA++; if (s.scoring_play) paintM++;
        } else {
            midA++; if (s.scoring_play) midM++;
        }
    }

    const pct = (m, a) => a > 0 ? (m / a * 100).toFixed(1) : '-';

    const fgPct = stats && stats.fga > 0 ? (stats.fgm / stats.fga * 100).toFixed(1) : '-';
    const threePct = stats && stats.threes_att > 0 ? (stats.threes_made / stats.threes_att * 100).toFixed(1) : '-';
    const ftPct = stats && stats.fta > 0 ? (stats.ftm / stats.fta * 100).toFixed(1) : '-';

    app.innerHTML = `
        <div class="player-page">
            <div class="player-header">
                <div>
                    <h1>${player.display_name}</h1>
                    ${teamName ? `<a class="team-link" href="#/team/${player.last_team_id}">${teamName}</a>` : ''}
                    ${player.position ? `<span class="player-pos">${player.position}</span>` : ''}
                </div>
            </div>

            ${stats && stats.games > 0 ? `
            <div class="player-stats-grid">
                <div class="player-stat-card">
                    <div class="player-stat-value">${stats.ppg}</div>
                    <div class="player-stat-label">PPG</div>
                </div>
                <div class="player-stat-card">
                    <div class="player-stat-value">${stats.rpg}</div>
                    <div class="player-stat-label">RPG</div>
                </div>
                <div class="player-stat-card">
                    <div class="player-stat-value">${stats.apg}</div>
                    <div class="player-stat-label">APG</div>
                </div>
                <div class="player-stat-card">
                    <div class="player-stat-value">${stats.mpg}</div>
                    <div class="player-stat-label">MPG</div>
                </div>
                <div class="player-stat-card">
                    <div class="player-stat-value">${fgPct}%</div>
                    <div class="player-stat-label">FG%</div>
                </div>
                <div class="player-stat-card">
                    <div class="player-stat-value">${threePct}%</div>
                    <div class="player-stat-label">3PT%</div>
                </div>
                <div class="player-stat-card">
                    <div class="player-stat-value">${ftPct}%</div>
                    <div class="player-stat-label">FT%</div>
                </div>
                <div class="player-stat-card">
                    <div class="player-stat-value">${stats.games}</div>
                    <div class="player-stat-label">GP</div>
                </div>
            </div>
            ` : ''}

            <div class="section-title">Shot Chart</div>
            <div class="player-shot-layout">
                <div class="shot-chart-container">
                    <canvas id="shot-chart"></canvas>
                </div>
                ${shots.length > 0 ? `
                <div class="shot-zones">
                    <div class="shot-zone">
                        <div class="zone-label">Paint</div>
                        <div class="zone-pct">${pct(paintM, paintA)}%</div>
                        <div class="zone-detail">${paintM}/${paintA}</div>
                    </div>
                    <div class="shot-zone">
                        <div class="zone-label">Mid-Range</div>
                        <div class="zone-pct">${pct(midM, midA)}%</div>
                        <div class="zone-detail">${midM}/${midA}</div>
                    </div>
                    <div class="shot-zone">
                        <div class="zone-label">Three-Point</div>
                        <div class="zone-pct">${pct(threeM, threeA)}%</div>
                        <div class="zone-detail">${threeM}/${threeA}</div>
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
    `;

    const canvas = document.getElementById('shot-chart');
    renderShotChart(canvas, shots);
}

function setupPicker(pickerId, onSelect) {
    const picker = document.getElementById(pickerId);
    if (!picker) return;
    const input = picker.querySelector('input');
    const dropdown = picker.querySelector('.picker-dropdown');
    let debounce;

    input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            const q = input.value.trim();
            if (q.length < 2) {
                dropdown.classList.add('hidden');
                return;
            }
            const predTeams = getPredictionTeams();
            const allTeams = Object.entries(predTeams)
                .filter(([, name]) => name.toLowerCase().includes(q.toLowerCase()))
                .slice(0, 10);

            if (!allTeams.length) {
                dropdown.classList.add('hidden');
                return;
            }

            dropdown.innerHTML = allTeams.map(([id, name]) =>
                `<div class="picker-item" data-id="${id}" data-name="${name}">${name}</div>`
            ).join('');
            dropdown.classList.remove('hidden');

            dropdown.querySelectorAll('.picker-item').forEach(item => {
                item.addEventListener('click', () => {
                    input.value = item.dataset.name;
                    dropdown.classList.add('hidden');
                    onSelect({ id: item.dataset.id, name: item.dataset.name });
                });
            });
        }, 150);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#' + pickerId)) {
            dropdown.classList.add('hidden');
        }
    });
}

function showPrediction(team1, team2) {
    const result = document.getElementById('prediction-result');
    if (!result) return;
    if (!team1 || !team2) {
        result.classList.add('hidden');
        return;
    }

    const prob = getPrediction(team1.id, team2.id);
    if (prob === null) {
        result.classList.remove('hidden');
        result.innerHTML = `
            <div class="no-data-msg">Insufficient data for this matchup</div>
        `;
        return;
    }

    const t1Pct = (prob * 100).toFixed(1);
    const t2Pct = ((1 - prob) * 100).toFixed(1);
    const t1Favored = prob >= 0.5;

    result.classList.remove('hidden');
    result.innerHTML = `
        <div class="prediction-teams">
            <div class="prediction-team">
                <div class="name">${team1.name}</div>
                <div class="prob ${t1Favored ? 'favored' : 'underdog'}">${t1Pct}%</div>
            </div>
            <div class="prediction-team">
                <div class="name">${team2.name}</div>
                <div class="prob ${!t1Favored ? 'favored' : 'underdog'}">${t2Pct}%</div>
            </div>
        </div>
        <div class="prob-bar">
            <div class="prob-bar-fill" style="width: ${t1Pct}%"></div>
        </div>
        <div style="margin-top:8px; font-size:12px; color:var(--text-dim)">Neutral site prediction</div>
    `;

    renderSimulateButton(result, team1, team2);
}

// Boot
init().catch(err => {
    console.error('Init failed:', err);
    app.innerHTML = `<div class="not-found">
        <h1>Error loading</h1>
        <p style="color:var(--text-dim)">${err.message}</p>
        <p style="color:var(--text-dim);margin-top:8px;">Make sure data/web.db.gz exists and you're running a local server.</p>
    </div>`;
});
