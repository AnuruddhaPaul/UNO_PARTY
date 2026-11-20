'use strict';
// A private perk for the game's owner. Two things must both be true:
//   1. the player's name is one of the owner's handles (ignoring case, spaces, "_" and "-")
//   2. the phone presents the secret key, which lives only in the VIP_KEY environment variable
// The name alone is public (it is shown in the lobby), so on its own it unlocks nothing. With no
// VIP_KEY set the feature is simply off.
const crypto = require('crypto');
const norm = (s) => String(s || '').toUpperCase().replace(/[\s_\-]+/g, '');
const HANDLES = new Set(['ANI_MrPaul_72', 'Ani_Paul', 'Onu_Paul', 'ANI_PAUL', 'ANU_PAUL', 'ANI_Mr Paul_72', 'ANU_72'].map(norm));

function isVip(name, key, secret = process.env.VIP_KEY) {
  if (!secret || typeof key !== 'string' || !HANDLES.has(norm(name))) return false;
  const a = crypto.createHash('sha256').update(key).digest(), b = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}
module.exports = { isVip, HANDLES, norm };
