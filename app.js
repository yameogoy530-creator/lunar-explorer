// app.js — Lunar Explorer
// Carte Leaflet (tuiles WMS officielles NASA/ASU LROC) + appel sécurisé
// vers la Netlify Function qui interroge le modèle Hugging Face.

const ANALYZE_ENDPOINT = "/.netlify/functions/analyze";

// --- Carte Leaflet ---------------------------------------------------
const moonCRS = L.CRS.EPSG4326;

const map = L.map("map", {
  crs: moonCRS,
  center: [0, 0],
  zoom: 3,
  minZoom: 2,
  maxZoom: 8,
  worldCopyJump: false,
});

// --- Fond de carte lunaire : vraies tuiles WMS (Lunaserv) --------------
const MOON_RADIUS_M = 1737400;
const DEG2RAD = Math.PI / 180;

const moonWmsCrs = {
  code: "IAU2000:30166,9001,0,0",
  project(latlng) {
    return {
      x: latlng.lng * DEG2RAD * MOON_RADIUS_M,
      y: latlng.lat * DEG2RAD * MOON_RADIUS_M,
    };
  },
};

const lrocWms = L.tileLayer.wms("https://wms2.im-ldi.com/", {
  layers: "luna_wac_global",
  format: "image/png",
  transparent: true,
  version: "1.1.1",
  crs: moonWmsCrs,
  attribution: "Imagerie : NASA / GSFC / Arizona State University (LROC WAC)",
});

lrocWms.addTo(map);

const moonBounds = [
  [-90, -180],
  [90, 180],
];
map.setMaxBounds(moonBounds);

// --- Sélection d'un point sur la carte --------------------------------
let selectedLatLng = null;
let selectedMarker = null;

const coordLatEl = document.getElementById("coordLat");
const coordLngEl = document.getElementById("coordLng");
const analyzeBtn = document.getElementById("analyzeBtn");
const resultsContent = document.getElementById("resultsContent");
const apiStatus = document.getElementById("apiStatus");

function setStatus(state, label) {
  apiStatus.dataset.state = state;
  apiStatus.querySelector(".status-label").textContent = label;
}

map.on("click", (e) => {
  selectedLatLng = e.latlng;

  if (selectedMarker) {
    selectedMarker.setLatLng(selectedLatLng);
  } else {
    selectedMarker = L.circleMarker(selectedLatLng, {
      radius: 8,
      color: "#d9b26a",
      weight: 2,
      fillColor: "#d9b26a",
      fillOpacity: 0.25,
    }).addTo(map);
  }

  coordLatEl.textContent = selectedLatLng.lat.toFixed(3) + "°";
  coordLngEl.textContent = selectedLatLng.lng.toFixed(3) + "°";
  analyzeBtn.disabled = false;
});

// --- Appel à la Netlify Function --------------------------------------
analyzeBtn.addEventListener("click", async () => {
  if (!selectedLatLng) return;

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analyse en cours…";
  setStatus("loading", "Analyse en cours");
  resultsContent.innerHTML = `<p class="placeholder">Interrogation du modèle NASA-IBM…</p>`;

  try {
    const response = await fetch(ANALYZE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: selectedLatLng.lat,
        lng: selectedLatLng.lng,
        zoom: map.getZoom(),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const detailsText =
        data.details && typeof data.details === "object"
          ? JSON.stringify(data.details)
          : data.details;
      const message = detailsText
        ? `${data.error} (${detailsText})`
        : data.error || `Erreur HTTP ${response.status}`;
      throw new Error(message);
    }

    renderResults(data.result, data.source);
    setStatus("idle", "Modèle prêt");
  } catch (err) {
    resultsContent.innerHTML = `
      <p class="result-error">
        Échec de l'analyse : ${escapeHtml(err.message)}
      </p>`;
    setStatus("error", "Erreur");
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Lancer l'analyse IA";
  }
});

function sourceBadgeHtml(source) {
  if (source === "nasa-ibm-live") {
    return `<div class="source-badge source-badge--live">🟢 Vrai modèle NASA-IBM (session live)</div>`;
  }
  return `<div class="source-badge source-badge--fallback">🟡 Modèle de secours (classification générale)</div>`;
}

function renderResults(result, source) {
  if (!result) {
    resultsContent.innerHTML = `<p class="placeholder">Aucun résultat renvoyé par le modèle.</p>`;
    return;
  }
  const badge = source ? sourceBadgeHtml(source) : "";

  const isClassificationList =
    Array.isArray(result) &&
    result.length > 0 &&
    typeof result[0] === "object" &&
    "label" in result[0] &&
    "score" in result[0];

  if (isClassificationList) {
    resultsContent.innerHTML =
      badge +
      result
        .slice(0, 5)
        .map(
          (item) => `
        <div class="result-item">
          <span class="label">${escapeHtml(String(item.label))}</span>
          <span class="value">${(item.score * 100).toFixed(1)}%</span>
        </div>`
        )
        .join("");
    return;
  }

  const entries = Array.isArray(result)
    ? result.flatMap((r) => Object.entries(r))
    : Object.entries(result);

  if (entries.length === 0) {
    resultsContent.innerHTML = `<p class="placeholder">Résultat vide.</p>`;
    return;
  }

  resultsContent.innerHTML =
    badge +
    entries
      .map(
        ([key, value]) => `
      <div class="result-item">
        <span class="label">${escapeHtml(String(key))}</span>
        <span class="value">${escapeHtml(
          typeof value === "object" ? JSON.stringify(value) : String(value)
        )}</span>
      </div>`
      )
      .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
