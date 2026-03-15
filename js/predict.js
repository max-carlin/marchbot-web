let predictions = null;

export async function loadPredictions() {
    const resp = await fetch('data/predictions.json');
    predictions = await resp.json();
    return predictions;
}

export function getPrediction(teamId1, teamId2) {
    if (!predictions || !predictions.matchups) return null;

    const id1 = parseInt(teamId1);
    const id2 = parseInt(teamId2);
    const smaller = Math.min(id1, id2);
    const larger = Math.max(id1, id2);
    const key = `${smaller}_${larger}`;

    if (!(key in predictions.matchups)) return null;

    const smallerWinProb = predictions.matchups[key];

    // Return P(team1 wins)
    if (id1 === smaller) {
        return smallerWinProb;
    } else {
        return 1 - smallerWinProb;
    }
}

export function getPredictionTeams() {
    if (!predictions || !predictions.teams) return {};
    return predictions.teams;
}

export function getGeneratedDate() {
    return predictions ? predictions.generated : null;
}
