// netlify/functions/analyze.js
//
// Proxy serverless entre le frontend et l'analyse IA. Le HF_TOKEN n'est
// JAMAIS exposé au navigateur : il vit uniquement dans les variables
// d'environnement Netlify et est lu ici, côté serveur.
//
// Architecture "double filet de sécurité" :
//   1. Récupère une vraie image de la zone cliquée via le WMS lunaire
//      (wms2.im-ldi.com), côté serveur (pas de souci CORS).
//   2. Essaie d'abord le VRAI modèle NASA-IBM, exposé temporairement via
//      une notebook Google Colab (variable d'env COLAB_ENDPOINT_URL).
//      Cette notebook ne tourne que quand son propriétaire l'a lancée.
//   3. Si Colab ne répond pas (variable absente, timeout, erreur), bascule
//      automatiquement sur un modèle de classification généraliste
//      toujours disponible sur Hugging Face — pour que le site reste
//      fonctionnel 24h/24 pour n'importe quel visiteur.
const HF_MODEL = "google/vit-base-patch16-224";
const HF_API_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;
const COLAB_TIMEOUT_MS = 12000; // le tunnel + le modèle doivent répondre vite

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

// Essaie le vrai modèle NASA-IBM via la notebook Colab. Renvoie null si
// indisponible (pas d'URL configurée, timeout, erreur) plutôt que de
// planter — c'est le signal pour basculer sur le modèle de secours.
async function tryColabModel(imageBuffer) {
  const endpoint = process.env.COLAB_ENDPOINT_URL;
  if (!endpoint) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COLAB_TIMEOUT_MS);

  try {
    const url = endpoint.replace(/\/$/, "") + "/analyze";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: imageBuffer,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    clearTimeout(timeout);
    console.log("Colab indisponible, bascule sur le modèle de secours :", err.message);
    return null;
  }
}
// Modèle de secours toujours disponible (classification généraliste).
async function tryHuggingFaceModel(imageBuffer) {
  const hfToken = process.env.HF_TOKEN;

  try {
    const response = await fetch(HF_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfToken}`,
        "Content-Type": "image/jpeg",
      },
      body: imageBuffer,
    });

    if (!response.ok) {
      console.log("Modèle de secours Hugging Face indisponible :", response.status);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.log("Erreur avec le modèle de secours :", err.message);
    return null;
  }
}

// Point d'entrée de la fonction Netlify.
exports.handler = async (event) => {
  try {
    const { lat, lng } = event.queryStringParameters || {};

    if (lat === undefined || lng === undefined) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Paramètres 'lat' et 'lng' requis." }),
      };
    }

    const tileUrl = buildMoonTileUrl(parseFloat(lat), parseFloat(lng));
    const tileResponse = await fetch(tileUrl);

    if (!tileResponse.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Impossible de récupérer l'image de la zone (WMS)." }),
      };
    }

    const imageBuffer = Buffer.from(await tileResponse.arrayBuffer());

    let result = await tryColabModel(imageBuffer);
    if (!result) {
      result = await tryHuggingFaceModel(imageBuffer);
    }

    if (!result) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Aucun modèle d'analyse n'est disponible pour le moment." }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
