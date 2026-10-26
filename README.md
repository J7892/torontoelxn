# Toronto Mayoral Election Results Dashboard 🗳️

A real-time web dashboard for tracking and analyzing the Toronto Mayoral Election results, with a primary focus on the **Olivia Chow vs. Brad Bradford** head-to-head race and the top 5 mayoral candidates.

🌐 **Live Dashboard:** [https://j7892.github.io/torontoelxn/](https://j7892.github.io/torontoelxn/)

---

## Features

- **Head-to-Head Showdown (Olivia Chow vs. Brad Bradford)**:
  - Live vote tallies, percentage shares, and two-way margin calculation.
  - Wards led scoreboard comparing Chow and Bradford across all 25 city wards.
  - Dynamic margin meter and vote share gauge.
- **Top 5 Mayoral Candidates Leaderboard**:
  - Filtered view spotlighting the top 5 candidates (out of 50+ candidates) to focus on the key contenders.
  - Rank, candidate name, vote count, vote share percentage, and proportional progress bars.
  - Optional toggle to view the full list of candidates.
- **Interactive Choropleth Ward Map (Leaflet.js)**:
  - Uses the official City of Toronto 25-ward boundary shapefiles (WGS84 GeoJSON).
  - Multi-mode map rendering:
    - **Chow vs Bradford Margin**: Color intensity scaled to vote margin.
    - **Ward Winner**: Visualizes the winning candidate in each district.
    - **Polls Reporting**: Turnout and reporting progress choropleth.
  - Interactive hover tooltips and click-to-inspect ward drill-downs.
- **Ward Inspector Panel**:
  - Deep-dive metrics into any selected ward: total votes, turnout, reporting percentage, Chow vs Bradford split, and top 5 ward candidates.
- **Ward-by-Ward Comparison Table**:
  - Searchable by ward name or number, with quick filter pills (`All Wards`, `Chow Leading`, `Bradford Leading`, `Battlegrounds`).
  - Click any row to automatically zoom and inspect on the map.
- **Key Battlegrounds Spotlight**:
  - Identifies the 5 tightest districts where the election is closest.
- **Vote Progression Timeline**:
  - Line chart powered by Chart.js displaying historical scrape snapshots as ballots are counted.
- **100% Cloud Scraping with GitHub Actions**:
  - Automated Python scraper runs on a recurring cron (`*/3 * * * *`) in GitHub Actions.
  - Fetches official JSON feeds from `electionresults.toronto.ca`, formats data, and pushes live updates to GitHub Pages automatically.

---

## Data Sources

1. **City of Toronto Election Results Portal**:
   - Official live results: [https://electionresults.toronto.ca/](https://electionresults.toronto.ca/)
   - JSON Feed Endpoints:
     - `https://electionresults.toronto.ca/results/unofficialresult.json`
     - `https://electionresults.toronto.ca/results/unofficialresult-wardbyward.json`
2. **City of Toronto Open Data — City Wards Dataset**:
   - 25-Ward Model Shapefiles / GeoJSON: [https://open.toronto.ca/dataset/city-wards/](https://open.toronto.ca/dataset/city-wards/)

---

## Project Structure

```
├── .github/
│   └── workflows/
│       └── scrape_and_deploy.yml   # Scheduled GitHub Actions scraper & deployer
├── data/
│   ├── latest.json                 # Clean, processed data for dashboard
│   ├── toronto_wards.geojson       # 25-ward WGS84 GeoJSON boundaries
│   ├── history.json                # Historical progression snapshots
│   ├── unofficialresult.json       # Raw city-wide election snapshot
│   └── unofficialresult-wardbyward.json # Raw ward-by-ward election snapshot
├── scripts/
│   └── scrape.py                   # Automated scraper & analytics transformer
├── index.html                      # Dashboard UI markup
├── style.css                       # Responsive dark-theme styling
├── app.js                          # Client-side map, charting & auto-refresh logic
└── README.md                       # Documentation
```

---

## Local Development & Testing

1. **Run the Scraper locally**:
   ```bash
   python3 scripts/scrape.py
   ```

2. **Serve the Dashboard locally**:
   ```bash
   python3 -m http.server 8000
   ```
   Open `http://localhost:8000` in your web browser.

---

## Automated Deployment & Cloud Scraping

The GitHub Actions workflow is defined in `.github/workflows/scrape_and_deploy.yml`:
- Triggered automatically every 3 minutes.
- Can be manually triggered via the **Actions** tab in GitHub (**Run workflow**).
- Automatically updates `data/latest.json` and deploys directly to GitHub Pages.
