/**
 * Adapter between a verified, deduplicated BlueAffiliates postback and
 * YOUR tracker/CRM/DB. This is the one file you need to customize —
 * everything else in this project is generic to the BlueAffiliates spec.
 *
 * Join logic per the spec:
 *   - Prefer {clickid} (populated only if the click went through your
 *     S2S tracking link — see spec section 5).
 *   - Fall back to {player_token} for events where clickid is empty
 *     (e.g. traffic that didn't originate from your redirect link, or
 *     a later event you want to attribute via the stable player id).
 *
 * `event.commission` is only non-empty for commission_paid — that's
 * expected, not a bug, per the spec.
 */

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
    // Nothing to attribute this to. Log for investigation but don't throw —
    // we've already ack'd the postback and shouldn't trigger retries over
    // an attribution gap.
    console.warn(
      `[trackerAdapter] no clickid or player_token for transaction_id=${transaction_id}, event=${eventType} — skipping attribution`
    );
    return;
  }

  // ---------------------------------------------------------------------
  // TODO: replace this block with your actual tracker write, e.g.:
  //
  //   await db.conversions.upsert({
  //     where: { transactionId: transaction_id },
  //     create: {
  //       transactionId: transaction_id,
  //       eventType,
  //       joinKey,
  //       amount: amount ? Number(amount) : null,
  //       commission: commission ? Number(commission) : null,
  //       currency,
  //       occurredAtHour: timestamp_hour,
  //       campaignSlug: campaign_slug,
  //       sub1, sub2, sub3, country,
  //     },
  //     update: {},
  //   });
  // ---------------------------------------------------------------------
  console.log("[trackerAdapter] recording conversion", {
    transaction_id,
    eventType,
    joinKey,
    amount,
    commission,
    currency,
    timestamp_hour,
    campaign_slug,
    sub1,
    sub2,
    sub3,
    country,
  });
}

module.exports = { recordConversion };
