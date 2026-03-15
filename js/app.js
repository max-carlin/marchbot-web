import { initDB, getTeams, getTeam, getTeamGames, getTeamTopPlayers,
         getPlayerShots, getPlayer, getPlayerTeamName,
         searchTeams, searchPlayers } from './db.js';
import { loadPredictions, getPrediction, getPredictionTeams } from './predict.js';
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

    // Load predictions in background (non-blocking)
    loadPredictions().catch(() => {});

    // Setup header search
    setupHeaderSearch();

    // Route
    window.addEventListener('hashchange', route);
    route();
}

// --- Header Search ---
function setupHeaderSearch() {
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
        if (!e.target.closest('.search-container')) {
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

// --- Router ---
function route() {
    const hash = window.location.hash || '#/';
    const parts = hash.slice(2).split('/'); // remove #/

    if (parts[0] === 'team' && parts[1]) {
        renderTeamPage(parts[1]);
    } else if (parts[0] === 'player' && parts[1]) {
        renderPlayerPage(parts[1]);
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
        <div id="upcoming-games">
            <div class="loading-content"><p>Loading upcoming games...</p></div>
        </div>
        <div class="predict-section">
            <h2 class="section-title">Custom Matchup</h2>
            <div class="predict-page">
                <div class="predict-inputs">
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
                <div class="prediction-result hidden" id="prediction-result"></div>
            </div>
        </div>
    `;

    let team1 = null, team2 = null;
    setupPicker('picker1', (t) => { team1 = t; showPrediction(team1, team2); });
    setupPicker('picker2', (t) => { team2 = t; showPrediction(team1, team2); });

    loadUpcomingGames();
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
    const dateLabel = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    let html = `<h2 class="section-title">${dateLabel}</h2>`;
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

        html += `
        <div class="game-card">
            <div class="game-meta">
                <span class="game-time">${time}</span>
                ${game.broadcast ? `<span class="game-broadcast">${game.broadcast}</span>` : ''}
                ${game.venue ? `<span class="game-venue">${game.venue}</span>` : ''}
            </div>
            <div class="game-matchup">
                <div class="game-team ${hasPrediction && !homeFavored ? 'underdog' : ''}">
                    <a href="${awayTeamLink}" class="team-name">${awayRank}${away.name}</a>
                    ${hasPrediction ? `<span class="team-prob ${!homeFavored ? 'favored' : ''}">${(awayProb * 100).toFixed(1)}%</span>` : ''}
                </div>
                <span class="at-label">@</span>
                <div class="game-team ${hasPrediction && homeFavored ? '' : 'underdog'}">
                    <a href="${homeTeamLink}" class="team-name">${homeRank}${home.name}</a>
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
            <div class="quick-links" id="quick-links"></div>
        </div>
    `;

    const teams = getTeams();
    const topNames = ['Duke', 'North Carolina', 'Kansas', 'Kentucky', 'Gonzaga',
                      'UConn', 'Houston', 'Purdue', 'Auburn', 'Tennessee',
                      'Michigan State', 'Alabama', 'Iowa State', 'Arizona'];
    const links = document.getElementById('quick-links');
    for (const name of topNames) {
        const team = teams.find(t => t.team_name.includes(name));
        if (team) {
            const a = document.createElement('a');
            a.className = 'quick-link';
            a.href = `#/team/${team.team_id}`;
            a.textContent = shortName(team.team_name);
            links.appendChild(a);
        }
    }
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

    // Render season log
    const logCanvas = document.getElementById('season-log-chart');
    renderSeasonLog(logCanvas, teamId, games);

    // Render top players
    const players = getTeamTopPlayers(teamId);
    if (players.length) {
        renderTopPlayersBars(document.getElementById('top-players-bars'), players);
        renderTopPlayersScatter(document.getElementById('top-players-scatter'), players);

        // Make player names clickable via chart click handler
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
    const makes = shots.filter(s => s.scoring_play).length;
    const total = shots.length;
    const fgPct = total > 0 ? (makes / total * 100).toFixed(1) : '0.0';

    app.innerHTML = `
        <div class="player-page">
            <h1>${player.display_name}</h1>
            ${teamName ? `<a class="team-link" href="#/team/${player.last_team_id}">${teamName}</a>` : ''}
            <div class="stats-line">${total} shots | ${makes}/${total} FG (${fgPct}%) | ${player.position || ''}</div>
            <div class="section-title">Shot Chart</div>
            <div class="shot-chart-container">
                <canvas id="shot-chart"></canvas>
            </div>
        </div>
    `;

    const canvas = document.getElementById('shot-chart');
    renderShotChart(canvas, shots);
}


function setupPicker(pickerId, onSelect) {
    const picker = document.getElementById(pickerId);
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
            // Use prediction teams for filtering
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
