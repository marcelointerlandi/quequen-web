// netlify/functions/actividad.js
// Esta función intercepta links del tipo /actividad/ID
// y devuelve un HTML con las meta tags correctas para WhatsApp/Facebook.
// Luego redirige automáticamente al usuario al sitio real con el hash.

const https = require("https");

// ── Configuración de Firebase ──────────────────────────────────────────────
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT || "pj-quequen";
const FIREBASE_API_KEY  = process.env.FIREBASE_API_KEY;

// Hace un GET a la API REST de Firestore (no necesita SDK)
function firestoreGet(docPath) {
    return new Promise((resolve, reject) => {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${docPath}?key=${FIREBASE_API_KEY}`;
        https.get(url, (res) => {
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
                try { resolve(JSON.parse(body)); }
                catch(e) { reject(e); }
            });
        }).on("error", reject);
    });
}

// Convierte el formato de Firestore a un objeto plano
function parseFirestoreDoc(doc) {
    if (!doc.fields) return null;
    const result = {};
    for (const [key, val] of Object.entries(doc.fields)) {
        if (val.stringValue  !== undefined) result[key] = val.stringValue;
        else if (val.integerValue !== undefined) result[key] = Number(val.integerValue);
        else if (val.doubleValue  !== undefined) result[key] = val.doubleValue;
        else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
        else if (val.arrayValue) {
            result[key] = (val.arrayValue.values || []).map(v => {
                // Para arrays de mapas (media)
                if (v.mapValue) {
                    const m = {};
                    for (const [mk, mv] of Object.entries(v.mapValue.fields || {})) {
                        m[mk] = mv.stringValue || mv.booleanValue || "";
                    }
                    return m;
                }
                return v.stringValue || "";
            });
        }
    }
    return result;
}

// Escapa caracteres especiales para HTML
function esc(str) {
    return (str || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

exports.handler = async (event) => {
    // Obtener el ID de la actividad desde la URL: /actividad/ACTIVITY_ID
    const parts = event.path.split("/").filter(Boolean);
    const activityId = parts[parts.length - 1];

    if (!activityId) {
        return { statusCode: 302, headers: { Location: "/" } };
    }

    let title       = "Partido Justicialista de Necochea, Unidad Básica Quequén";
    let description = "La UB de Quequén del Partido Justicialista de Necochea, comprometida con el bienestar de nuestra comunidad.";
    let image       = "";
    const siteUrl   = "https://pjquequenense.com.ar";
    const actUrl    = `${siteUrl}/#actividad-${activityId}`;

    try {
        const doc  = await firestoreGet(`activities/${activityId}`);
        const data = parseFirestoreDoc(doc);

        if (data) {
            title = data.title || title;

            // Descripción: quitar HTML y recortar
            const plainDesc = (data.description || "")
                .replace(/<[^>]*>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            description = plainDesc.substring(0, 200) + (plainDesc.length > 200 ? "…" : "");

            // Imagen: primero buscar en media[], luego en images[], luego image
            if (data.media && data.media.length > 0) {
                const firstImg = data.media.find(m => m.type === "img");
                image = firstImg ? firstImg.url : (data.media[0].thumb || "");
            } else if (data.images && data.images.length > 0) {
                image = data.images[0];
            } else if (data.image) {
                image = data.image;
            }
        }
    } catch (err) {
        console.error("Error fetching activity:", err);
        // Si falla, igual redirigimos al sitio
    }

    // HTML mínimo con meta tags OG + redirect automático al hash
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${esc(title)}</title>

  <!-- Open Graph / WhatsApp / Facebook -->
  <meta property="og:type"        content="article">
  <meta property="og:site_name"   content="PJ Quequén">
  <meta property="og:title"       content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url"         content="${esc(actUrl)}">
  ${image ? `<meta property="og:image"       content="${esc(image)}">
  <meta property="og:image:width"  content="1200">
  <meta property="og:image:height" content="630">` : ""}

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  ${image ? `<meta name="twitter:image" content="${esc(image)}">` : ""}

  <!-- Redirige al usuario al sitio real con el hash -->
  <meta http-equiv="refresh" content="0; url=${esc(actUrl)}">
  <script>window.location.replace("${actUrl.replace(/"/g, '\\"')}");</script>
</head>
<body>
  <p>Redirigiendo... <a href="${esc(actUrl)}">Hacé clic aquí si no redirige automáticamente</a></p>
</body>
</html>`;

    return {
        statusCode: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            // Cache corto: 5 minutos para bots, 0 para usuarios
            "Cache-Control": "public, max-age=300",
        },
        body: html,
    };
};