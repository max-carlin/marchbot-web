/**
 * Tournament bracket rendering module.
 * Loads precomputed bracket data and renders an interactive bracket visualization.
 */

const ROUND_NAMES = ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];

let bracketData = null;
let bracketResults = null;
let currentMethod = 'xgboost';

async function loadBracketData() {
    if (bracketData && bracketResults) return;
    const [bResp, rResp] = await Promise.all([
        fetch('data/bracket.json'),
        fetch('data/bracket_results.json'),
    ]);
    if (!bResp.ok || !rResp.ok) throw new Error('Bracket data not found');
    bracketData = await bResp.json();
    bracketResults = await rResp.json();
}

function shortTeamName(fullName) {
    // Strip common suffixes for compact display
    return fullName
        .replace(/ (Wildcats|Tigers|Bulldogs|Bears|Eagles|Hawks|Huskies|Cavaliers|Cardinals|Jayhawks|Wolverines|Boilermakers|Hoosiers|Seminoles|Volunteers|Commodores|Razorbacks|Gators|Hurricanes|Longhorns|Aggies|Cowboys|Sooners|Cyclones|Mountaineers|Panthers|Terrapins|Scarlet Knights|Nittany Lions|Spartans|Buckeyes|Badgers|Golden Gophers|Hawkeyes|Fighting Illini|Cornhuskers|Blue Devils|Tar Heels|Demon Deacons|Orange|Yellow Jackets|Fighting Irish|Red Storm|Friars|Musketeers|Bluejays|Pirates|Hoyas|Johnnies|Peacocks|Gaels|Bruins|Trojans|Ducks|Beavers|Sun Devils|Buffaloes|Utes|Cougars|Huskies|Zags|Toreros|Lions|Rams|Explorers|Billikens|Flyers|Bonnies|Dukes|Spiders|Colonials|Patriots|Phoenix|Retrievers|Catamounts|Seahawks|Great Danes|Seawolves|Stony Brook Seawolves|Bearcats|Musketeers|Shockers|Penguins|Raiders|Flames|Monarchs|49ers|Miners|Mean Green|Roadrunners|Owls|Thundering Herd|Bobcats|RedHawks|Rockets|Chippewas|Broncos|Bulls|Zips|Golden Flashes|Herd|Falcons|Knights|Red Raiders|Horned Frogs|Mustangs|Cougars|Tulsa|Wave|Blazers)$/i, '')
        .trim();
}

function renderMatchup(game, isReversed) {
    const { teamA, teamB, winProb, winnerId } = game;
    const aWon = winnerId === teamA.id;
    const probA = winProb;
    const probB = 1 - winProb;
    const displayProbA = aWon ? probA : probB;
    const displayProbB = aWon ? probB : probA;
    const winner = aWon ? teamA : teamB;
    const loser = aWon ? teamB : teamA;
    const winnerProb = aWon ? probA : probB;
    const loserProb = aWon ? probB : probA;

    // Top team is always teamA, bottom is teamB
    const topTeam = teamA;
    const bottomTeam = teamB;
    const topWon = aWon;
    const bottomWon = !aWon;
    const topProb = probA;
    const bottomProb = probB;

    return `
        <div class="bracket-matchup">
            <div class="bracket-team top ${topWon ? 'winner' : 'loser'}">
                <span class="bracket-seed">${topTeam.seed}</span>
                <img class="bracket-logo" src="${topTeam.logo}" alt="" loading="lazy" onerror="this.style.display='none'">
                <a class="bracket-team-name" href="#/team/${topTeam.id}">${shortTeamName(topTeam.name)}</a>
                <span class="bracket-prob ${topWon ? 'favored' : ''}">${(topProb * 100).toFixed(1)}%</span>
            </div>
            <div class="bracket-team bottom ${bottomWon ? 'winner' : 'loser'}">
                <span class="bracket-seed">${bottomTeam.seed}</span>
                <img class="bracket-logo" src="${bottomTeam.logo}" alt="" loading="lazy" onerror="this.style.display='none'">
                <a class="bracket-team-name" href="#/team/${bottomTeam.id}">${shortTeamName(bottomTeam.name)}</a>
                <span class="bracket-prob ${bottomWon ? 'favored' : ''}">${(bottomProb * 100).toFixed(1)}%</span>
            </div>
        </div>`;
}

