#!/usr/bin/env python3
"""Fetch tomorrow's NCAA men's basketball games from ESPN and pair with predictions."""

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import urlopen, Request

SCOREBOARD_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/"
    "mens-college-basketball/scoreboard"
)

ROOT = Path(__file__).resolve().parent.parent
PREDICTIONS_PATH = ROOT / "data" / "predictions.json"
OUTPUT_PATH = ROOT / "data" / "upcoming.json"


def fetch_scoreboard(date_str):
    """Fetch all D1 games for a given YYYYMMDD date."""
    url = f"{SCOREBOARD_URL}?limit=500&groups=50&dates={date_str}"
    req = Request(url, headers={"User-Agent": "marchbot-web/1.0"})
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def parse_games(data):
    """Extract game info from ESPN scoreboard response."""
    games = []
    for event in data.get("events", []):
        competition = event["competitions"][0]
        competitors = competition["competitors"]

        home = away = None
        for c in competitors:
            team_info = {
                "id": c["team"]["id"],
                "name": c["team"]["displayName"],
                "abbreviation": c["team"].get("abbreviation", ""),
                "logo": c["team"].get("logo", ""),
                "rank": int(c.get("curatedRank", {}).get("current", 99)),
                "seed": c.get("seed", ""),
            }
            if c["homeAway"] == "home":
                home = team_info
            else:
                away = team_info

        if not home or not away:
            continue

        status = competition["status"]["type"]["name"]
        broadcast = ""
        broadcasts = competition.get("broadcasts", [])
        if broadcasts and broadcasts[0].get("names"):
            broadcast = broadcasts[0]["names"][0]

        time_str = event.get("date", "")
        venue = competition.get("venue", {}).get("fullName", "")
        neutral = competition.get("neutralSite", False)

        games.append({
            "id": event["id"],
            "time": time_str,
            "status": status,
            "venue": venue,
            "neutral_site": neutral,
            "broadcast": broadcast,
            "home": home,
            "away": away,
        })

    return games


def attach_predictions(games, predictions):
    """Attach win probability to each game from predictions.json."""
    matchups = predictions.get("matchups", {})

    for game in games:
        home_id = int(game["home"]["id"])
        away_id = int(game["away"]["id"])
        smaller = min(home_id, away_id)
        larger = max(home_id, away_id)
        key = f"{smaller}_{larger}"

        if key in matchups:
            smaller_win_prob = matchups[key]
            game["home"]["win_prob"] = round(
                smaller_win_prob if home_id == smaller else 1 - smaller_win_prob, 4
            )
            game["away"]["win_prob"] = round(1 - game["home"]["win_prob"], 4)
        else:
            game["home"]["win_prob"] = None
            game["away"]["win_prob"] = None

    return games


def main():
    # Default to tomorrow, or accept YYYYMMDD as argument
    if len(sys.argv) > 1:
        date_str = sys.argv[1]
    else:
        tomorrow = datetime.now() + timedelta(days=1)
        date_str = tomorrow.strftime("%Y%m%d")

    display_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
    print(f"Fetching games for {display_date}...")

    data = fetch_scoreboard(date_str)
    games = parse_games(data)
    print(f"Found {len(games)} games")

    # Load predictions
    if PREDICTIONS_PATH.exists():
        with open(PREDICTIONS_PATH) as f:
            predictions = json.load(f)
        games = attach_predictions(games, predictions)
        predicted = sum(1 for g in games if g["home"]["win_prob"] is not None)
        print(f"Attached predictions to {predicted}/{len(games)} games")
    else:
        print("Warning: predictions.json not found, no predictions attached")

    # Sort: ranked matchups first, then by broadcast, then by time
    def sort_key(g):
        home_rank = g["home"]["rank"] if g["home"]["rank"] < 99 else 999
        away_rank = g["away"]["rank"] if g["away"]["rank"] < 99 else 999
        best_rank = min(home_rank, away_rank)
        has_broadcast = 0 if g["broadcast"] else 1
        return (best_rank, has_broadcast, g["time"])

    games.sort(key=sort_key)

    output = {
        "date": display_date,
        "generated": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "games": games,
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Wrote {OUTPUT_PATH} ({len(games)} games)")


if __name__ == "__main__":
    main()
