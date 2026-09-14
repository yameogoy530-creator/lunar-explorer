// netlify/functions/analyze.js
//
// Proxy serverless entre le frontend et l'API d'inférence Hugging Face.
// Le HF_TOKEN n'est JAMAIS exposé au navigateur : il vit uniquement dans
// les variables d'environnement Netlify et est lu ici, côté serveur.
//
// Cette fonction fait deux choses :
//   1. Récupère une vraie image de la zone cliquée via le WMS lunaire
//      (wms2.im-ldi.com), côté serveur (pas de souci CORS).
//   2. Envoie cette image à un modèle de classification d'image sur
//      Hugging Face et renvoie le résultat au frontend.
//
// Le modèle NASA-IBM Lunar Foundation Model (et ses checkpoints dérivés
// crater-detection / IMP-segmentation / ice-prospectivity) ne sont PAS
// déployés sur un fournisseur d'inférence — ce sont des poids bruts
// TerraTorch, exécutables seulement via du code Python dédié (voir la
// discussion du guide). On utilise donc ici un classificateur d'image
// généraliste, recommandé par la doc officielle Hugging Face pour la
// tâche "image-classification" sur le fournisseur gratuit hf-inference.
// Les résultats seront des catégories génériques (ImageNet), pas des
// labels lunaires spécifiques.
const HF_MODEL = "google/vit-base-patch16-224";
// Solutions de repli si ce modèle affiche à son tour
// "Model not supported by provider hf-inference" (l'écosystème évolue
// vite) : "facebook/convnext-large-224" ou "Falconsai/nsfw_image_detection"
// (ce dernier cité tel quel dans l'exemple officiel de la doc HF).

const HF_API_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;

// --- Géométrie lunaire (voir aussi app.js) ------------------------------
const MOON_RADIUS_M = 1737400;
const DEG2RAD = Math.PI / 180;
const MOON_WMS_URL = "https://wms2.im-ldi.com/";
const MOON_WMS_SRS = "IAU2000:30166,9001,0,0";
const TILE_SIZE_M = 51200; // 51.2 km de côté (échelle "contexte", ~100 m/px)
const TILE_PIXELS = 256;

function buildMoonTileUrl(lat, lng) {
  const cx = lng * DEG2RAD * MOON_RADIUS_M;
  const cy = lat * DEG2RAD * MOON_RADIUS_M;
  const half = TILE_SIZE_M / 2;
  const bbox = [cx - half, cy - half, cx + half, cy + half].join(",");

  const params = new URLSearchParams({
    LAYERS: "luna_wac_global",
    FORMAT: "image/jpeg",
    TRANSPARENT: "false",
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    STYLES: "",
    SRS: MOON_WMS_SRS,
    BBOX: bbox,
    WIDTH: String(TILE_PIXELS),
    HEIGHT: String(TILE_PIXELS),
  });

  return `${MOON_WMS_URL}?${params.toString()}`;
}

exports.handler = async (event) => {
  // --- CORS / méthode -------------------------------------------------
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Méthode non autorisée. Utilise POST." }),
    };
  }

  // --- Clé API ----------------------------------------------------------
  const HF_TOKEN = process.env.HF_TOKEN;
  if (!HF_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error:
          "HF_TOKEN manquant côté serveur. Ajoute-le dans Netlify > Site settings > Environment variables.",
      }),
    };
  }

  // --- Corps de la requête reçue du frontend -----------------------------
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Corps de requête JSON invalide." }),
    };
  }

  const { lat, lng } = payload;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "lat/lng manquants ou invalides." }),
    };
  }

  try {
    // --- Étape 1 : récupérer une vraie image de la zone -----------------
    const tileUrl = buildMoonTileUrl(lat, lng);
    const tileResponse = await fetch(tileUrl);

    if (!tileResponse.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: "Impossible de récupérer l'image de la zone (service WMS).",
          details: `HTTP ${tileResponse.status}`,
        }),
      };
    }

    const imageBuffer = Buffer.from(await tileResponse.arrayBuffer());

    // --- Étape 2 : envoyer cette image au modèle Hugging Face -----------
    const hfResponse = await fetch(HF_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "image/jpeg",
      },
      body: imageBuffer,
    });

    const rawText = await hfResponse.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      data = { raw: rawText };
    }

    // Le modèle peut être "en cours de chargement" (cold start) : Hugging
    // Face renvoie alors un code 503 avec un champ "estimated_time".
    if (hfResponse.status === 503) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          error: "Le modèle se charge encore sur les serveurs Hugging Face.",
          estimated_time: data.estimated_time || null,
        }),
      };
    }

    if (!hfResponse.ok) {
      return {
        statusCode: hfResponse.status,
        headers,
        body: JSON.stringify({
          error: "Erreur renvoyée par l'API Hugging Face.",
          details: data,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ result: data }),
    };
  } catch (err) {
    // On logge l'erreur complète côté serveur (visible dans Netlify >
    // Cloud compute > analyze > Logs) pour pouvoir diagnostiquer.
    console.error("Erreur lors de l'analyse :", err);

    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: "Échec de l'analyse.",
        details: err.message,
        name: err.name,
      }),
    };
  }
};
