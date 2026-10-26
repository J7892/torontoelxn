/**
 * Toronto Election Results Dashboard Application
 * Handles data fetching, live state updates, Leaflet mapping, and race analytics.
 */

// Global State
let electionData = null;
let geojsonData = null;
let historyData = null;
let leafletMap = null;
let geojsonLayer = null;
let currentMapView = 'margin'; // 'margin' | 'winner' | 'turnout'
let selectedWardNum = null;
let historyChart = null;
let autoRefreshTimer = null;
let autoRefreshIntervalSec = 45;
let isRefreshing = false;

// Color scales
const COLORS = {
  chow: {
    strong: '#c2410c',   // >15% lead
    medium: '#ea580c',   // 5-15% lead
    lean: '#fb923c',     // <5% lead
    light: '#fdba74'
  },
  bradford: {
    strong: '#1d4ed8',   // >15% lead
    medium: '#2563eb',   // 5-15% lead
    lean: '#60a5fa',     // <5% lead
    light: '#93c5fd'
  },
  neutral: '#334155',
  pending: '#1e293b',
  border: '#475569',
  borderHighlight: '#f8fafc'
};

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupEventListeners();
  loadAllData();
  startAutoRefresh();
});

/**
 * Initialize Leaflet Map
 */
function initMap() {
  // Center roughly on Toronto (43.70, -79.38)
  leafletMap = L.map('map', {
    center: [43.71, -79.38],
    zoom: 11,
    minZoom: 10,
    maxZoom: 15,
    zoomControl: true,
    attributionControl: false
  });

  // Base CartoDB Dark Matter / Positron tiles for a sleek civic dashboard
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(leafletMap);

  L.control.attribution({ position: 'bottomright' })
    .addAttribution('&copy; <a href="https://open.toronto.ca">City of Toronto Open Data</a>')
    .addTo(leafletMap);
}

/**
 * Setup UI Event Listeners
 */
function setupEventListeners() {
  // Map View Toggles
  document.querySelectorAll('.map-view-toggles .toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.map-view-toggles .toggle-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentMapView = e.target.dataset.view;
      updateMapStyles();
      updateMapLegend();
    });
  });

  // Reset Map View Button
  const resetBtn = document.getElementById('btnResetMap');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (geojsonLayer) {
        leafletMap.fitBounds(geojsonLayer.getBounds(), { padding: [20, 20] });
      }
      clearSelectedWard();
    });
  }

  // Manual Refresh Button
  const refreshBtn = document.getElementById('btnRefresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshData();
    });
  }

  // Auto-refresh Toggle
  const autoCheckbox = document.getElementById('chkAutoRefresh');
  if (autoCheckbox) {
    autoCheckbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        startAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    });
  }

  // Table Search Input
  const searchInput = document.getElementById('tableSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderWardTable();
    });
  }

  // Table Filter Pills
  document.querySelectorAll('.filter-pills .filter-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-pills .filter-pill').forEach(p => p.classList.remove('active'));
      e.target.classList.add('active');
      renderWardTable();
    });
  });

  // Toggle full candidates list
  const toggleFullBtn = document.getElementById('btnToggleAllCandidates');
  if (toggleFullBtn) {
    toggleFullBtn.addEventListener('click', () => {
      const fullList = document.getElementById('fullCandidatesList');
      if (fullList) {
        const isHidden = fullList.classList.toggle('hidden');
        toggleFullBtn.textContent = isHidden ? 'Show full candidate list (53 candidates)' : 'Hide full candidate list';
      }
    });
  }
}

/**
 * Fetch all initial data files in parallel
 */
