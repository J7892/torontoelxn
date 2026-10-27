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
let autoRefreshIntervalSec = 30;
let isRefreshing = false;

// Theme & Basemap State
let currentThemePreference = 'auto'; // 'auto' | 'light' | 'dark'
let currentBasemapType = 'canvas';   // 'canvas' | 'osm'
let currentTileLayer = null;

/**
 * Returns effective theme ('light' or 'dark') taking into account system preference if set to auto.
 */
function getEffectiveTheme() {
  const saved = localStorage.getItem('theme-preference') || 'auto';
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Dynamic color palette adapting to theme
 */
function getThemePalette() {
  const isDark = getEffectiveTheme() === 'dark';
  return {
    chow: {
      strong: isDark ? '#c2410c' : '#c2410c',
      medium: isDark ? '#ea580c' : '#ea580c',
      lean: isDark ? '#fb923c' : '#f97316',
      light: isDark ? '#fdba74' : '#fb923c'
    },
    bradford: {
      strong: isDark ? '#1d4ed8' : '#1d4ed8',
      medium: isDark ? '#2563eb' : '#2563eb',
      lean: isDark ? '#60a5fa' : '#3b82f6',
      light: isDark ? '#93c5fd' : '#60a5fa'
    },
    neutral: isDark ? '#334155' : '#cbd5e1',
    pending: isDark ? '#1e293b' : '#e2e8f0',
    border: isDark ? '#475569' : '#94a3b8',
    borderHighlight: isDark ? '#f8fafc' : '#0f172a'
  };
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initMap();
  setupEventListeners();
  loadAllData();
  startAutoRefresh();
});

/**
 * Initialize Theme setting
 */
function initTheme() {
  const saved = localStorage.getItem('theme-preference') || 'auto';
  setThemePreference(saved, false);
}

/**
 * Set theme preference ('auto', 'light', or 'dark')
 */
function setThemePreference(theme, save = true) {
  currentThemePreference = theme;
  if (save) {
    if (theme === 'auto') {
      localStorage.removeItem('theme-preference');
    } else {
      localStorage.setItem('theme-preference', theme);
    }
  }

  // Update meta color-scheme
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.content = theme === 'auto' ? 'light dark' : theme;
  }
  document.documentElement.setAttribute('data-theme', theme);

  // Update active state on toggle buttons
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeValue === theme);
  });

  // Refresh map tiles, polygon styles, and charts
  updateMapBasemap();
  updateMapStyles();
  updateChartTheme();
}

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

  updateMapBasemap();

  L.control.attribution({ position: 'bottomright' })
    .addTo(leafletMap);
}

/**
 * Update Leaflet Basemap (Free, No API Key, Zero Watermark)
 */
