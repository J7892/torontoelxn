#!/usr/bin/env python3
"""
Toronto Election Results Scraper
Fetches live election results from City of Toronto's election results portal:
- https://electionresults.toronto.ca/results/unofficialresult.json
- https://electionresults.toronto.ca/results/unofficialresult-wardbyward.json

Processes citywide mayoral results, top 5 candidates, and head-to-head Olivia Chow vs Brad Bradford metrics.
Outputs clean structured JSON for the frontend dashboard.
"""

import sys
import os
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

BASE_URL = "https://electionresults.toronto.ca/results"
UNOFFICIAL_URL = f"{BASE_URL}/unofficialresult.json"
WARDBYWARD_URL = f"{BASE_URL}/unofficialresult-wardbyward.json"
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

HEADERS = {
    "User-Agent": "TorontoElectionTracker/1.0 (+https://github.com/J7892/torontoelxn)",
    "Accept": "application/json, text/plain, */*",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

def fetch_json(url):
    cache_bust = f"v={int(datetime.now(timezone.utc).timestamp()*1000)}"
    req = urllib.request.Request(f"{url}?{cache_bust}", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))

def safe_int(val, default=0):
    try:
        if val is None or val == "":
            return default
        return int(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return default

def safe_float(val, default=0.0):
    try:
        if val is None or val == "":
            return default
        return round(float(str(val).replace(",", "").replace("%", "").strip()), 2)
    except (ValueError, TypeError):
        return default

def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    print(f"[{datetime.now(timezone.utc).isoformat()}] Fetching election results...")

    use_cached = "--use-cached" in sys.argv
    raw_unofficial = None
    raw_wbw = None

    if not use_cached:
        try:
            raw_unofficial = fetch_json(UNOFFICIAL_URL)
            print("  Fetched unofficialresult.json successfully")
        except Exception as e:
            print(f"  Error fetching unofficialresult.json: {e}", file=sys.stderr)

        try:
            raw_wbw = fetch_json(WARDBYWARD_URL)
            print("  Fetched unofficialresult-wardbyward.json successfully")
        except Exception as e:
            print(f"  Error fetching unofficialresult-wardbyward.json: {e}", file=sys.stderr)

    if use_cached:
        u_path = os.path.join(DATA_DIR, "unofficialresult.json")
        w_path = os.path.join(DATA_DIR, "unofficialresult-wardbyward.json")
        if os.path.exists(u_path):
            with open(u_path, "r", encoding="utf-8") as f:
                raw_unofficial = json.load(f)
        if os.path.exists(w_path):
            with open(w_path, "r", encoding="utf-8") as f:
                raw_wbw = json.load(f)

    if not raw_unofficial and not raw_wbw:
        print("Failed to fetch both endpoints. Exiting.", file=sys.stderr)
        sys.exit(1)

    # Save raw files for archival/debugging
    if raw_unofficial and not use_cached:
        with open(os.path.join(DATA_DIR, "unofficialresult.json"), "w", encoding="utf-8") as f:
            json.dump(raw_unofficial, f, indent=2)

    if raw_wbw and not use_cached:
        with open(os.path.join(DATA_DIR, "unofficialresult-wardbyward.json"), "w", encoding="utf-8") as f:
            json.dump(raw_wbw, f, indent=2)

    # Find Mayor and Councillor races in raw_unofficial
    mayor_office = None
    councillor_office = None
    if raw_unofficial and "office" in raw_unofficial:
        for off in raw_unofficial["office"]:
            off_name = off.get("name", "").strip().lower()
            if off_name == "mayor":
                mayor_office = off
            elif off_name == "councillor":
                councillor_office = off
        if not mayor_office and len(raw_unofficial["office"]) > 0:
            mayor_office = raw_unofficial["office"][0]

    citywide_ward = None
    if mayor_office and "ward" in mayor_office and len(mayor_office["ward"]) > 0:
        citywide_ward = mayor_office["ward"][0]

    # Process City-Wide Stats
    total_polls = safe_int(citywide_ward.get("polls")) if citywide_ward else 1431
    polls_reported = safe_int(citywide_ward.get("pollsReceived")) if citywide_ward else 0
    polls_pct = round((polls_reported / total_polls * 100), 2) if total_polls > 0 else 0.0

    total_voters = safe_int(citywide_ward.get("totalVoters")) if citywide_ward else 2143771
    citywide_votes = safe_int(citywide_ward.get("votesReceived")) if citywide_ward else 0

    # Parse all candidates
    candidates_raw = citywide_ward.get("candidate", []) if citywide_ward else []
    all_candidates = []
    chow_raw = None
    bradford_raw = None

    for c in candidates_raw:
        c_name = c.get("name", "").strip()
        c_votes = safe_int(c.get("votesReceived", 0))
        c_pct = safe_float(c.get("percentage", 0.0))
        item = {
            "name": c_name,
            "votes": c_votes,
            "percentage": c_pct
        }
        all_candidates.append(item)
        if c_name.lower() == "olivia chow":
            chow_raw = item
        elif c_name.lower() == "brad bradford":
            bradford_raw = item

    # Sort all candidates by votes descending
    all_candidates.sort(key=lambda x: x["votes"], reverse=True)

    # Calculate actual percentage if total_votes > 0 and percentage wasn't computed
    calc_total_votes = sum(c["votes"] for c in all_candidates)
    if calc_total_votes > 0 and citywide_votes == 0:
        citywide_votes = calc_total_votes

    for i, c in enumerate(all_candidates):
        c["rank"] = i + 1
        if citywide_votes > 0:
            c["percentage"] = round((c["votes"] / citywide_votes * 100), 2)

    top5 = all_candidates[:5]
    for c in top5:
        leader_votes = top5[0]["votes"]
        c["margin_from_leader"] = c["votes"] - leader_votes

    # Process Ward-by-Ward Data
    wards_dict = {}
    wbw_candidates = raw_wbw.get("office", {}).get("candidate", []) if raw_wbw else []

    # Initialize all 25 wards
    for w_num in range(1, 26):
        wards_dict[w_num] = {
            "ward_num": w_num,
            "ward_name": "",
            "polls_total": 0,
            "polls_reported": 0,
            "polls_reporting_pct": 0.0,
            "total_votes": 0,
            "registered_voters": 0,
            "turnout_pct": 0.0,
            "candidates": {},
            "chow": {"votes": 0, "percentage": 0.0},
            "bradford": {"votes": 0, "percentage": 0.0},
            "head_to_head_margin": 0,
            "head_to_head_margin_pct": 0.0,
            "leader": "Pending",
            "top5": [],
            "council": {
                "polls_total": 0,
                "polls_reported": 0,
                "polls_reporting_pct": 0.0,
                "total_votes": 0,
                "candidates_count": 0,
                "leader": "Pending",
                "runner_up": "",
                "margin_votes": 0,
                "margin_pct": 0.0,
                "is_close_race": False,
                "top3": [],
                "all_candidates": []
            }
        }

    # Process Councillor Ward Data from raw_unofficial
    if councillor_office and "ward" in councillor_office:
        for cw in councillor_office["ward"]:
            w_num = safe_int(cw.get("num"))
            if w_num not in wards_dict:
                continue
            wd = wards_dict[w_num]
            if not wd["ward_name"] and cw.get("name"):
                wd["ward_name"] = cw.get("name")
            if wd["registered_voters"] == 0 and cw.get("totalVoters"):
                wd["registered_voters"] = safe_int(cw.get("totalVoters"))
            if wd["polls_total"] == 0 and cw.get("polls"):
                wd["polls_total"] = safe_int(cw.get("polls"))

            c_polls_total = safe_int(cw.get("polls"))
            c_polls_reported = safe_int(cw.get("pollsReceived"))
            c_polls_pct = round((c_polls_reported / c_polls_total * 100), 2) if c_polls_total > 0 else 0.0
            c_total_votes = safe_int(cw.get("votesReceived"))

            c_cands_raw = cw.get("candidate", [])
            c_cands = []
            for cc in c_cands_raw:
                cc_name = cc.get("name", "").strip()
                cc_votes = safe_int(cc.get("votesReceived", 0))
                cc_pct = safe_float(cc.get("percentage", 0.0))
                c_cands.append({
                    "name": cc_name,
                    "votes": cc_votes,
                    "percentage": cc_pct
                })

            sum_c_votes = sum(x["votes"] for x in c_cands)
            if sum_c_votes > c_total_votes:
                c_total_votes = sum_c_votes

            # Sort by votes descending, then alphabetically by name
            c_cands.sort(key=lambda x: (-x["votes"], x["name"]))
            for idx, cc in enumerate(c_cands, 1):
                cc["rank"] = idx
                if c_total_votes > 0:
                    cc["percentage"] = round((cc["votes"] / c_total_votes * 100), 2)

            top3_council = c_cands[:3]
            c_leader = "Pending"
            c_runner_up = c_cands[1]["name"] if len(c_cands) > 1 else ""
            c_margin_votes = 0
            c_margin_pct = 0.0
            c_is_close = False

            if c_polls_reported > 0 or c_total_votes > 0:
                if len(c_cands) >= 2:
                    c_margin_votes = c_cands[0]["votes"] - c_cands[1]["votes"]
                    c_margin_pct = round(c_cands[0]["percentage"] - c_cands[1]["percentage"], 2)
                    if c_cands[0]["votes"] > 0 and c_cands[0]["votes"] == c_cands[1]["votes"]:
                        c_leader = "Tied"
                    elif c_cands[0]["votes"] > 0:
                        c_leader = c_cands[0]["name"]
                    c_is_close = (c_total_votes > 0 and c_margin_pct <= 5.0)
                elif len(c_cands) == 1 and c_cands[0]["votes"] > 0:
                    c_leader = c_cands[0]["name"]
                    c_margin_votes = c_cands[0]["votes"]
                    c_margin_pct = c_cands[0]["percentage"]

            wd["council"] = {
                "polls_total": c_polls_total,
                "polls_reported": c_polls_reported,
                "polls_reporting_pct": c_polls_pct,
                "total_votes": c_total_votes,
                "candidates_count": len(c_cands),
                "leader": c_leader,
                "runner_up": c_runner_up,
                "margin_votes": c_margin_votes,
                "margin_pct": c_margin_pct,
                "is_close_race": c_is_close,
                "top3": top3_council,
                "all_candidates": c_cands
            }

    for c in wbw_candidates:
        c_name = c.get("name", "").strip()
        for w in c.get("ward", []):
            w_num = safe_int(w.get("num"))
            if w_num not in wards_dict:
                continue
            wd = wards_dict[w_num]
            if not wd["candidates"]:
                wd["ward_name"] = w.get("name", wd["ward_name"] or f"Ward {w_num}")
                wd["polls_total"] = safe_int(w.get("polls")) or wd["polls_total"]
                wd["polls_reported"] = safe_int(w.get("pollsReceived"))
                wd["registered_voters"] = safe_int(w.get("totalVoters")) or wd["registered_voters"]
                wd["total_votes"] = safe_int(w.get("votesCounted"))

            c_ward_votes = safe_int(w.get("votesReceived"))
            wd["candidates"][c_name] = c_ward_votes

    # Process per-ward analytics
    chow_wards_leading = 0
    bradford_wards_leading = 0
    other_wards_leading = 0

    wards_list = []
    for w_num in sorted(wards_dict.keys()):
        wd = wards_dict[w_num]
        
        # Calculate reporting pct
        if wd["polls_total"] > 0:
            wd["polls_reporting_pct"] = round((wd["polls_reported"] / wd["polls_total"] * 100), 2)
            
        # Sum votes if total_votes is 0
        summed_votes = sum(wd["candidates"].values())
        if summed_votes > wd["total_votes"]:
            wd["total_votes"] = summed_votes

        if wd["registered_voters"] > 0 and wd["total_votes"] > 0:
            wd["turnout_pct"] = round((wd["total_votes"] / wd["registered_voters"] * 100), 2)

        # Candidate breakdown for this ward
        ward_cand_sorted = sorted(wd["candidates"].items(), key=lambda x: x[1], reverse=True)
        top5_ward = []
        for rank, (cand_name, c_votes) in enumerate(ward_cand_sorted[:5], 1):
            pct = round((c_votes / wd["total_votes"] * 100), 2) if wd["total_votes"] > 0 else 0.0
            top5_ward.append({
                "rank": rank,
                "name": cand_name,
                "votes": c_votes,
                "percentage": pct
            })
        wd["top5"] = top5_ward

        # Olivia Chow and Brad Bradford in this ward
        chow_v = wd["candidates"].get("Olivia Chow", 0)
        bradford_v = wd["candidates"].get("Brad Bradford", 0)
        
        chow_pct = round((chow_v / wd["total_votes"] * 100), 2) if wd["total_votes"] > 0 else 0.0
        bradford_pct = round((bradford_v / wd["total_votes"] * 100), 2) if wd["total_votes"] > 0 else 0.0

        wd["chow"] = {"votes": chow_v, "percentage": chow_pct}
        wd["bradford"] = {"votes": bradford_v, "percentage": bradford_pct}
        wd["head_to_head_margin"] = chow_v - bradford_v
        wd["head_to_head_margin_pct"] = round(chow_pct - bradford_pct, 2)

        # Leader in ward
        if wd["polls_reported"] == 0 and wd["total_votes"] == 0:
            wd["leader"] = "Pending"
        elif chow_v > bradford_v and (not top5_ward or top5_ward[0]["name"] == "Olivia Chow"):
            wd["leader"] = "Olivia Chow"
            chow_wards_leading += 1
        elif bradford_v > chow_v and (not top5_ward or top5_ward[0]["name"] == "Brad Bradford"):
            wd["leader"] = "Brad Bradford"
            bradford_wards_leading += 1
        elif top5_ward and top5_ward[0]["name"] not in ["Olivia Chow", "Brad Bradford"]:
            wd["leader"] = top5_ward[0]["name"]
            other_wards_leading += 1
        elif chow_v == bradford_v and chow_v > 0:
            wd["leader"] = "Tied"
        elif chow_v > bradford_v:
            wd["leader"] = "Olivia Chow"
            chow_wards_leading += 1
        elif bradford_v > chow_v:
            wd["leader"] = "Brad Bradford"
            bradford_wards_leading += 1
        else:
            wd["leader"] = "Pending"

        # Remove raw dictionary to keep JSON payload lean and clean
        del wd["candidates"]
        wards_list.append(wd)

    # Citywide head-to-head metrics
    chow_city_votes = chow_raw["votes"] if chow_raw else 0
    bradford_city_votes = bradford_raw["votes"] if bradford_raw else 0
    chow_city_pct = chow_raw["percentage"] if chow_raw else 0.0
    bradford_city_pct = bradford_raw["percentage"] if bradford_raw else 0.0

    vote_margin = chow_city_votes - bradford_city_votes
    pct_margin = round(chow_city_pct - bradford_city_pct, 2)
    two_way_total = chow_city_votes + bradford_city_votes

    chow_two_way_pct = round((chow_city_votes / two_way_total * 100), 2) if two_way_total > 0 else 50.0
    bradford_two_way_pct = round((bradford_city_votes / two_way_total * 100), 2) if two_way_total > 0 else 50.0

    if polls_reported == 0 and citywide_votes == 0:
        h2h_leader = "Pending"
    elif vote_margin > 0:
        h2h_leader = "Olivia Chow"
    elif vote_margin < 0:
        h2h_leader = "Brad Bradford"
    else:
        h2h_leader = "Tied"

    # Identify Battleground / Closest Wards
    reported_wards = [w for w in wards_list if w["polls_reported"] > 0 and (w["chow"]["votes"] > 0 or w["bradford"]["votes"] > 0)]
    if reported_wards:
        battlegrounds = sorted(reported_wards, key=lambda w: abs(w["head_to_head_margin"]))[:5]
    else:
        battlegrounds = wards_list[:5]

    # Overall turnout
    turnout_pct = round((citywide_votes / total_voters * 100), 2) if total_voters > 0 and citywide_votes > 0 else 0.0

    # Build consolidated latest payload
    latest_payload = {
        "metadata": {
            "last_updated_utc": datetime.now(timezone.utc).isoformat(),
            "election_desc": raw_unofficial.get("electionDesc", "2026 Municipal Election") if raw_unofficial else "2026 Municipal Election",
            "seq": raw_unofficial.get("seq", int(datetime.now(timezone.utc).timestamp()*1000)) if raw_unofficial else int(datetime.now(timezone.utc).timestamp()*1000),
            "status": "Live - Polls Open / Reporting" if polls_reported > 0 else "Awaiting Results - Polls Closing",
            "source_url": "https://electionresults.toronto.ca/"
        },
        "citywide": {
            "total_polls": total_polls,
            "polls_reported": polls_reported,
            "polls_reporting_pct": polls_pct,
            "total_votes": citywide_votes,
            "registered_voters": total_voters,
            "turnout_pct": turnout_pct
        },
        "head_to_head": {
            "leader": h2h_leader,
            "vote_margin": vote_margin,
            "pct_margin": pct_margin,
            "total_head_to_head_votes": two_way_total,
            "chow": {
                "name": "Olivia Chow",
                "votes": chow_city_votes,
                "percentage": chow_city_pct,
                "two_way_percentage": chow_two_way_pct,
                "wards_leading": chow_wards_leading,
                "color": "#e05a1e"
            },
            "bradford": {
                "name": "Brad Bradford",
                "votes": bradford_city_votes,
                "percentage": bradford_city_pct,
                "two_way_percentage": bradford_two_way_pct,
                "wards_leading": bradford_wards_leading,
                "color": "#0d6efd"
            }
        },
        "top5_candidates": top5,
        "all_candidates_count": len(all_candidates),
        "wards": wards_list,
        "battlegrounds": [
            {
                "ward_num": w["ward_num"],
                "ward_name": w["ward_name"],
                "chow_votes": w["chow"]["votes"],
                "bradford_votes": w["bradford"]["votes"],
                "margin": w["head_to_head_margin"],
                "margin_pct": w["head_to_head_margin_pct"],
                "leader": w["leader"]
            }
            for w in battlegrounds
        ]
    }

    latest_path = os.path.join(DATA_DIR, "latest.json")
    with open(latest_path, "w", encoding="utf-8") as f:
        json.dump(latest_payload, f, indent=2)
    print(f"  Wrote {latest_path} ({os.path.getsize(latest_path)} bytes)")

    # History timeline tracking
    history_path = os.path.join(DATA_DIR, "history.json")
    history_entries = []
    if os.path.exists(history_path):
        try:
            with open(history_path, "r", encoding="utf-8") as f:
                history_entries = json.load(f)
        except Exception:
            history_entries = []

    # Only append if polls or votes changed, or if history is empty
    current_point = {
        "time": datetime.now(timezone.utc).isoformat(),
        "polls_reported": polls_reported,
        "polls_pct": polls_pct,
        "total_votes": citywide_votes,
        "chow_votes": chow_city_votes,
        "bradford_votes": bradford_city_votes,
        "chow_pct": chow_city_pct,
        "bradford_pct": bradford_city_pct,
        "margin": vote_margin
    }

    should_append = False
    if not history_entries:
        should_append = True
    else:
        last = history_entries[-1]
        if (last.get("polls_reported") != polls_reported or
            last.get("chow_votes") != chow_city_votes or
            last.get("bradford_votes") != bradford_city_votes):
            should_append = True

    if should_append:
        history_entries.append(current_point)
        # Keep last 150 points
        if len(history_entries) > 150:
            history_entries = history_entries[-150:]
        with open(history_path, "w", encoding="utf-8") as f:
            json.dump(history_entries, f, indent=2)
        print(f"  Updated {history_path} with new timeline entry")

    print(f"Scrape completed successfully! Polls: {polls_reported}/{total_polls} ({polls_pct}%), Votes: {citywide_votes:,}")
    print(f"Chow: {chow_city_votes:,} ({chow_city_pct}%) vs Bradford: {bradford_city_votes:,} ({bradford_city_pct}%) | Leader: {h2h_leader}")

if __name__ == "__main__":
    main()
