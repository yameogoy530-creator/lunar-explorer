// app.js — Lunar Explorer
// Carte Leaflet (tuiles WMS officielles NASA/ASU LROC) + appel sécurisé
// vers la Netlify Function qui interroge le modèle Hugging Face.

const ANALYZE_ENDPOINT = "/.netlify/functions/analyze";

// --- Carte Leaflet ---------------------------------------------------
// La Lune n'a pas de CRS Web Mercator standard : on utilise EPSG:4326
// (grille lat/lng simple) comme le fait la plupart des services WMS
// planétaires (LROC, Moon Trek, QuickMap).
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
// Le service LROC vit désormais sur wms2.im-ldi.com (confirmé via
// l'onglet Réseau du navigateur). Contrairement à un WMS terrestre
// classique, Lunaserv exprime ses coordonnées dans une projection
// cylindrique simple propre à la Lune, EN MÈTRES (pas en degrés), avec
// un code SRS spécifique : IAU2000:30166,9001,0,0.
//
// On garde la carte Leaflet elle-même en lat/lng classique (EPSG:4326)
// pour la logique de pan/zoom, mais on fournit à la couche WMS un CRS
// "sur mesure" qui convertit chaque coordonnée lat/lng en mètres sur la
// sphère lunaire (rayon moyen 1 737 400 m) avant de construire l'URL de
// requête GetMap — c'est ce que Leaflet appelle en interne pour calculer
// le paramètre BBOX.
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

// Si jamais ce service devient à son tour indisponible, un secours fiable
// (image statique NASA, sans dépendance WMS) :
//   L.imageOverlay(
//     "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg",
//     moonBounds
//   ).addTo(map);

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
        // Adapte ce payload au format d'entrée réel attendu par le modèle
        // (voir la note dans le README / le guide fourni).
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

    renderResults(data.result);
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

function renderResults(result) {
  if (!result) {
    resultsContent.innerHTML = `<p class="placeholder">Aucun résultat renvoyé par le modèle.</p>`;
    return;
  }

  // Le format exact dépend de la tâche exposée par le modèle sur
  // Hugging Face (classification, segmentation, embeddings…). On affiche
  // ici un rendu générique clé/valeur, à adapter une fois le schéma de
  // sortie confirmé.
  const entries = Array.isArray(result)
    ? result.flatMap((r) => Object.entries(r))
    : Object.entries(result);

  if (entries.length === 0) {
    resultsContent.innerHTML = `<p class="placeholder">Résultat vide.</p>`;
    return;
  }

  resultsContent.innerHTML = entries
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
