# Lunar Explorer 🌕

Application web interactive d'exploration de la Lune : carte Leaflet alimentée par de vraies tuiles satellite NASA/LROC, avec un panneau d'analyse IA qui détecte les cratères de la zone sélectionnée grâce au **NASA-IBM Lunar Foundation Model**.

**Site en ligne :** `https://lunar-explore.netlify.app`

---

## ⚠️ À lire avant toute chose : le vrai modèle NASA-IBM n'est pas branché en permanence

Le site fonctionne **24h/24 pour tout le monde**, mais utilise par défaut un modèle d'IA générique de secours. Pour que le **vrai** modèle NASA-IBM réponde, une action manuelle est nécessaire à chaque session.

### La cause

Faire tourner le vrai modèle NASA-IBM (via TerraTorch) exige une machine avec GPU allumée en continu. Aucune option gratuite et **permanente** n'est disponible sans carte bancaire **physique** :

| Option envisagée | Pourquoi elle ne fonctionne pas ici |
|---|---|
| Hugging Face Spaces (Gradio/Docker) | Devenu payant (PRO, 9 $/mois) pour les comptes gratuits |
| Google Cloud Run (offre "Always Free") | Carte bancaire **physique** obligatoire (les cartes virtuelles/prépayées type Eversend sont explicitement refusées par Google) |
| Hébergeurs Python gratuits (PythonAnywhere, etc.) | RAM/disque insuffisants pour PyTorch + le modèle |

**Solution retenue** : le vrai modèle tourne sur **Google Colab** (gratuit, GPU, aucune carte requise), exposé publiquement via un tunnel Cloudflare le temps que la notebook reste ouverte. Dès que la notebook se ferme, son adresse publique disparaît — d'où la nécessité d'un redémarrage manuel avant chaque utilisation du vrai modèle.

### La procédure de réactivation (à faire à chaque fois)

1. Ouvrir la notebook Google Colab du projet.
2. **Runtime → Change runtime type → GPU (T4)**, si ce n'est pas déjà actif.
3. Exécuter toutes les cellules dans l'ordre (installation → chargement du modèle → lancement du serveur → lancement du tunnel Cloudflare).
4. Copier la **nouvelle URL publique** affichée par le tunnel (elle change à chaque redémarrage).
5. Sur Netlify : **Site configuration → Environment variables → `COLAB_ENDPOINT_URL`** → coller la nouvelle URL.
6. **Deploys → Trigger deploy → Deploy site** (obligatoire : une variable d'environnement modifiée n'est prise en compte qu'après un redéploiement).

Tant que cette procédure n'est pas faite (ou si la notebook Colab a été fermée depuis), le site continue de fonctionner normalement grâce au modèle de secours — aucun visiteur ne tombe sur une erreur.

---

## Architecture

```
Frontend (Leaflet + JS vanilla)
        │  fetch()
        ▼
Netlify Function (netlify/functions/analyze.js)
        │
        ├─► WMS lunaire (wms2.im-ldi.com) : récupère une image de la zone cliquée
        │
        ├─► [1er essai] Notebook Google Colab (URL dans COLAB_ENDPOINT_URL)
        │      → vrai modèle NASA-IBM (backbone + adaptateur LoRA crater-detection)
        │      → si indisponible (notebook fermée) : bascule automatique ↓
        │
        └─► [secours] Hugging Face — modèle de classification générique
               → toujours disponible, garantit un site fonctionnel 24h/24
```

Un badge sur le site indique toujours quelle source a répondu : 🟢 *vrai modèle NASA-IBM (session live)* ou 🟡 *modèle de secours*.

## Stack technique

| Couche | Techno |
|---|---|
| Carte | Leaflet.js 1.9 |
| Frontend | HTML / CSS / JavaScript vanilla |
| Backend | Netlify Functions (Node.js) |
| Imagerie | WMS Lunaserv (`wms2.im-ldi.com`), mosaïque LROC WAC |
| Vrai modèle IA | NASA-IBM Lunar Foundation Model + adaptateur LoRA crater-detection, via TerraTorch |
| Hébergement du vrai modèle | Google Colab (GPU gratuit) + tunnel Cloudflare |
| Modèle de secours | `google/vit-base-patch16-224` (Hugging Face) |
| Hébergement du site | Netlify (déploiement continu depuis GitHub) |

## Le modèle NASA-IBM en bref

Le `NASA-IBM Lunar Foundation Model` (sorti le 10/09/2026) est un modèle de base (*foundation model*) open source entraîné sur des données lunaires. Il n'est pas spécialisé par défaut : ce projet utilise l'adaptateur `Crater-Detection-NASA-IBM-Lunar-Foundation-Model` (technique LoRA), qui le spécialise pour la détection de cratères à partir d'imagerie LROC WAC (~100 m/pixel).

## Déploiement du site (hors réactivation du vrai modèle)

1. `git push` sur `main` → Netlify redéploie automatiquement.
2. Variable d'environnement requise : `HF_TOKEN` (token Hugging Face, rôle "Read", scope Functions) — pour le modèle de secours.
3. Variable optionnelle : `COLAB_ENDPOINT_URL` — pour activer le vrai modèle (voir procédure ci-dessus).

## Crédits

- Imagerie lunaire : NASA / GSFC / Arizona State University (LROC WAC)
- Service WMS : Lunaserv (im-ldi.com)
- Modèle NASA-IBM : NASA / IBM (`nasa-ibm-ai4science`, Hugging Face)
- Modèle de secours : Google (`vit-base-patch16-224`) via Hugging Face
