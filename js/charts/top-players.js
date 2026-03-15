/**
 * Render top players charts: horizontal bars for PPG/RPG/APG, scatter for shooting %.
 * @param {HTMLCanvasElement} barsCanvas
 * @param {HTMLCanvasElement} scatterCanvas
 * @param {Array} players - from getTeamTopPlayers()
 */
export function renderTopPlayersBars(barsCanvas, players) {
    const labels = players.map(p =>
        `${p.display_name} (${p.position || '?'}, ${Math.round(p.avg_min)}m)`
    );

    if (barsCanvas._chart) barsCanvas._chart.destroy();

    barsCanvas._chart = new Chart(barsCanvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'PPG',
                    data: players.map(p => p.ppg),
                    backgroundColor: '#74b9ff',
                },
                {
                    label: 'RPG',
                    data: players.map(p => p.rpg),
                    backgroundColor: '#fdcb6e',
                },
                {
                    label: 'APG',
                    data: players.map(p => p.apg),
                    backgroundColor: '#00b894',
                },
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#000000', font: { size: 11 } }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#000000' },
                    grid: { color: 'rgba(0,0,0,0.1)' },
                    title: { display: true, text: 'Per Game', color: '#000000' }
                },
                y: {
                    ticks: { color: '#000000', font: { size: 11 } },
                    grid: { display: false }
                }
            }
        }
    });
}

export function renderTopPlayersScatter(scatterCanvas, players) {
    // Compute derived shooting stats
    const data = players.map(p => {
        const fga = Math.max(p.total_fga, 1);
        const fta = Math.max(p.total_fta, 1);
        const threeA = Math.max(p['total_3a'], 1);
        const tsDenom = 2 * (fga + 0.44 * p.total_fta);
        return {
            name: p.display_name,
            fg: Math.round(p.total_fgm / fga * 100),
            three: Math.round(p['total_3m'] / threeA * 100),
            ft: Math.round(p.total_ftm / fta * 100),
            ts: Math.round(p.total_pts / Math.max(tsDenom, 1) * 100),
        };
    });

    const labels = players.map(p => p.display_name);

    if (scatterCanvas._chart) scatterCanvas._chart.destroy();

    const datasets = [
        { label: 'TS%', color: '#a29bfe' },
        { label: 'FG%', color: '#74b9ff' },
        { label: '3P%', color: '#e17055' },
        { label: 'FT%', color: '#00b894' },
    ];

    scatterCanvas._chart = new Chart(scatterCanvas, {
        type: 'bar',
        data: {
            labels,
            datasets: datasets.map(ds => ({
                label: ds.label,
                data: data.map(d => {
                    if (ds.label === 'TS%') return d.ts;
                    if (ds.label === 'FG%') return d.fg;
                    if (ds.label === '3P%') return d.three;
                    return d.ft;
                }),
                backgroundColor: ds.color + '80',
                borderColor: ds.color,
                borderWidth: 1,
            }))
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#000000', font: { size: 10 } }
                }
            },
            scales: {
                x: {
                    min: 0,
                    max: 105,
                    ticks: { color: '#000000' },
                    grid: { color: 'rgba(0,0,0,0.1)' },
                    title: { display: true, text: 'Percentage', color: '#000000' }
                },
                y: {
                    ticks: { color: '#000000', font: { size: 11 } },
                    grid: { display: false }
                }
            }
        }
    });
}