function getRegionGames(results, regionIndex) {
    // Extract games for a specific region from each round
    // R64: 8 games per region (indices regionIndex*8 .. regionIndex*8+7)
    // R32: 4 games per region
    // S16: 2 games per region
    // E8: 1 game per region
    const rounds = results.rounds;
    const regionRounds = [];

    let gamesPerRegion = 8;
    for (let r = 0; r < 4 && r < rounds.length; r++) {
        const start = regionIndex * gamesPerRegion;
        const end = start + gamesPerRegion;
        regionRounds.push(rounds[r].slice(start, end));
        gamesPerRegion = Math.max(1, Math.floor(gamesPerRegion / 2));
    }

    return regionRounds;
}

function renderRegion(regionName, regionRounds, side) {
    const isRight = side === 'right';
    const roundOrder = isRight ? [...regionRounds].reverse() : regionRounds;
    const roundNamesSlice = ROUND_NAMES.slice(0, regionRounds.length);
    const roundLabels = isRight ? [...roundNamesSlice].reverse() : roundNamesSlice;

    let html = `<div class="bracket-region ${isRight ? 'right' : 'left'}">`;
    html += `<div class="bracket-region-label">${regionName}</div>`;
    html += `<div class="bracket-region-rounds">`;

    for (let i = 0; i < roundOrder.length; i++) {
        const games = roundOrder[i];
        const roundLabel = roundLabels[i];
        html += `<div class="bracket-round" data-round="${roundLabel}">`;
        for (const game of games) {
            html += renderMatchup(game, isRight);
        }
        html += `</div>`;
    }

    html += `</div></div>`;
    return html;
}

function renderFinalFour(results) {
    const ffRound = results.rounds[4] || [];
    const champRound = results.rounds[5] || [];
    const champion = results.champion;

    let html = `<div class="bracket-center">`;

    // Final Four games
    html += `<div class="bracket-ff">`;
    html += `<div class="bracket-round-label">Final Four</div>`;
    for (const game of ffRound) {
        html += renderMatchup(game, false);
    }
    html += `</div>`;

    // Championship
    html += `<div class="bracket-championship">`;
    html += `<div class="bracket-round-label">Championship</div>`;
    for (const game of champRound) {
        html += renderMatchup(game, false);
    }
    html += `</div>`;

    // Champion
    if (champion) {
        html += `<div class="bracket-champion">`;
        html += `<div class="bracket-champion-label">Champion</div>`;
        html += `<img class="bracket-champion-logo" src="${champion.logo}" alt="" onerror="this.style.display='none'">`;
        html += `<div class="bracket-champion-name">${champion.name}</div>`;
        html += `<div class="bracket-champion-seed">(${champion.seed}) ${champion.region}</div>`;
        html += `</div>`;
    }

    html += `</div>`;
    return html;
}

function renderBracketDOM(container) {
    const results = bracketResults[currentMethod];
    if (!results) return;

    const regions = bracketData.regions;

    // Left side: regions 0 and 1 (South, East)
    // Right side: regions 2 and 3 (Midwest, West)
    const leftRegions = regions.slice(0, 2);
    const rightRegions = regions.slice(2, 4);

    let html = `<div class="bracket-wrapper">`;

    // Left column
    html += `<div class="bracket-side left-side">`;
    for (let i = 0; i < leftRegions.length; i++) {
        const regionRounds = getRegionGames(results, i);
        html += renderRegion(leftRegions[i], regionRounds, 'left');
    }
    html += `</div>`;

    // Center (Final Four + Championship)
    html += renderFinalFour(results);

    // Right column
    html += `<div class="bracket-side right-side">`;
    for (let i = 0; i < rightRegions.length; i++) {
        const regionRounds = getRegionGames(results, i + 2);
        html += renderRegion(rightRegions[i], regionRounds, 'right');
    }
    html += `</div>`;

    html += `</div>`;

    const wrapper = container.querySelector('.bracket-board');
    wrapper.innerHTML = html;
}

function updateBracket(container) {
    renderBracketDOM(container);
}

export async function renderBracket(container) {
    container.innerHTML = `
        <div class="bracket-section">
            <div class="bracket-controls">
                <select id="bracket-method" class="bracket-method-select">
                    <option value="xgboost">XGBoost Model</option>
                    <option value="montecarlo">Monte Carlo Simulation</option>
                </select>
            </div>
            <div class="bracket-board">
                <div class="loading-content"><p>Loading bracket...</p></div>
            </div>
        </div>
    `;

    try {
        await loadBracketData();
    } catch {
        container.querySelector('.bracket-board').innerHTML =
            '<div class="loading-content"><p>Bracket data not available. Run the bracket scripts first.</p></div>';
        return;
    }

    renderBracketDOM(container);

    // Dropdown toggle
    const select = container.querySelector('#bracket-method');
    select.addEventListener('change', () => {
        currentMethod = select.value;
        updateBracket(container);
    });
}