async function loadAllData() {
  setLoadingState(true);
  try {
    const timestamp = Date.now();
    const [latestRes, geoRes, historyRes] = await Promise.all([
      fetch(`data/latest.json?t=${timestamp}`),
      fetch(`data/toronto_wards.geojson?t=${timestamp}`),
      fetch(`data/history.json?t=${timestamp}`).catch(() => null)
    ]);

    if (!latestRes.ok) throw new Error(`HTTP ${latestRes.status} loading latest.json`);
    electionData = await latestRes.json();

    if (!geoRes.ok) throw new Error(`HTTP ${geoRes.status} loading toronto_wards.geojson`);
    geojsonData = await geoRes.json();

    if (historyRes && historyRes.ok) {
      historyData = await historyRes.json();
    } else {
      historyData = [];
    }

    renderDashboard();
  } catch (err) {
    console.error('Error loading election data:', err);
    showNotification('Error loading election data. Please check connection.', 'error');
  } finally {
    setLoadingState(false);
  }
}

/**
 * Refresh data silently (called by interval or button)
 */
async function refreshData() {
  if (isRefreshing) return;
  isRefreshing = true;
  setRefreshIconSpinning(true);

  try {
    const timestamp = Date.now();
    const [latestRes, historyRes] = await Promise.all([
      fetch(`data/latest.json?t=${timestamp}`),
      fetch(`data/history.json?t=${timestamp}`).catch(() => null)
    ]);

    if (latestRes.ok) {
      electionData = await latestRes.json();
      if (historyRes && historyRes.ok) {
        historyData = await historyRes.json();
      }
      renderDashboard();
      showNotification('Election results updated', 'success');
    }
  } catch (err) {
    console.warn('Silent refresh failed:', err);
  } finally {
    isRefreshing = false;
    setRefreshIconSpinning(false);
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(refreshData, autoRefreshIntervalSec * 1000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

/**
 * Main Render Coordinator
 */
function renderDashboard() {
  if (!electionData) return;

  renderHeaderAndTicker();
  renderShowdown();
  renderTop5Candidates();
  renderGeoJSONLayer();
  renderBattlegrounds();
  renderWardTable();
  renderHistoryChart();

  // If a ward was previously selected, re-inspect it with updated numbers
  if (selectedWardNum) {
    inspectWard(selectedWardNum);
  } else {
    // Default inspect Ward 10 or City Leader
    inspectWard(10);
  }
}

/**
 * Render Header and Summary Ticker
 */
function renderHeaderAndTicker() {
  const meta = electionData.metadata || {};
  const city = electionData.citywide || {};

  // Status Pill
  const statusEl = document.getElementById('liveStatusPill');
  const statusText = document.getElementById('liveStatusText');
  if (statusEl && statusText) {
    if (city.polls_reported > 0) {
      statusEl.className = 'status-pill';
      statusText.textContent = `LIVE • ${city.polls_reported} of ${city.total_polls} Polls Reporting`;
    } else {
      statusEl.className = 'status-pill awaiting';
      statusText.textContent = 'Awaiting Poll Closing & First Returns';
    }
  }

  // Last Updated
  const updatedEl = document.getElementById('lastUpdatedTime');
  if (updatedEl && meta.last_updated_utc) {
    const date = new Date(meta.last_updated_utc);
    updatedEl.textContent = `Updated: ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }

  // Ticker: Polls
  const pollsVal = document.getElementById('tickerPollsVal');
  const pollsPct = document.getElementById('tickerPollsPct');
  const pollsBar = document.getElementById('tickerPollsBar');
  if (pollsVal) pollsVal.textContent = `${(city.polls_reported || 0).toLocaleString()} / ${(city.total_polls || 1431).toLocaleString()}`;
  if (pollsPct) pollsPct.textContent = `${(city.polls_reporting_pct || 0).toFixed(1)}% reporting`;
  if (pollsBar) pollsBar.style.width = `${Math.min(100, city.polls_reporting_pct || 0)}%`;

  // Ticker: Total Votes
  const votesVal = document.getElementById('tickerVotesVal');
  if (votesVal) votesVal.textContent = (city.total_votes || 0).toLocaleString();

  // Ticker: Registered Voters & Turnout
  const turnoutVal = document.getElementById('tickerTurnoutVal');
  const turnoutSub = document.getElementById('tickerTurnoutSub');
  if (turnoutVal) turnoutVal.textContent = `${(city.turnout_pct || 0).toFixed(1)}%`;
  if (turnoutSub) turnoutSub.textContent = `of ${(city.registered_voters || 2143771).toLocaleString()} eligible voters`;
}

/**
 * Render Olivia Chow vs Brad Bradford Head-to-Head Showdown
 */
function renderShowdown() {
  const h2h = electionData.head_to_head || {};
  const chow = h2h.chow || {};
  const bradford = h2h.bradford || {};

  // Chow Elements
  document.getElementById('chowVotes').textContent = (chow.votes || 0).toLocaleString();
  document.getElementById('chowPct').textContent = `${(chow.percentage || 0).toFixed(1)}%`;
  document.getElementById('chowWardsLed').textContent = `${chow.wards_leading || 0} Wards`;
  document.getElementById('chowTwoWayPct').textContent = `${(chow.two_way_percentage || 50).toFixed(1)}%`;

  // Bradford Elements
  document.getElementById('bradfordVotes').textContent = (bradford.votes || 0).toLocaleString();
  document.getElementById('bradfordPct').textContent = `${(bradford.percentage || 0).toFixed(1)}%`;
  document.getElementById('bradfordWardsLed').textContent = `${bradford.wards_leading || 0} Wards`;
  document.getElementById('bradfordTwoWayPct').textContent = `${(bradford.two_way_percentage || 50).toFixed(1)}%`;

  // Center Margin Banner
  const marginPill = document.getElementById('h2hMarginPill');
  const diff = h2h.vote_margin || 0;
  const pctDiff = Math.abs(h2h.pct_margin || 0).toFixed(1);

  if (diff > 0) {
    marginPill.className = 'margin-pill chow-lead';
    marginPill.textContent = `CHOW +${diff.toLocaleString()} (+${pctDiff}%)`;
  } else if (diff < 0) {
    marginPill.className = 'margin-pill bradford-lead';
    marginPill.textContent = `BRADFORD +${Math.abs(diff).toLocaleString()} (+${pctDiff}%)`;
  } else {
    marginPill.className = 'margin-pill pending';
    marginPill.textContent = (electionData.citywide.polls_reported > 0) ? 'TIED' : 'POLLS REPORTING SOON';
  }

  // Two-way Meter Bar
  const chowBar = document.getElementById('twoWayChowBar');
  const bradfordBar = document.getElementById('twoWayBradfordBar');
  const chowShare = Math.min(100, Math.max(0, chow.two_way_percentage || 50));
  const bradfordShare = 100 - chowShare;

  if (chowBar) chowBar.style.width = `${chowShare}%`;
  if (bradfordBar) bradfordBar.style.width = `${bradfordShare}%`;

  // Scoreboard
  document.getElementById('scoreboardChow').textContent = `${chow.wards_leading || 0} Wards`;
  document.getElementById('scoreboardBradford').textContent = `${bradford.wards_leading || 0} Wards`;
}

/**
 * Render Top 5 Candidates Leaderboard (strictly top 5 displayed by default)
 */
function renderTop5Candidates() {
  const container = document.getElementById('top5Container');
  if (!container) return;

  const top5 = electionData.top5_candidates || [];
  container.innerHTML = '';

  const maxVotes = top5.length > 0 && top5[0].votes > 0 ? top5[0].votes : 1;

  top5.forEach((cand, idx) => {
    const isChow = cand.name.toLowerCase().includes('chow');
    const isBradford = cand.name.toLowerCase().includes('bradford');

    let barClass = '';
    if (isChow) barClass = 'chow-color';
    else if (isBradford) barClass = 'bradford-color';

    const barWidth = maxVotes > 0 ? Math.min(100, Math.max(2, (cand.votes / maxVotes) * 100)) : 0;

    const row = document.createElement('div');
    row.className = `candidate-row rank-${cand.rank || idx + 1}`;
    row.innerHTML = `
      <div class="rank-badge">${cand.rank || idx + 1}</div>
      <div class="cand-name-col">
        <span class="c-name">${cand.name}</span>
        <span class="c-tag">${isChow ? 'Focus Candidate • Left-leaning' : isBradford ? 'Focus Candidate • Centre-right' : 'Mayoral Candidate'}</span>
      </div>
      <div class="cand-bar-col">
        <div class="cand-bar-outer">
          <div class="cand-bar-inner ${barClass}" style="width: ${barWidth}%"></div>
        </div>
      </div>
      <div class="cand-votes-col">
        <span class="v-num">${(cand.votes || 0).toLocaleString()}</span>
        <span class="v-pct">${(cand.percentage || 0).toFixed(1)}%</span>
      </div>
    `;
    container.appendChild(row);
  });

  // Render collapsible remaining candidates if raw data exists
  renderFullCandidatesList();
}

function renderFullCandidatesList() {
  const fullListContainer = document.getElementById('fullCandidatesList');
  if (!fullListContainer || !electionData.wards) return;

  // We can collect all candidates from raw unofficial if available, or top5
  // For cleanliness, we populate from raw unofficial or display clean message
}

/**
 * GeoJSON Leaflet Choropleth Layer
 */
function renderGeoJSONLayer() {
  if (!geojsonData || !leafletMap) return;

  if (geojsonLayer) {
    leafletMap.removeLayer(geojsonLayer);
  }

  geojsonLayer = L.geoJSON(geojsonData, {
    style: styleFeature,
    onEachFeature: onEachFeature
  }).addTo(leafletMap);

  // Fit bounds on first load
  if (!window.mapBoundsFitted) {
    leafletMap.fitBounds(geojsonLayer.getBounds(), { padding: [15, 15] });
    window.mapBoundsFitted = true;
  }

  updateMapLegend();
}

/**
 * Polygon Styling based on current view mode
 */
function styleFeature(feature) {
  const wardNum = parseInt(feature.properties.AREA_SHORT_CODE, 10);
  const wardData = getWardData(wardNum);

  let fillColor = COLORS.pending;
  let fillOpacity = 0.75;
  const isSelected = selectedWardNum === wardNum;

  if (wardData) {
    if (currentMapView === 'margin') {
      const margin = wardData.head_to_head_margin_pct || 0;
      const reported = wardData.polls_reported > 0;

      if (!reported || (wardData.chow.votes === 0 && wardData.bradford.votes === 0)) {
        fillColor = COLORS.pending;
        fillOpacity = 0.55;
      } else if (margin > 15) {
        fillColor = COLORS.chow.strong;
      } else if (margin > 5) {
        fillColor = COLORS.chow.medium;
      } else if (margin > 0) {
        fillColor = COLORS.chow.lean;
      } else if (margin < -15) {
        fillColor = COLORS.bradford.strong;
      } else if (margin < -5) {
        fillColor = COLORS.bradford.medium;
      } else if (margin < 0) {
        fillColor = COLORS.bradford.lean;
      } else {
        fillColor = COLORS.neutral;
      }
    } else if (currentMapView === 'winner') {
      if (wardData.leader === 'Olivia Chow') {
        fillColor = COLORS.chow.medium;
      } else if (wardData.leader === 'Brad Bradford') {
        fillColor = COLORS.bradford.medium;
      } else if (wardData.leader === 'Pending') {
        fillColor = COLORS.pending;
        fillOpacity = 0.5;
      } else {
        fillColor = '#8b5cf6'; // Other candidate
      }
    } else if (currentMapView === 'turnout') {
      const pct = wardData.polls_reporting_pct || 0;
      if (pct === 0) fillColor = '#1e293b';
      else if (pct < 25) fillColor = '#1e3a8a';
      else if (pct < 50) fillColor = '#0284c7';
      else if (pct < 75) fillColor = '#0d9488';
      else fillColor = '#16a34a';
    }
  }

  return {
    fillColor: fillColor,
    weight: isSelected ? 3.5 : 1.5,
    opacity: 1,
    color: isSelected ? COLORS.borderHighlight : COLORS.border,
    fillOpacity: fillOpacity
  };
}

function updateMapStyles() {
  if (geojsonLayer) {
    geojsonLayer.setStyle(styleFeature);
  }
}

/**
 * Event Handlers for each Ward Polygon
 */
function onEachFeature(feature, layer) {
  const wardNum = parseInt(feature.properties.AREA_SHORT_CODE, 10);
  const wardData = getWardData(wardNum);
  const wardName = wardData ? wardData.ward_name : feature.properties.AREA_NAME;

  // Rich Tooltip on Hover
  layer.bindTooltip(() => {
    const wd = getWardData(wardNum);
    if (!wd) return `<strong>Ward ${wardNum}: ${wardName}</strong>`;

    const margin = wd.head_to_head_margin;
    const marginStr = margin > 0 ? `<span style="color:#fdba74">Chow +${margin.toLocaleString()}</span>` :
                      margin < 0 ? `<span style="color:#93c5fd">Bradford +${Math.abs(margin).toLocaleString()}</span>` :
                      `<span style="color:#94a3b8">Tied</span>`;

    return `
      <div style="font-family: sans-serif; min-width: 170px;">
        <div style="font-weight: 700; font-size: 0.9rem; margin-bottom: 2px;">Ward ${wd.ward_num}: ${wd.ward_name}</div>
        <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 6px;">Polls: ${wd.polls_reported}/${wd.polls_total} (${wd.polls_reporting_pct.toFixed(0)}%)</div>
        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 2px;">
          <span style="color: #fdba74;">Chow:</span>
          <strong>${wd.chow.votes.toLocaleString()} (${wd.chow.percentage.toFixed(1)}%)</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
          <span style="color: #93c5fd;">Bradford:</span>
          <strong>${wd.bradford.votes.toLocaleString()} (${wd.bradford.percentage.toFixed(1)}%)</strong>
        </div>
        <div style="border-top: 1px solid #334155; padding-top: 4px; font-size: 0.75rem; display: flex; justify-content: space-between;">
          <span>Margin:</span>
          <strong>${marginStr}</strong>
        </div>
      </div>
    `;
  }, { className: 'custom-ward-tooltip', sticky: true, opacity: 0.95 });

  // Interactions
  layer.on({
    mouseover: (e) => {
      const l = e.target;
      if (selectedWardNum !== wardNum) {
        l.setStyle({ weight: 2.5, color: '#94a3b8' });
      }
    },
    mouseout: (e) => {
      const l = e.target;
      if (selectedWardNum !== wardNum) {
        geojsonLayer.resetStyle(l);
      }
    },
    click: () => {
      selectWard(wardNum, layer);
    }
  });
}

function selectWard(wardNum, layer) {
  selectedWardNum = wardNum;
  updateMapStyles();
  inspectWard(wardNum);

  if (layer) {
    leafletMap.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 13 });
  }

  // Scroll to inspector on small screens
  if (window.innerWidth < 1024) {
    const inspector = document.getElementById('wardInspectorCard');
    if (inspector) inspector.scrollIntoView({ behavior: 'smooth' });
  }
}

function clearSelectedWard() {
  selectedWardNum = null;
  updateMapStyles();
  inspectWard(10); // fallback
}

/**
 * Render Ward Inspector Panel
 */
function inspectWard(wardNum) {
  const wd = getWardData(wardNum);
  if (!wd) return;

  document.getElementById('inspectorWardTitle').textContent = `Ward ${wd.ward_num} — ${wd.ward_name}`;
  document.getElementById('inspectorReporting').textContent = `${wd.polls_reported} of ${wd.polls_total} polls (${wd.polls_reporting_pct.toFixed(1)}%)`;

  document.getElementById('inspChowVotes').textContent = wd.chow.votes.toLocaleString();
  document.getElementById('inspChowPct').textContent = `${wd.chow.percentage.toFixed(1)}%`;

  document.getElementById('inspBradfordVotes').textContent = wd.bradford.votes.toLocaleString();
  document.getElementById('inspBradfordPct').textContent = `${wd.bradford.percentage.toFixed(1)}%`;

  // Margin in ward
  const marginEl = document.getElementById('inspMargin');
  const m = wd.head_to_head_margin;
  const mPct = Math.abs(wd.head_to_head_margin_pct).toFixed(1);

  if (m > 0) {
    marginEl.className = 'table-badge chow';
    marginEl.textContent = `Chow +${m.toLocaleString()} (+${mPct}%)`;
  } else if (m < 0) {
    marginEl.className = 'table-badge bradford';
    marginEl.textContent = `Bradford +${Math.abs(m).toLocaleString()} (+${mPct}%)`;
  } else {
    marginEl.className = 'table-badge pending';
    marginEl.textContent = wd.polls_reported > 0 ? 'Tied' : 'Pending';
  }

  // Mini two-way meter in inspector
  const chowTwoWay = (wd.chow.votes + wd.bradford.votes) > 0 ?
    (wd.chow.votes / (wd.chow.votes + wd.bradford.votes) * 100) : 50;
  const chowMiniBar = document.getElementById('inspChowMiniBar');
  const bradfordMiniBar = document.getElementById('inspBradfordMiniBar');
  if (chowMiniBar) chowMiniBar.style.width = `${chowTwoWay}%`;
  if (bradfordMiniBar) bradfordMiniBar.style.width = `${100 - chowTwoWay}%`;

  // Top 5 Candidates in this ward
  const candList = document.getElementById('inspectorTopCandidates');
  if (candList) {
    candList.innerHTML = '';
    (wd.top5 || []).slice(0, 5).forEach(c => {
      const item = document.createElement('div');
      item.className = 'cand-item-small';
      const isChow = c.name.toLowerCase().includes('chow');
      const isBradford = c.name.toLowerCase().includes('bradford');
      const color = isChow ? '#fdba74' : isBradford ? '#93c5fd' : '#cbd5e1';

      item.innerHTML = `
        <span style="color: ${color}; font-weight: ${isChow || isBradford ? '700' : '500'};">#${c.rank} ${c.name}</span>
        <span><strong>${c.votes.toLocaleString()}</strong> (${c.percentage.toFixed(1)}%)</span>
      `;
      candList.appendChild(item);
    });
  }

  // Stats: Total Votes & Turnout
  const statsBox = document.getElementById('inspectorStats');
  if (statsBox) {
    statsBox.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#94a3b8;">
        <span>Total Votes: <strong>${wd.total_votes.toLocaleString()}</strong></span>
        <span>Turnout: <strong>${wd.turnout_pct.toFixed(1)}%</strong></span>
      </div>
    `;
  }
}

/**
 * Render Ward-by-Ward Comparison Table
 */
function renderWardTable() {
  const tbody = document.getElementById('wardTableBody');
  if (!tbody || !electionData.wards) return;

  const searchQuery = (document.getElementById('tableSearch')?.value || '').toLowerCase().trim();
  const activeFilter = document.querySelector('.filter-pills .filter-pill.active')?.dataset.filter || 'all';

  let wards = [...electionData.wards];

  // Apply Search filter
  if (searchQuery) {
    wards = wards.filter(w =>
      w.ward_num.toString().includes(searchQuery) ||
      w.ward_name.toLowerCase().includes(searchQuery)
    );
  }

  // Apply Category filter
  if (activeFilter === 'chow') {
    wards = wards.filter(w => w.head_to_head_margin > 0);
  } else if (activeFilter === 'bradford') {
    wards = wards.filter(w => w.head_to_head_margin < 0);
  } else if (activeFilter === 'battleground') {
    // Top battlegrounds: absolute margin pct < 5% or close
    wards = wards.filter(w => Math.abs(w.head_to_head_margin_pct) <= 7.0);
  }

  tbody.innerHTML = '';

  if (wards.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: #64748b;">No wards found matching criteria</td></tr>`;
    return;
  }

  wards.forEach(w => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';

    const margin = w.head_to_head_margin;
    let badgeHtml = '';
    if (margin > 0) {
      badgeHtml = `<span class="table-badge chow">Chow +${margin.toLocaleString()} (${w.head_to_head_margin_pct.toFixed(1)}%)</span>`;
    } else if (margin < 0) {
      badgeHtml = `<span class="table-badge bradford">Bradford +${Math.abs(margin).toLocaleString()} (${Math.abs(w.head_to_head_margin_pct).toFixed(1)}%)</span>`;
    } else {
      badgeHtml = `<span class="table-badge pending">${w.polls_reported > 0 ? 'Tied' : 'Pending'}</span>`;
    }

    tr.innerHTML = `
      <td><strong>${w.ward_num}</strong></td>
      <td><strong>${w.ward_name}</strong></td>
      <td>${w.polls_reported}/${w.polls_total} (${w.polls_reporting_pct.toFixed(0)}%)</td>
      <td>${w.total_votes.toLocaleString()}</td>
      <td style="color:#fdba74"><strong>${w.chow.votes.toLocaleString()}</strong> (${w.chow.percentage.toFixed(1)}%)</td>
      <td style="color:#93c5fd"><strong>${w.bradford.votes.toLocaleString()}</strong> (${w.bradford.percentage.toFixed(1)}%)</td>
      <td>${badgeHtml}</td>
    `;

    tr.addEventListener('click', () => {
      // Find layer in GeoJSON
      if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => {
          if (parseInt(layer.feature.properties.AREA_SHORT_CODE, 10) === w.ward_num) {
            selectWard(w.ward_num, layer);
          }
        });
      }
    });

    tbody.appendChild(tr);
  });
}

