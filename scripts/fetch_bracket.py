#!/usr/bin/env python3
"""Fetch the 2026 NCAA tournament bracket from ESPN scoreboard and output data/bracket.json."""

import json
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen, Request

SCOREBOARD_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball/"
    "mens-college-basketball/scoreboard"
)

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = ROOT / "data" / "bracket.json"


def fetch_scoreboard(date_str):
    url = f"{SCOREBOARD_URL}?limit=500&groups=100&dates={date_str}"
    req = Request(url, headers={"User-Agent": "marchbot-web/1.0"})
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def main():
    print("Fetching NCAA tournament bracket from ESPN scoreboard...")

    all_events = []
    for date_str in ["20260317", "20260318", "20260319", "20260320", "20260321"]:
        try:
            data = fetch_scoreboard(date_str)
            events = data.get("events", [])
            all_events.extend(events)
            print(f"  {date_str}: {len(events)} events")
        except Exception as e:
            print(f"  {date_str}: error - {e}")

    # Separate First Four from R64 games
    first_four = []
    r64_games = []  # list of (region, teamA, teamB)

    for event in all_events:
        comp = event["competitions"][0]
        notes = comp.get("notes", [])
        headline = notes[0].get("headline", "") if notes else ""

        region = ""
        for r in ["South", "East", "Midwest", "West"]:
            if r.lower() in headline.lower():
                region = r
                break
        if not region:
            continue

        is_first_four = "first four" in headline.lower()

        teams = []
        for c in comp["competitors"]:
            team = c["team"]
            rank = c.get("curatedRank", {}).get("current", 99)
            seed = rank if 1 <= rank <= 16 else 16
            team_id = str(team["id"])
            logo = team.get("logo", f"https://a.espncdn.com/i/teamlogos/ncaa/500/{team_id}.png")
            teams.append({
                "id": team_id,
                "name": team["displayName"],
                "seed": seed,
                "logo": logo,
            })

        if len(teams) != 2:
            continue

        if is_first_four:
            first_four.append({
                "seed": teams[0]["seed"],
                "region": region,
                "teamA": teams[0],
                "teamB": teams[1],
            })
        else:
            r64_games.append((region, teams[0], teams[1]))

    # Build teams from R64 matchups — keeps pairs in matchup order
    # Also resolve TBD teams using First Four data
    ff_by_region_seed = {}
    for ff in first_four:
        key = (ff["region"], ff["seed"])
        ff_by_region_seed[key] = ff

    regions = ["South", "East", "Midwest", "West"]
    ordered_teams = {r: [] for r in regions}
    seen_ids = {r: set() for r in regions}

    for region, teamA, teamB in r64_games:
        for t in [teamA, teamB]:
            # Replace TBD with First Four teamA
            if t["id"] == "-2" or t["name"] == "TBD":
                # Try exact seed match first, then any unmatched FF in this region
                ff_key = (region, t["seed"])
                matched_ff = ff_by_region_seed.get(ff_key)
                if not matched_ff:
                    # Try any unmatched First Four in this region
                    for ff in first_four:
                        if ff["region"] == region and (region, ff["seed"]) not in ff_by_region_seed:
                            continue
                        if ff["region"] == region:
                            matched_ff = ff
                            break
                if matched_ff:
                    t.update(matched_ff["teamA"])
                    t["seed"] = matched_ff["seed"]
                    print(f"  Replaced TBD in {region} with ({t['seed']}) {t['name']}")

        if teamA["id"] not in seen_ids[region]:
            ordered_teams[region].append(teamA)
            seen_ids[region].add(teamA["id"])
        if teamB["id"] not in seen_ids[region]:
            ordered_teams[region].append(teamB)
            seen_ids[region].add(teamB["id"])

    # For regions with missing matchups (e.g. 6v11 when 11 is a First Four game),
    # find the gap and insert the First Four team
    for region in regions:
        team_list = ordered_teams[region]
        if len(team_list) < 16:
            # Find seeds present
            present_seeds = [t["seed"] for t in team_list]
            for ff in first_four:
                if ff["region"] == region:
                    # Check if neither FF team is in the bracket
                    a_in = ff["teamA"]["id"] in seen_ids[region]
                    b_in = ff["teamB"]["id"] in seen_ids[region]
                    if not a_in and len(team_list) < 16:
                        team_list.append(ff["teamA"])
                        seen_ids[region].add(ff["teamA"]["id"])
                        print(f"  Added FF team {ff['teamA']['name']} to {region}")

        # Ensure even number of teams (pad if needed)
        if len(team_list) % 2 != 0 and len(team_list) < 16:
            for ff in first_four:
                if ff["region"] == region:
                    for ft in [ff["teamA"], ff["teamB"]]:
                        if ft["id"] not in seen_ids[region]:
                            team_list.append(ft)
                            seen_ids[region].add(ft["id"])
                            print(f"  Padded FF team {ft['name']} to {region}")
                            break
                    if len(team_list) % 2 == 0:
                        break

    bracket = {
        "year": 2026,
        "regions": regions,
        "firstFour": first_four,
        "teams": ordered_teams,
    }

    # Report
    total = 0
    for region in regions:
        team_list = ordered_teams[region]
        total += len(team_list)
        print(f"\n  {region}: {len(team_list)} teams")
        for i in range(0, len(team_list), 2):
            a = team_list[i]
            b = team_list[i + 1] if i + 1 < len(team_list) else None
            if b:
                print(f"    ({a['seed']}) {a['name']}  vs  ({b['seed']}) {b['name']}")
            else:
                print(f"    ({a['seed']}) {a['name']}  vs  ???")

    print(f"\nFirst Four: {len(first_four)} games")
    for ff in first_four:
        print(f"  ({ff['seed']}) {ff['teamA']['name']} vs {ff['teamB']['name']} ({ff['region']})")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(bracket, f, indent=2)
    print(f"\nWrote {OUTPUT_PATH} ({total} teams)")


if __name__ == "__main__":
    main()