function updateMapBasemap() {
  if (!leafletMap) return;

  if (currentTileLayer) {
    leafletMap.removeLayer(currentTileLayer);
  }

  const effectiveTheme = getEffectiveTheme();
  let tileUrl = '';
  let attribution = '';
  let maxZoom = 16;

  if (currentBasemapType === 'osm') {
    // OpenStreetMap standard tiles (Zero watermark, no API key required)
    tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    attribution = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://open.toronto.ca" target="_blank" rel="noopener">City of Toronto</a>';
    maxZoom = 19;
  } else {
    // Esri Gray Canvas (Clean choropleth canvas, theme-matched, zero watermark, no API key required)
    if (effectiveTheme === 'dark') {
      tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    } else {
      tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    }
    attribution = 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, HERE &copy; <a href="https://open.toronto.ca" target="_blank" rel="noopener">City of Toronto</a>';
  }

  currentTileLayer = L.tileLayer(tileUrl, {
    attribution: attribution,
    maxZoom: maxZoom
  }).addTo(leafletMap);

  currentTileLayer.bringToBack();
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

  // Council Search Input
  const councilSearch = document.getElementById('councilSearch');
  if (councilSearch) {
    councilSearch.addEventListener('input', () => {
      renderCouncilGrid();
    });
  }

  // Council Sort Select
  const councilSort = document.getElementById('councilSort');
  if (councilSort) {
    councilSort.addEventListener('change', () => {
      renderCouncilGrid();
    });
  }

  // Council Filter Pills
  document.querySelectorAll('.council-filter-pills .filter-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.council-filter-pills .filter-pill').forEach(p => p.classList.remove('active'));
      e.currentTarget.classList.add('active');
      renderCouncilGrid();
    });
  });

  // Ward Inspector Race Tabs (Council vs Mayor)
  document.querySelectorAll('.insp-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tab = e.currentTarget.dataset.inspTab;
      document.querySelectorAll('.insp-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.inspTab === tab));
      const councilPanel = document.getElementById('inspCouncilPanel');
      const mayorPanel = document.getElementById('inspMayorPanel');
      if (councilPanel && mayorPanel) {
        councilPanel.classList.toggle('hidden', tab !== 'council');
        mayorPanel.classList.toggle('hidden', tab !== 'mayor');
      }
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

  // Theme Toggle Buttons (Auto / Light / Dark)
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget;
      const themeVal = target.dataset.themeValue;
      if (themeVal) {
        setThemePreference(themeVal);
      }
    });
  });

  // Basemap Switcher Buttons (Canvas vs OSM Streets)
  document.querySelectorAll('.basemap-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget;
      document.querySelectorAll('.basemap-btn').forEach(b => b.classList.remove('active'));
      target.classList.add('active');
      currentBasemapType = target.dataset.basemap;
      updateMapBasemap();
    });
  });

  // System OS theme change listener (Auto mode)
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const saved = localStorage.getItem('theme-preference') || 'auto';
      if (saved === 'auto') {
        updateMapBasemap();
        updateMapStyles();
        updateChartTheme();
      }
    });
  }

  // Multi-tab sync via storage event
  window.addEventListener('storage', (e) => {
    if (e.key === 'theme-preference') {
      const newTheme = e.newValue || 'auto';
      setThemePreference(newTheme, false);
    }
  });
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
  renderGeoJSONLayer();
  renderCouncilGrid();
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
  const palette = getThemePalette();

  let fillColor = palette.pending;
  let fillOpacity = 0.75;
  const isSelected = selectedWardNum === wardNum;

  if (wardData) {
    if (currentMapView === 'margin') {
      const margin = wardData.head_to_head_margin_pct || 0;
      const reported = wardData.polls_reported > 0;

      if (!reported || (wardData.chow.votes === 0 && wardData.bradford.votes === 0)) {
        fillColor = palette.pending;
        fillOpacity = 0.55;
      } else if (margin > 15) {
        fillColor = palette.chow.strong;
      } else if (margin > 5) {
        fillColor = palette.chow.medium;
      } else if (margin > 0) {
        fillColor = palette.chow.lean;
      } else if (margin < -15) {
        fillColor = palette.bradford.strong;
      } else if (margin < -5) {
        fillColor = palette.bradford.medium;
      } else if (margin < 0) {
        fillColor = palette.bradford.lean;
      } else {
        fillColor = palette.neutral;
      }
    } else if (currentMapView === 'winner') {
      if (wardData.leader === 'Olivia Chow') {
        fillColor = palette.chow.medium;
      } else if (wardData.leader === 'Brad Bradford') {
        fillColor = palette.bradford.medium;
      } else if (wardData.leader === 'Pending') {
        fillColor = palette.pending;
        fillOpacity = 0.5;
      } else {
        fillColor = '#8b5cf6'; // Other candidate
      }
    } else if (currentMapView === 'council') {
      const council = wardData.council || {};
      const reported = (council.polls_reported || 0) > 0 && (council.total_votes || 0) > 0;
      const mPct = council.margin_pct || 0;
      if (!reported) {
        fillColor = palette.pending;
        fillOpacity = 0.55;
      } else if (mPct <= 5.0) {
        fillColor = '#f59e0b'; // Close council race (<5%)
      } else if (mPct <= 15.0) {
        fillColor = '#0d9488'; // Moderate council lead (5-15%)
      } else {
        fillColor = '#10b981'; // Safe council lead (>15%)
      }
    } else if (currentMapView === 'turnout') {
      const pct = wardData.polls_reporting_pct || 0;
      if (pct === 0) fillColor = palette.pending;
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
    color: isSelected ? palette.borderHighlight : palette.border,
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

  // Rich Tooltip on Hover (adapts to Mayoral or Council view)
  layer.bindTooltip(() => {
    const wd = getWardData(wardNum);
    if (!wd) return `<strong>Ward ${wardNum}: ${wardName}</strong>`;

    const council = wd.council || {};
    const cTop2 = (council.top3 || []).slice(0, 2);
    const cLeaderHtml = cTop2.length > 0
      ? cTop2.map((c, idx) => `
          <div style="display: flex; justify-content: space-between; font-size: 0.78rem; margin-bottom: 2px;">
            <span>#${idx + 1} ${c.name}:</span>
            <strong>${c.votes.toLocaleString()} (${c.percentage.toFixed(1)}%)</strong>
          </div>
        `).join('')
      : `<div style="font-size: 0.75rem; color: #94a3b8;">Awaiting votes</div>`;

    const margin = wd.head_to_head_margin;
    const marginStr = margin > 0 ? `<span style="color:#fdba74">Chow +${margin.toLocaleString()}</span>` :
                      margin < 0 ? `<span style="color:#93c5fd">Bradford +${Math.abs(margin).toLocaleString()}</span>` :
                      `<span style="color:#94a3b8">Tied / Pending</span>`;

    return `
      <div style="font-family: sans-serif; min-width: 195px;">
        <div style="font-weight: 700; font-size: 0.9rem; margin-bottom: 2px;">Ward ${wd.ward_num}: ${wd.ward_name}</div>
        <div style="font-size: 0.73rem; color: #94a3b8; margin-bottom: 6px;">Polls: ${wd.polls_reported}/${wd.polls_total} (${wd.polls_reporting_pct.toFixed(0)}%)</div>
        <div style="font-size: 0.7rem; text-transform: uppercase; color: #94a3b8; font-weight: 700; margin-bottom: 2px;">Mayor (Chow vs Bradford)</div>
        <div style="display: flex; justify-content: space-between; font-size: 0.78rem; margin-bottom: 4px;">
          <span>Margin:</span>
          <strong>${marginStr}</strong>
        </div>
        <div style="border-top: 1px solid rgba(148, 163, 184, 0.25); padding-top: 4px; margin-top: 4px;">
          <div style="font-size: 0.7rem; text-transform: uppercase; color: #34d399; font-weight: 700; margin-bottom: 2px;">Council Race Top 2</div>
          ${cLeaderHtml}
        </div>
      </div>
    `;
  }, { className: 'custom-ward-tooltip', sticky: true, opacity: 0.96 });

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
  } else if (geojsonLayer) {
    geojsonLayer.eachLayer(l => {
      if (parseInt(l.feature.properties.AREA_SHORT_CODE, 10) === wardNum) {
        leafletMap.fitBounds(l.getBounds(), { padding: [40, 40], maxZoom: 13 });
      }
    });
  }

  // Highlight selected card in Council Grid
  document.querySelectorAll('.council-ward-card').forEach(card => {
    card.classList.toggle('selected', parseInt(card.dataset.wardNum, 10) === wardNum);
  });
}

