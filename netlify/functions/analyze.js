// netlify/functions/analyze.js
//
// Proxy serverless entre le frontend et l'API d'inférence Hugging Face.
// Le HF_TOKEN n'est JAMAIS exposé au navigateur : il vit uniquement dans
// les variables d'environnement Netlify et est lu ici, côté serveur.

const HF_MODEL = "nasa-ibm-ai4science/NASA-IBM-Lunar-Foundation-Model";
const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

// Le frontend n'est autorisé à appeler cette fonction qu'en POST.
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

  // payload attendu, par exemple :
  // { lat: -8.97, lng: 24.4, zoom: 8, imageBase64: "..." }
  // Le foundation model NASA-IBM (famille Prithvi / TerraTorch) attend en
  // réalité des tuiles multi-bandes en entrée, pas de simples coordonnées :
  // adapte le corps ci-dessous ("inputs") au format réellement exigé par
  // le modèle une fois que tu as confirmé son schéma d'entrée sur sa
  // fiche Hugging Face (voir la note dans le guide).
  const hfBody = {
    inputs: payload.imageBase64 || payload,
    parameters: payload.parameters || {},
  };

  try {
    const hfResponse = await fetch(HF_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(hfBody),
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
    console.error("Erreur lors de l'appel à Hugging Face :", err);

    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: "Impossible de contacter l'API Hugging Face.",
        details: err.message,
        name: err.name,
      }),
    };
  }
};