/**
 * Render Key Battlegrounds Spotlight
 */
function renderBattlegrounds() {
  const container = document.getElementById('battlegroundsContainer');
  if (!container || !electionData.battlegrounds) return;

  container.innerHTML = '';
  electionData.battlegrounds.forEach(b => {
    const card = document.createElement('div');
    card.className = 'battle-card';

    const margin = b.margin;
    const isChow = margin > 0;
    const isBradford = margin < 0;

    let marginStr = 'Pending';
    let marginClass = 'color: #94a3b8;';
    if (isChow) {
      marginStr = `Chow +${margin.toLocaleString()} (+${b.margin_pct.toFixed(1)}%)`;
      marginClass = 'color: #fdba74;';
    } else if (isBradford) {
      marginStr = `Bradford +${Math.abs(margin).toLocaleString()} (+${Math.abs(b.margin_pct).toFixed(1)}%)`;
      marginClass = 'color: #93c5fd;';
    }

    card.innerHTML = `
      <div class="battle-header">
        <span class="battle-name">Ward ${b.ward_num}: ${b.ward_name}</span>
      </div>
      <div style="font-size: 0.8rem; display: flex; justify-content: space-between;">
        <span>Chow: ${(b.chow_votes || 0).toLocaleString()}</span>
        <span>Bradford: ${(b.bradford_votes || 0).toLocaleString()}</span>
      </div>
      <div class="battle-margin" style="${marginClass}">
        ${marginStr}
      </div>
    `;

    card.addEventListener('click', () => {
      if (geojsonLayer) {
        geojsonLayer.eachLayer(layer => {
          if (parseInt(layer.feature.properties.AREA_SHORT_CODE, 10) === b.ward_num) {
            selectWard(b.ward_num, layer);
          }
        });
      }
    });

    container.appendChild(card);
  });
}

