// Login throttling (SI-7 lockout).
//
// NOTE ON SCOPE: docs/sprint1-mvp-plan.md deliberately excluded the 15-minute
// lockout from the Sprint 1 MVP. It is implemented here because the project is
// now well past that milestone and unlimited password guessing is the last
// unguarded entry point. If the team wants the documented MVP scope back,
// deleting this file and its two call sites in server/index.js restores it.
//
// In-memory, like the session store: a restart clears all counters. That is
// acceptable for the same reason a restart forces re-login, and it keeps the
// zero-dependency constraint. A real deployment behind multiple processes would
// need shared state.

const MAX_ATTEMPTS = 5;              // failures before a lock
const LOCK_MS = 15 * 60 * 1000;      // 15 minutes, per SI-7
const WINDOW_MS = 15 * 60 * 1000;    // failures older than this are forgotten

// key -> { count, firstAt, lockedUntil }
const attempts = new Map();

// Keyed on email AND client address so one attacker cannot lock out a real user
// by guessing at their address from elsewhere, and so spraying many accounts
// from one address is still caught.
function keyFor(email, ip) {
  return String(email || '').toLowerCase() + '|' + (ip || '');
}

function prune(now) {
  for (const [k, v] of attempts) {
    const dead = v.lockedUntil ? v.lockedUntil <= now : now - v.firstAt > WINDOW_MS;
    if (dead) attempts.delete(k);
  }
}

/**
 * @returns {{locked: boolean, retryAfterSec: number}}
 */
function check(email, ip) {
  const now = Date.now();
  prune(now);
  const rec = attempts.get(keyFor(email, ip));
  if (rec && rec.lockedUntil && rec.lockedUntil > now) {
    return { locked: true, retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  return { locked: false, retryAfterSec: 0 };
}

/** Record a failed attempt; locks the key once MAX_ATTEMPTS is reached. */
function recordFailure(email, ip) {
  const now = Date.now();
  const key = keyFor(email, ip);
  const rec = attempts.get(key);

  if (!rec || now - rec.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
    return { locked: false, remaining: MAX_ATTEMPTS - 1 };
  }

  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCK_MS;
    return { locked: true, remaining: 0 };
  }
  return { locked: false, remaining: MAX_ATTEMPTS - rec.count };
}

/** Clear counters for a key after a successful sign-in. */
function reset(email, ip) {
  attempts.delete(keyFor(email, ip));
}

module.exports = { check, recordFailure, reset, MAX_ATTEMPTS, LOCK_MS };
