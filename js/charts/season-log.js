const SUFFIXES = [
    "Wildcats", "Bulldogs", "Tigers", "Eagles", "Bears", "Lions",
    "Panthers", "Hawks", "Cougars", "Huskies", "Wolverines",
    "Spartans", "Boilermakers", "Hoosiers", "Buckeyes", "Badgers",
    "Cyclones", "Jayhawks", "Cowboys", "Longhorns", "Aggies",
    "Razorbacks", "Volunteers", "Commodores", "Crimson Tide",
    "Fighting Irish", "Blue Devils", "Tar Heels", "Cavaliers",
    "Hokies", "Demon Deacons", "Wolfpack", "Seminoles", "Hurricanes",
    "Yellow Jackets", "Cardinals", "Orange", "Red Storm",
    "Friars", "Musketeers", "Bluejays", "Pirates", "Johnnies",
    "Golden Eagles", "Marquette", "Villanova", "Hoyas",
    "Mountaineers", "Red Raiders", "Horned Frogs", "Sooners",
    "Beavers", "Ducks", "Sun Devils", "Buffaloes", "Utes",
    "Bruins", "Trojans", "Gaels", "Broncos", "Toreros",
    "Pilots", "Waves", "Fighting Illini", "Nittany Lions",
    "Terrapins", "Golden Gophers", "Cornhuskers", "Hawkeyes",
    "Scarlet Knights", "Rebels", "Gators", "Gamecocks",
    "Royals", "Bobcats", "Rams", "Jaguars",
    "Red Foxes", "Stags", "Peacocks", "Jaspers", "Greyhounds",
    "Bonnies", "Flyers", "Explorers", "Billikens", "Dukes",
    "Colonials", "Spiders", "Keydets",
];

export function shortName(name) {
    for (const s of SUFFIXES) {
        if (name.endsWith(s)) {
            const short = name.slice(0, -s.length).trim();
            if (short) return short;
        }
    }
    if (name.length > 15) return name.split(' ')[0];
    return name;
}

/**
 * Render season log bar chart using Chart.js.
 * @param {HTMLCanvasElement} canvas
 * @param {string} teamId
 * @param {Array} games - from getTeamGames()
 */
export function renderSeasonLog(canvas, teamId, games) {
    const labels = [];
    const margins = [];
    const colors = [];
    const scoreLabels = [];

    for (const g of games) {
        const isHome = g.home_team_id === teamId || g.home_team_id === parseInt(teamId);
        const isNeutral = g.neutral_site === 1;
        const teamScore = isHome ? g.home_score : g.away_score;
        const oppScore = isHome ? g.away_score : g.home_score;
        const oppName = isHome ? g.away_team_name : g.home_team_name;
        const margin = teamScore - oppScore;

        let prefix = isHome ? 'vs ' : '@ ';
        if (isNeutral) prefix = 'vs ';

        labels.push(prefix + shortName(oppName));
        margins.push(margin);
        colors.push(margin > 0 ? '#2ecc71' : '#e74c3c');
        scoreLabels.push(`${teamScore}-${oppScore}`);
    }

    if (canvas._chart) canvas._chart.destroy();

    canvas._chart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: margins,
                backgroundColor: colors,
                borderColor: 'rgba(255,255,255,0.1)',
                borderWidth: 1,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const i = ctx.dataIndex;
                            const m = margins[i];
                            return `${scoreLabels[i]} (${m > 0 ? '+' : ''}${m})`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: '#8b8fa3',
                        font: { size: 10 },
                        maxRotation: 60,
                        minRotation: 40,
                    },
                    grid: { display: false }
                },
                y: {
                    ticks: { color: '#8b8fa3' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    title: {
                        display: true,
                        text: 'Point Margin',
                        color: '#8b8fa3',
                    }
                }
            }
        },
        plugins: [{
            id: 'scoreLabels',
            afterDatasetsDraw(chart) {
                const { ctx: c, scales: { x, y } } = chart;
                c.font = 'bold 9px sans-serif';
                c.fillStyle = '#e4e6f0';
                c.textAlign = 'center';
                chart.data.datasets[0].data.forEach((val, i) => {
                    const xPos = x.getPixelForValue(i);
                    const yPos = y.getPixelForValue(val);
                    const offset = val > 0 ? -6 : 10;
                    c.fillText(scoreLabels[i], xPos, yPos + offset);
                });
            }
        }]
    });
}