/**
 * Render History / Progression Line Chart
 */
function renderHistoryChart() {
  const ctx = document.getElementById('historyChart');
  if (!ctx || !window.Chart) return;

  if (!historyData || historyData.length === 0) {
    return;
  }

  const labels = historyData.map(h => {
    const d = new Date(h.time);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  const chowVotes = historyData.map(h => h.chow_votes || 0);
  const bradfordVotes = historyData.map(h => h.bradford_votes || 0);

  if (historyChart) {
    historyChart.data.labels = labels;
    historyChart.data.datasets[0].data = chowVotes;
    historyChart.data.datasets[1].data = bradfordVotes;
    historyChart.update();
    return;
  }

  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Olivia Chow',
          data: chowVotes,
          borderColor: '#f97316',
          backgroundColor: 'rgba(249, 115, 22, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2.5,
          pointRadius: historyData.length > 20 ? 1 : 3
        },
        {
          label: 'Brad Bradford',
          data: bradfordVotes,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2.5,
          pointRadius: historyData.length > 20 ? 1 : 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#cbd5e1', font: { size: 12, weight: 'bold' } }
        },
        tooltip: {
          backgroundColor: '#1e293b',
          titleColor: '#fff',
          bodyColor: '#cbd5e1',
          borderColor: '#334155',
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: { color: '#1e293b' },
          ticks: { color: '#94a3b8' }
        },
        y: {
          grid: { color: '#1e293b' },
          ticks: {
            color: '#94a3b8',
            callback: (val) => val.toLocaleString()
          }
        }
      }
    }
  });
}

