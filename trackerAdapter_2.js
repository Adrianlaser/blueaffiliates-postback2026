const { Pool } = require("pg");

/**
 * Adaptateur entre un postback BlueAffiliates vérifié et dédupliqué, et
 * une base Postgres.
 *
 * Nécessite la variable d'environnement DATABASE_URL, fournie par
 * Railway via la référence ${{Postgres.DATABASE_URL}} dans les
 * Variables du service (pas besoin de connaître la valeur en clair —
 * Railway la résout automatiquement au démarrage).
 *
 * Logique de jointure selon la spec BlueAffiliates :
 *   - Préférer {clickid} (rempli uniquement si le clic est passé par
 *     le lien de tracking S2S).
 *   - Se rabattre sur {player_token} sinon.
 *
 * `commission` n'est rempli que pour l'événement commission_paid —
 * comportement attendu, pas un bug.
 */

if (!process.env.DATABASE_URL) {
  console.error(
    "FATAL: DATABASE_URL n'est pas définie. Ajoutez ${{Postgres.DATABASE_URL}} " +
      "dans les Variables du service blueaffiliates-postback2026 sur Railway " +
      "(pas dans celles du service Postgres lui-même)."
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway expose Postgres avec un certificat auto-signé en interne ;
  // on désactive la vérification stricte du certificat pour cette
  // connexion réseau interne au projet Railway.
  ssl: { rejectUnauthorized: false },
});

// Créé la table au premier démarrage si elle n'existe pas déjà.
// Idempotent : ne fait rien si la table existe déjà.
const READY = pool
  .query(`
    CREATE TABLE IF NOT EXISTS conversions (
      id BIGSERIAL PRIMARY KEY,
      transaction_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      join_key TEXT NOT NULL,
      clickid TEXT,
      player_token TEXT,
      amount NUMERIC,
      commission NUMERIC,
      currency TEXT,
      occurred_at_hour TIMESTAMPTZ,
      campaign_slug TEXT,
      sub1 TEXT,
      sub2 TEXT,
      sub3 TEXT,
      country TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  .then(() => {
    console.log("[trackerAdapter] table 'conversions' prête");
  })
  .catch((err) => {
    console.error("[trackerAdapter] échec de création de la table :", err);
  });

async function recordConversion(event) {
  const {
    event: eventType, // registration | ftd | deposit | qualification | commission_paid
    clickid,
    player_token,
    amount,
    commission,
    currency,
    timestamp_hour,
    campaign_slug,
    transaction_id,
    sub1,
    sub2,
    sub3,
    country,
  } = event;

  const joinKey = clickid || player_token;
  if (!joinKey) {
    console.warn(
      `[trackerAdapter] pas de clickid ni player_token pour transaction_id=${transaction_id}, event=${eventType} — attribution ignorée`
    );
    return;
  }

  // S'assure que la table est prête avant la toute première écriture.
  await READY;

  try {
    await pool.query(
      `INSERT INTO conversions (
         transaction_id, event_type, join_key, clickid, player_token,
         amount, commission, currency, occurred_at_hour, campaign_slug,
         sub1, sub2, sub3, country
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (transaction_id) DO NOTHING`,
      [
        transaction_id,
        eventType,
        joinKey,
        clickid || null,
        player_token || null,
        amount ? Number(amount) : null,
        commission ? Number(commission) : null,
        currency || null,
        timestamp_hour || null,
        campaign_slug || null,
        sub1 || null,
        sub2 || null,
        sub3 || null,
        country || null,
      ]
    );
    console.log(
      `[trackerAdapter] conversion enregistrée : transaction_id=${transaction_id}, event=${eventType}, joinKey=${joinKey}`
    );
  } catch (err) {
    // Propage l'erreur : server.js la logge déjà comme échec
    // "non-retryable" (le postback est déjà acquitté), donc c'est
    // juste pour garder une trace claire ici aussi.
    console.error(
      `[trackerAdapter] échec d'écriture en base pour transaction_id=${transaction_id}:`,
      err.message
    );
    throw err;
  }
}

module.exports = { recordConversion };