function clearSelectedWard() {
  selectedWardNum = null;
  updateMapStyles();
  inspectWard(10); // fallback
  document.querySelectorAll('.council-ward-card').forEach(card => {
    card.classList.remove('selected');
  });
}

/**
 * Render Ward Inspector Panel (Both Council & Mayor Tabs)
 */
function inspectWard(wardNum) {
  const wd = getWardData(wardNum);
  if (!wd) return;

  document.getElementById('inspectorWardTitle').textContent = `Ward ${wd.ward_num} — ${wd.ward_name}`;
  document.getElementById('inspectorReporting').textContent = `${wd.polls_reported} of ${wd.polls_total} polls (${wd.polls_reporting_pct.toFixed(1)}%)`;

  // 1. Populate Council Panel
  const council = wd.council || {};
  const inspCouncilMargin = document.getElementById('inspCouncilMargin');
  if (inspCouncilMargin) {
    if ((council.polls_reported || 0) > 0 && (council.total_votes || 0) > 0 && council.leader !== 'Pending') {
      if (council.leader === 'Tied') {
        inspCouncilMargin.className = 'table-badge council-close';
        inspCouncilMargin.textContent = 'Tied Race';
      } else {
        inspCouncilMargin.className = council.is_close_race ? 'table-badge council-close' : 'table-badge council-lead';
        inspCouncilMargin.textContent = `${council.leader} +${(council.margin_votes || 0).toLocaleString()} (+${(council.margin_pct || 0).toFixed(1)}%)`;
      }
    } else {
      inspCouncilMargin.className = 'table-badge pending';
      inspCouncilMargin.textContent = `Awaiting Polls (${council.candidates_count || 0} candidates)`;
    }
  }

  const councilListEl = document.getElementById('inspectorCouncilCandidates');
  if (councilListEl) {
    councilListEl.innerHTML = '';
    const allCouncilCands = council.all_candidates || council.top3 || [];
    const hasCouncilVotes = (council.total_votes || 0) > 0;
    allCouncilCands.forEach((c, idx) => {
      const item = document.createElement('div');
      item.className = 'cand-item-small';
      const isLeader = hasCouncilVotes && idx === 0 && c.votes > 0;
      item.innerHTML = `
        <span style="font-weight: ${isLeader ? '700' : '500'}; color: ${isLeader ? 'var(--accent-green)' : 'var(--text-main)'};">
          #${c.rank || idx + 1} ${c.name}
        </span>
        <span><strong>${(c.votes || 0).toLocaleString()}</strong> (${(c.percentage || 0).toFixed(1)}%)</span>
      `;
      councilListEl.appendChild(item);
    });
  }

  // 2. Populate Mayor Panel
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

  // Top 5 Mayoral Candidates in this ward
  const candList = document.getElementById('inspectorTopCandidates');
  if (candList) {
    candList.innerHTML = '';
    (wd.top5 || []).slice(0, 5).forEach(c => {
      const item = document.createElement('div');
      item.className = 'cand-item-small';
      const isChow = c.name.toLowerCase().includes('chow');
      const isBradford = c.name.toLowerCase().includes('bradford');
      const colorClass = isChow ? 'text-chow' : isBradford ? 'text-bradford' : '';

      item.innerHTML = `
        <span class="${colorClass}" style="font-weight: ${isChow || isBradford ? '700' : '500'};">#${c.rank} ${c.name}</span>
        <span><strong>${c.votes.toLocaleString()}</strong> (${c.percentage.toFixed(1)}%)</span>
      `;
      candList.appendChild(item);
    });
  }

  // Stats: Total Votes & Turnout
  const statsBox = document.getElementById('inspectorStats');
  if (statsBox) {
    statsBox.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted);">
        <span>Council Votes: <strong>${(council.total_votes || 0).toLocaleString()}</strong></span>
        <span>Turnout: <strong>${wd.turnout_pct.toFixed(1)}%</strong></span>
      </div>
    `;
  }
}

/**
 * Render All 25 City Council Ward Races At-a-Glance Grid
 */
const REGION_WARDS = {
  etobicoke: [1, 2, 3],
  northyork: [5, 6, 7, 8, 15, 16, 17, 18],
  torontoeastyork: [4, 9, 10, 11, 12, 13, 14, 19],
  scarborough: [20, 21, 22, 23, 24, 25]
};

function renderCouncilGrid() {
  const grid = document.getElementById('councilGrid');
  if (!grid || !electionData || !electionData.wards) return;

  const allWards = electionData.wards;

  // Update summary pills
  const reportingWardsCount = allWards.filter(w => (w.council?.polls_reported || 0) > 0).length;
  const closeRacesCount = allWards.filter(w => w.council?.is_close_race).length;

  const repPill = document.getElementById('councilReportingCount');
  const closePill = document.getElementById('councilCloseCount');
  if (repPill) repPill.textContent = `${reportingWardsCount} / 25 Wards Reporting`;
  if (closePill) closePill.textContent = `${closeRacesCount} Close Races (<5%)`;

  const searchQuery = (document.getElementById('councilSearch')?.value || '').toLowerCase().trim();
  const activeFilter = document.querySelector('.council-filter-pills .filter-pill.active')?.dataset.councilFilter || 'all';
  const sortMode = document.getElementById('councilSort')?.value || 'ward';

  let wards = [...allWards];

  // Filter by search query (matches ward #, ward name, or ANY council candidate name)
  if (searchQuery) {
    wards = wards.filter(w => {
      const matchWard = w.ward_num.toString() === searchQuery ||
                        `w${w.ward_num}` === searchQuery ||
                        `ward ${w.ward_num}`.includes(searchQuery) ||
                        w.ward_name.toLowerCase().includes(searchQuery);
      const matchCand = (w.council?.all_candidates || w.council?.top3 || []).some(c =>
        c.name.toLowerCase().includes(searchQuery)
      );
      return matchWard || matchCand;
    });
  }

  // Filter by region or close status
  if (activeFilter === 'close') {
    const anyReporting = allWards.some(w => (w.council?.total_votes || 0) > 0);
    if (anyReporting) {
      wards = wards.filter(w => (w.council?.total_votes || 0) > 0 && (w.council?.margin_pct || 0) <= 5.0);
    } else {
      // Before polls report, show all wards sorted by candidate count or closest margin
      wards = wards.slice().sort((a, b) => (b.council?.candidates_count || 0) - (a.council?.candidates_count || 0));
    }
  } else if (REGION_WARDS[activeFilter]) {
    const allowed = REGION_WARDS[activeFilter];
    wards = wards.filter(w => allowed.includes(w.ward_num));
  }

  // Sort wards
  if (sortMode === 'margin') {
    wards.sort((a, b) => {
      const aHas = (a.council?.total_votes || 0) > 0 ? 0 : 1;
      const bHas = (b.council?.total_votes || 0) > 0 ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      return (a.council?.margin_pct || 0) - (b.council?.margin_pct || 0) || (a.ward_num - b.ward_num);
    });
  } else if (sortMode === 'votes') {
    wards.sort((a, b) => (b.council?.total_votes || 0) - (a.council?.total_votes || 0) || (a.ward_num - b.ward_num));
  } else if (sortMode === 'reporting') {
    wards.sort((a, b) => (b.council?.polls_reporting_pct || 0) - (a.council?.polls_reporting_pct || 0) || (a.ward_num - b.ward_num));
  } else {
    wards.sort((a, b) => a.ward_num - b.ward_num);
  }

  grid.innerHTML = '';

  if (wards.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
        No wards or council candidates found matching "<strong>${searchQuery}</strong>".
      </div>
    `;
    return;
  }

  wards.forEach(w => {
    const council = w.council || {};
    const cTotalVotes = council.total_votes || 0;
    const cPollsRep = council.polls_reported || w.polls_reported || 0;
    const cPollsTot = council.polls_total || w.polls_total || 0;
    const cPollsPct = council.polls_reporting_pct || w.polls_reporting_pct || 0;
    const hasVotes = cTotalVotes > 0;
    const isClose = council.is_close_race;

    const article = document.createElement('article');
    article.className = `council-ward-card${selectedWardNum === w.ward_num ? ' selected' : ''}${isClose ? ' close-race' : ''}`;
    article.dataset.wardNum = w.ward_num;

    // Status / Margin Badge
    let badgeHtml = '';
    if (hasVotes && council.leader && council.leader !== 'Pending') {
      if (council.leader === 'Tied') {
        badgeHtml = `<span class="table-badge council-close">TIED</span>`;
      } else {
        const lastName = council.leader.split(' ').slice(-1)[0];
        const cls = isClose ? 'table-badge council-close' : 'table-badge council-lead';
        const prefix = isClose ? '🔥 ' : '';
        badgeHtml = `<span class="${cls}" title="${council.leader} leading by ${(council.margin_votes || 0).toLocaleString()} votes">${prefix}${lastName} +${(council.margin_pct || 0).toFixed(1)}%</span>`;
      }
    } else {
      badgeHtml = `<span class="table-badge pending">Awaiting Polls</span>`;
    }

    // Determine Top 3 candidates to display (plus any lower-ranked candidate matching searchQuery)
    const allCands = council.all_candidates || council.top3 || [];
    const displayCands = allCands.slice(0, 3);
    if (searchQuery) {
      const extraMatch = allCands.slice(3).find(c => c.name.toLowerCase().includes(searchQuery));
      if (extraMatch) {
        displayCands.push(extraMatch);
      }
    }

    const maxCandPct = Math.max(1, ...displayCands.map(c => c.percentage || 0));

    const candsHtml = displayCands.map((cand, idx) => {
      const rank = cand.rank || (idx + 1);
      const isLeaderRow = hasVotes && rank === 1 && cand.votes > 0;
      const isSearchMatch = searchQuery && cand.name.toLowerCase().includes(searchQuery);
      const rankClass = hasVotes && cand.votes > 0
        ? (rank === 1 ? 'rank-1-active' : rank === 2 ? 'rank-2-active' : rank === 3 ? 'rank-3-active' : '')
        : '';
      const fillClass = rank === 1 ? 'fill-rank-1' : rank === 2 ? 'fill-rank-2' : 'fill-rank-3';
      const barWidth = hasVotes ? Math.min(100, Math.max(3, (cand.percentage / maxCandPct) * 100)) : 0;

      return `
        <li class="council-cand-item${isLeaderRow ? ' is-leader' : ''}${isSearchMatch ? ' match-highlight' : ''}">
          <div class="council-cand-row">
            <div class="council-cand-left">
              <span class="council-rank ${rankClass}">${rank}</span>
              <span class="council-cand-name" title="${cand.name}">${cand.name}</span>
            </div>
            <div class="council-cand-stats">
              <span class="council-cand-votes">${(cand.votes || 0).toLocaleString()}</span>
              <span class="council-cand-pct">${(cand.percentage || 0).toFixed(1)}%</span>
            </div>
          </div>
          <div class="council-mini-bar-track">
            <div class="council-mini-bar-fill ${fillClass}" style="width: ${barWidth}%"></div>
          </div>
        </li>
      `;
    }).join('');

    const totalCandCount = council.candidates_count || allCands.length;
    const remainingCount = Math.max(0, totalCandCount - displayCands.length);

    article.innerHTML = `
      <header class="council-card-header">
        <div class="council-ward-title-group">
          <span class="ward-num-pill">W${w.ward_num}</span>
          <h3 title="Ward ${w.ward_num}: ${w.ward_name}">${w.ward_name}</h3>
        </div>
        ${badgeHtml}
      </header>
      <ul class="council-top3-list">
        ${candsHtml}
      </ul>
      <footer class="council-card-footer">
        <div class="council-polls-bar">
          <div class="council-polls-fill" style="width: ${Math.min(100, cPollsPct)}%"></div>
        </div>
        <div class="council-footer-meta">
          <span>${cPollsRep}/${cPollsTot} polls (${cPollsPct.toFixed(0)}%) • ${cTotalVotes.toLocaleString()} votes</span>
          <span>${remainingCount > 0 ? `+${remainingCount} more` : `${totalCandCount} cands`} →</span>
        </div>
      </footer>
    `;

    article.addEventListener('click', () => {
      // Switch inspector tab to 'council' automatically when clicking a council card
      document.querySelectorAll('.insp-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.inspTab === 'council'));
      document.getElementById('inspCouncilPanel')?.classList.remove('hidden');
      document.getElementById('inspMayorPanel')?.classList.add('hidden');

      selectWard(w.ward_num, null);
    });

    grid.appendChild(article);
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

  const isDark = getEffectiveTheme() === 'dark';
  const gridColor = isDark ? '#1e293b' : '#e2e8f0';
  const textColor = isDark ? '#94a3b8' : '#64748b';
  const titleColor = isDark ? '#ffffff' : '#0f172a';
  const legendColor = isDark ? '#cbd5e1' : '#334155';
  const tooltipBg = isDark ? '#1e293b' : '#ffffff';
  const tooltipBorder = isDark ? '#334155' : '#cbd5e1';

  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Olivia Chow',
          data: chowVotes,
          borderColor: '#ea580c',
          backgroundColor: 'rgba(234, 88, 12, 0.12)',
          fill: true,
          tension: 0.3,
          borderWidth: 2.5,
          pointRadius: historyData.length > 20 ? 1 : 3
        },
        {
          label: 'Brad Bradford',
          data: bradfordVotes,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.12)',
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
          labels: { color: legendColor, font: { size: 12, weight: 'bold' } }
        },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: titleColor,
          bodyColor: legendColor,
          borderColor: tooltipBorder,
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor }
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            callback: (val) => val.toLocaleString()
          }
        }
      }
    }
  });
}