/**
 * Update Map Legend based on active mode
 */
function updateMapLegend() {
  const legend = document.getElementById('mapLegend');
  if (!legend) return;

  if (currentMapView === 'margin') {
    legend.innerHTML = `
      <span style="font-weight:700; margin-right: 4px;">Chow vs Bradford Margin:</span>
      <div class="legend-item"><div class="legend-swatch" style="background:${COLORS.chow.strong};"></div> Chow +15%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${COLORS.chow.medium};"></div> Chow +5-15%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${COLORS.chow.lean};"></div> Chow <5%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${COLORS.bradford.lean};"></div> Bradford <5%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${COLORS.bradford.medium};"></div> Bradford +5-15%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${COLORS.bradford.strong};"></div> Bradford +15%</div>
    `;
  } else if (currentMapView === 'winner') {
    legend.innerHTML = `
      <span style="font-weight:700; margin-right: 4px;">Ward Winner:</span>
      <div class="legend-item"><div class="legend-swatch" style="background:${COLORS.chow.medium};"></div> Olivia Chow</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${COLORS.bradford.medium};"></div> Brad Bradford</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#8b5cf6;"></div> Other Candidate</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${COLORS.pending};"></div> Awaiting Reports</div>
    `;
  } else if (currentMapView === 'turnout') {
    legend.innerHTML = `
      <span style="font-weight:700; margin-right: 4px;">Polls Reporting:</span>
      <div class="legend-item"><div class="legend-swatch" style="background:#1e3a8a;"></div> 1-25%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#0284c7;"></div> 26-50%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#0d9488;"></div> 51-75%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#16a34a;"></div> 76-100%</div>
    `;
  }
}

/**
 * Helper to retrieve ward data object by ward number
 */
function getWardData(wardNum) {
  if (!electionData || !electionData.wards) return null;
  return electionData.wards.find(w => w.ward_num === wardNum);
}

function setLoadingState(loading) {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.style.display = loading ? 'flex' : 'none';
  }
}

function setRefreshIconSpinning(spinning) {
  const icon = document.getElementById('refreshIcon');
  if (icon) {
    icon.style.transform = spinning ? 'rotate(360deg)' : 'rotate(0deg)';
    icon.style.transition = spinning ? 'transform 0.6s linear infinite' : 'none';
  }
}

function showNotification(msg, type = 'info') {
  // Optional toast notification
  console.log(`[${type.toUpperCase()}] ${msg}`);
}
