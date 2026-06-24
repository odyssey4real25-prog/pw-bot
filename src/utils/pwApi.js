// ============================================================
// src/utils/pwApi.js — Politics & War API client
//
// KEY FACTS from the official P&W GraphQL schema:
//   - alliances() has NO name filter — only id:[Int]
//   - nations() accepts nation_name:[String] (array, exact match only)
//   - Both are case-sensitive on the server side
//
// Our solution:
//   - Nations: send the name as-is; the API does exact match.
//     Since we can't know the exact casing, we also try common
//     variants (Title Case, UPPER, lower) in sequence.
//   - Alliances: fetch pages of alliances and match client-side,
//     fully case-insensitive using JavaScript .toLowerCase().
// ============================================================

const axios = require('axios');
const logger = require('./logger');

const PW_API_BASE = 'https://api.politicsandwar.com/graphql?api_key=';
const cache = new Map();
const CACHE_TIMES = {
  nation:   5  * 60 * 1000,
  alliance: 10 * 60 * 1000,
};

// Real member positions — excludes APPLICANT and NOALLIANCE
const MEMBER_POSITIONS = ['MEMBER', 'OFFICER', 'HEIR', 'LEADER'];

// ─────────────────────────────────────────────────────────────
// CORE QUERY RUNNER
// ─────────────────────────────────────────────────────────────
async function pwQuery(queryStr, variables = {}) {
  const url = `${PW_API_BASE}${process.env.PW_API_KEY}`;
  try {
    const res = await axios.post(url, { query: queryStr, variables }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    if (res.data.errors) {
      logger.warn('P&W API errors:', JSON.stringify(res.data.errors));
    }
    return res.data.data;
  } catch (err) {
    if (err.response?.status === 429) {
      logger.warn('Rate limited — waiting 60s');
      await new Promise(r => setTimeout(r, 60000));
      return pwQuery(queryStr, variables);
    }
    logger.error('P&W API error:', err.message);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// SMART RESOLVERS
// Accept: numeric ID  |  P&W URL  |  name (any casing)
// ─────────────────────────────────────────────────────────────

async function resolveNation(input) {
  if (!input) return null;
  input = input.trim();
  const urlMatch = input.match(/nation\/id=(\d+)/i);
  if (urlMatch) return getNation(parseInt(urlMatch[1]));
  if (/^\d+$/.test(input)) return getNation(parseInt(input));
  return searchNationByName(input);
}

async function resolveAlliance(input) {
  if (!input) return null;
  input = input.trim();
  const urlMatch = input.match(/alliance\/id=(\d+)/i);
  if (urlMatch) return getAllianceInfo(parseInt(urlMatch[1]));
  if (/^\d+$/.test(input)) return getAllianceInfo(parseInt(input));
  return searchAllianceByName(input);
}

// ─────────────────────────────────────────────────────────────
// NATION — fetch by ID
// ─────────────────────────────────────────────────────────────
async function getNation(nationId) {
  const key = `nation_${nationId}`;
  const hit = getFromCache(key);
  if (hit) return hit;

  const data = await pwQuery(`
    query($id:[Int]) {
      nations(id:$id, first:1) {
        data {
          id nation_name leader_name alliance_id alliance_position
          score num_cities color beige_turns vacation_mode_turns
          soldiers tanks aircraft ships missiles nukes
          offensive_wars_count defensive_wars_count last_active
          alliance { name }
        }
      }
    }
  `, { id: [nationId] });

  const nation = data?.nations?.data?.[0] || null;
  if (nation) setCache(key, nation, CACHE_TIMES.nation);
  return nation;
}

// ─────────────────────────────────────────────────────────────
// NATION — search by name (case-insensitive)
//
// The API's nation_name filter accepts an ARRAY of exact strings.
// Strategy: send multiple casing variants in one request,
// then pick the one whose lowercase matches the user's input.
// ─────────────────────────────────────────────────────────────
async function searchNationByName(name) {
  const key = `nation_name_${name.toLowerCase()}`;
  const hit = getFromCache(key);
  if (hit) return hit;

  // Build casing variants
  const variants = dedupe([
    name,                          // as typed
    name.toLowerCase(),            // all lowercase
    name.toUpperCase(),            // ALL CAPS
    toTitleCase(name),             // Title Case
    toSentenceCase(name),          // Sentence case
  ]);

  // Send all variants in a single API call (nation_name accepts an array)
  const data = await pwQuery(`
    query($names:[String]) {
      nations(nation_name:$names, first:10) {
        data {
          id nation_name leader_name alliance_id alliance_position
          score num_cities color beige_turns vacation_mode_turns
          soldiers tanks aircraft ships missiles nukes
          offensive_wars_count defensive_wars_count last_active
          alliance { name }
        }
      }
    }
  `, { names: variants });

  const results = data?.nations?.data || [];
  if (results.length === 0) return null;

  const target = name.toLowerCase();

  // Prefer exact case-insensitive match, fall back to first result
  const nation = results.find(n => n.nation_name.toLowerCase() === target)
              || results[0];

  setCache(key, nation, CACHE_TIMES.nation);
  return nation;
}

// ─────────────────────────────────────────────────────────────
// ALLIANCE — fetch by ID
// ─────────────────────────────────────────────────────────────
async function getAllianceInfo(allianceId) {
  const key = `alliance_${allianceId}`;
  const hit = getFromCache(key);
  if (hit) return hit;

  const data = await pwQuery(`
    query($id:[Int]) {
      alliances(id:$id, first:1) {
        data { id name score color num_nations }
      }
    }
  `, { id: [parseInt(allianceId)] });

  const alliance = data?.alliances?.data?.[0] || null;
  if (alliance) setCache(key, alliance, CACHE_TIMES.alliance);
  return alliance;
}

// ─────────────────────────────────────────────────────────────
// ALLIANCE — search by name (case-insensitive, client-side)
//
// The alliances() query has NO name filter in the schema.
// We must fetch pages of alliances and match locally.
// P&W has ~1000+ alliances. We fetch sorted by score DESC
// so the most well-known alliances appear first.
// We page through up to 200 results (4 pages of 50).
// ─────────────────────────────────────────────────────────────
async function searchAllianceByName(name) {
  const key = `alliance_name_${name.toLowerCase()}`;
  const hit = getFromCache(key);
  if (hit) return hit;

  const target = name.toLowerCase().trim();
  let page = 1;
  let found = null;

  while (page <= 4 && !found) {
    const data = await pwQuery(`
      query($page:Int) {
        alliances(first:50, page:$page) {
          data { id name score color num_nations }
          paginatorInfo { hasMorePages }
        }
      }
    `, { page });

    const alliances = data?.alliances?.data || [];
    const hasMore   = data?.alliances?.paginatorInfo?.hasMorePages;

    // Try exact match first
    found = alliances.find(a => a.name.toLowerCase() === target);

    // Then "starts with"
    if (!found) found = alliances.find(a => a.name.toLowerCase().startsWith(target));

    // Then "includes"
    if (!found) found = alliances.find(a => a.name.toLowerCase().includes(target));

    if (!hasMore) break;
    page++;
  }

  if (found) setCache(key, found, CACHE_TIMES.alliance);
  return found || null;
}

// ─────────────────────────────────────────────────────────────
// ALLIANCE MEMBERS — excludes applicants
// ─────────────────────────────────────────────────────────────
async function getAllianceMembers(allianceId) {
  const key = `alliance_members_${allianceId}`;
  const hit = getFromCache(key);
  if (hit) return hit;

  const data = await pwQuery(`
    query($id:[Int]) {
      alliances(id:$id, first:1) {
        data {
          id name
          nations {
            id nation_name score num_cities alliance_position
            soldiers tanks aircraft ships
            beige_turns vacation_mode_turns
            offensive_wars_count defensive_wars_count last_active
          }
        }
      }
    }
  `, { id: [parseInt(allianceId)] });

  const all     = data?.alliances?.data?.[0]?.nations || [];
  const members = all.filter(n =>
    MEMBER_POSITIONS.includes((n.alliance_position || '').toUpperCase())
  );

  logger.debug(`Alliance ${allianceId}: ${all.length} total, ${members.length} members, ${all.length - members.length} applicants excluded`);
  setCache(key, members, CACHE_TIMES.alliance);
  return members;
}

// ─────────────────────────────────────────────────────────────
// WARS
// ─────────────────────────────────────────────────────────────
async function getNationWars(nationId) {
  const data = await pwQuery(`
    query($id:[ID]) {
      wars(nation_id:$id, active:true) {
        id date attid defid att_alliance_id def_alliance_id
        attacker { nation_name score }
        defender { nation_name score }
        status turnsleft
      }
    }
  `, { id: [String(nationId)] });
  return data?.wars || [];
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function toTitleCase(s) {
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
function toSentenceCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
function dedupe(arr) {
  return [...new Set(arr)];
}
function getFromCache(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { cache.delete(key); return null; }
  return e.data;
}
function setCache(key, data, ttl) {
  cache.set(key, { data, expiresAt: Date.now() + ttl });
}
function clearCache(key) {
  if (key) cache.delete(key); else cache.clear();
}

module.exports = {
  pwQuery,
  getNation, searchNationByName, resolveNation,
  getAllianceInfo, searchAllianceByName, resolveAlliance,
  getAllianceMembers, getNationWars,
  clearCache, MEMBER_POSITIONS,
};