/**
 * Update Chart theme styling dynamically
 */
function updateChartTheme() {
  if (!historyChart) return;
  const isDark = getEffectiveTheme() === 'dark';
  const gridColor = isDark ? '#1e293b' : '#e2e8f0';
  const textColor = isDark ? '#94a3b8' : '#64748b';
  const titleColor = isDark ? '#ffffff' : '#0f172a';
  const legendColor = isDark ? '#cbd5e1' : '#334155';
  const tooltipBg = isDark ? '#1e293b' : '#ffffff';
  const tooltipBorder = isDark ? '#334155' : '#cbd5e1';

  historyChart.options.plugins.legend.labels.color = legendColor;
  historyChart.options.plugins.tooltip.backgroundColor = tooltipBg;
  historyChart.options.plugins.tooltip.titleColor = titleColor;
  historyChart.options.plugins.tooltip.bodyColor = legendColor;
  historyChart.options.plugins.tooltip.borderColor = tooltipBorder;
  historyChart.options.scales.x.grid.color = gridColor;
  historyChart.options.scales.x.ticks.color = textColor;
  historyChart.options.scales.y.grid.color = gridColor;
  historyChart.options.scales.y.ticks.color = textColor;
  historyChart.update();
}

/**
 * Update Map Legend based on active mode
 */
