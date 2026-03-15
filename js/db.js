let db = null;

export async function initDB(onProgress) {
    const sqlPromise = initSqlJs({
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
    });

    // Fetch and decompress the gzipped database
    const response = await fetch('data/web.db.gz');
    const contentLength = +response.headers.get('Content-Length') || 0;

    let received = 0;
    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (onProgress && contentLength) {
            onProgress(received / contentLength);
        }
    }

    // Combine chunks
    const compressed = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        compressed.set(chunk, offset);
        offset += chunk.length;
    }

    // Decompress using browser-native DecompressionStream
    if (onProgress) onProgress(0.95);
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(compressed);
    writer.close();

    const decompressedChunks = [];
    const decompReader = ds.readable.getReader();
    while (true) {
        const { done, value } = await decompReader.read();
        if (done) break;
        decompressedChunks.push(value);
    }

    let totalLen = 0;
    for (const c of decompressedChunks) totalLen += c.length;
    const decompressed = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of decompressedChunks) {
        decompressed.set(c, pos);
        pos += c.length;
    }

    const SQL = await sqlPromise;
    db = new SQL.Database(decompressed);
    if (onProgress) onProgress(1);
    return db;
}

function query(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

export function getTeams() {
    return query("SELECT team_id, team_name FROM teams ORDER BY team_name");
}

export function getTeam(teamId) {
    const rows = query("SELECT team_id, team_name FROM teams WHERE team_id = ?", [teamId]);
    return rows[0] || null;
}

export function getTeamGames(teamId) {
    return query(`
        SELECT * FROM games
        WHERE home_team_id = ? OR away_team_id = ?
        ORDER BY date
    `, [teamId, teamId]);
}

export function getTeamTopPlayers(teamId, topN = 8) {
    return query(`
        SELECT pgs.athlete_id,
               a.display_name, a.position,
               COUNT(*) as games,
               SUM(pgs.minutes) as total_min,
               ROUND(AVG(pgs.points), 1) as ppg,
               ROUND(AVG(pgs.rebounds), 1) as rpg,
               ROUND(AVG(pgs.assists), 1) as apg,
               ROUND(AVG(pgs.steals), 1) as spg,
               ROUND(AVG(pgs.blocks), 1) as bpg,
               SUM(pgs.fg_made) as total_fgm,
               SUM(pgs.fg_att) as total_fga,
               SUM(pgs.three_made) as total_3m,
               SUM(pgs.three_att) as total_3a,
               SUM(pgs.ft_made) as total_ftm,
               SUM(pgs.ft_att) as total_fta,
               SUM(pgs.turnovers) as total_to,
               SUM(pgs.points) as total_pts,
               AVG(pgs.minutes) as avg_min
        FROM player_game_stats pgs
        JOIN athletes a ON pgs.athlete_id = a.athlete_id
        WHERE pgs.team_id = ?
        GROUP BY pgs.athlete_id
        HAVING games >= 3
        ORDER BY total_min DESC
        LIMIT ?
    `, [teamId, topN]);
}

export function getPlayerShots(athleteId) {
    return query(`
        SELECT coordinate_x, coordinate_y, scoring_play, play_type
        FROM shots
        WHERE athlete_id = ?
          AND coordinate_y BETWEEN -2 AND 35
    `, [athleteId]);
}

export function getPlayer(athleteId) {
    const rows = query("SELECT * FROM athletes WHERE athlete_id = ?", [athleteId]);
    return rows[0] || null;
}

export function getPlayerTeamName(teamId) {
    const rows = query("SELECT team_name FROM teams WHERE team_id = ?", [teamId]);
    return rows[0] ? rows[0].team_name : null;
}

export function searchTeams(q) {
    return query(
        "SELECT team_id, team_name FROM teams WHERE team_name LIKE ? ORDER BY team_name LIMIT 10",
        [`%${q}%`]
    );
}

export function getTeamStats(teamId) {
    const rows = query(`
        SELECT
            COUNT(*) as games,
            SUM(CASE WHEN (home_team_id = ? AND home_score > away_score)
                       OR (away_team_id = ? AND away_score > home_score) THEN 1 ELSE 0 END) as wins,
            ROUND(AVG(CASE WHEN home_team_id = ? THEN home_score ELSE away_score END), 1) as ppg,
            ROUND(AVG(CASE WHEN home_team_id = ? THEN away_score ELSE home_score END), 1) as opp_ppg
        FROM games
        WHERE home_team_id = ? OR away_team_id = ?
    `, [teamId, teamId, teamId, teamId, teamId, teamId]);
    return rows[0] || null;
}

export function searchPlayers(q) {
    return query(
        "SELECT athlete_id, display_name, position, last_team_id FROM athletes WHERE display_name LIKE ? ORDER BY display_name LIMIT 10",
        [`%${q}%`]
    );
}