function updateMapLegend() {
  const legend = document.getElementById('mapLegend');
  if (!legend) return;
  const palette = getThemePalette();

  if (currentMapView === 'margin') {
    legend.innerHTML = `
      <span style="font-weight:700; margin-right: 4px;">Chow vs Bradford Margin:</span>
      <div class="legend-item"><div class="legend-swatch" style="background:${palette.chow.strong};"></div> Chow +15%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${palette.chow.medium};"></div> Chow +5-15%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${palette.chow.lean};"></div> Chow <5%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${palette.bradford.lean};"></div> Bradford <5%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${palette.bradford.medium};"></div> Bradford +5-15%</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${palette.bradford.strong};"></div> Bradford +15%</div>
    `;
  } else if (currentMapView === 'winner') {
    legend.innerHTML = `
      <span style="font-weight:700; margin-right: 4px;">Ward Winner:</span>
      <div class="legend-item"><div class="legend-swatch" style="background:${palette.chow.medium};"></div> Olivia Chow</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${palette.bradford.medium};"></div> Brad Bradford</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#8b5cf6;"></div> Other Candidate</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${palette.pending};"></div> Awaiting Reports</div>
    `;
  } else if (currentMapView === 'council') {
    legend.innerHTML = `
      <span style="font-weight:700; margin-right: 4px;">Council Lead Margin:</span>
      <div class="legend-item"><div class="legend-swatch" style="background:#f59e0b;"></div> Close Race (&le;5%)</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#0d9488;"></div> Moderate Lead (5-15%)</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#10b981;"></div> Strong Lead (&gt;15%)</div>
      <div class="legend-item"><div class="legend-swatch" style="background:${palette.pending};"></div> Awaiting Reports</div>
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
