// ============================================================
// src/utils/pwApi.js — Politics & War API client
// - Name search is done client-side (case-insensitive)
// - Applicants are excluded from all alliance member queries
// ============================================================

const axios = require('axios');
const logger = require('./logger');

const PW_API_BASE = 'https://api.politicsandwar.com/graphql?api_key=';
const cache = new Map();
const CACHE_TIMES = {
  nation: 5 * 60 * 1000,
  alliance: 10 * 60 * 1000,
  wars: 2 * 60 * 1000,
};

// Alliance positions that count as actual members (not applicants)
const MEMBER_POSITIONS = ['MEMBER', 'OFFICER', 'HEIR', 'LEADER'];

async function pwQuery(queryStr, variables = {}) {
  const url = `${PW_API_BASE}${process.env.PW_API_KEY}`;
  try {
    const response = await axios.post(url, { query: queryStr, variables }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    if (response.data.errors) {
      logger.warn('P&W API errors:', JSON.stringify(response.data.errors));
    }
    return response.data.data;
  } catch (error) {
    if (error.response?.status === 429) {
      logger.warn('Rate limit hit — waiting 60s...');
      await new Promise(r => setTimeout(r, 60000));
      return pwQuery(queryStr, variables);
    }
    logger.error('P&W API failed:', error.message);
    throw error;
  }
}

// ============================================================
// SMART RESOLVERS
// Accepts: nation/alliance ID, name (any case), or P&W URL
// Name matching is done on our side — fully case-insensitive
// ============================================================

async function resolveNation(input) {
  if (!input) return null;
  input = input.trim();

  // P&W URL  e.g. https://politicsandwar.com/nation/id=12345
  const urlMatch = input.match(/nation\/id=(\d+)/i);
  if (urlMatch) return getNation(parseInt(urlMatch[1]));

  // Pure number → treat as ID
  if (/^\d+$/.test(input)) return getNation(parseInt(input));

  // Otherwise → search by name (case-insensitive, client-side)
  return searchNationByName(input);
}

async function resolveAlliance(input) {
  if (!input) return null;
  input = input.trim();

  // P&W URL  e.g. https://politicsandwar.com/alliance/id=1234
  const urlMatch = input.match(/alliance\/id=(\d+)/i);
  if (urlMatch) return getAllianceInfo(parseInt(urlMatch[1]));

  // Pure number → treat as ID
  if (/^\d+$/.test(input)) return getAllianceInfo(parseInt(input));

  // Otherwise → search by name (case-insensitive, client-side)
  return searchAllianceByName(input);
}

// ============================================================
// NATION FUNCTIONS
// ============================================================

async function getNation(nationId) {
  const cacheKey = `nation_${nationId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const data = await pwQuery(`
    query GetNation($id: [Int]) {
      nations(id: $id, first: 1) {
        data {
          id nation_name leader_name alliance_id alliance_position
          score num_cities color beige_turns vacation_mode_turns
          soldiers tanks aircraft ships missiles nukes
          offensive_wars_count defensive_wars_count last_active
          alliance { name }
        }
      }
    }
  `, { id: [parseInt(nationId)] });

  const nation = data?.nations?.data?.[0] || null;
  if (nation) setCache(cacheKey, nation, CACHE_TIMES.nation);
  return nation;
}

// Search nations by name — fetches a batch and matches client-side
// This is the only reliable way to do case-insensitive search
async function searchNationByName(name) {
  const cacheKey = `nation_search_${name.toLowerCase()}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  // P&W API supports partial name search — fetch up to 10 results
  // and pick the best match ourselves
  const data = await pwQuery(`
    query SearchNation($name: String) {
      nations(nation_name: $name, first: 10) {
        data {
          id nation_name leader_name alliance_id alliance_position
          score num_cities color beige_turns vacation_mode_turns
          soldiers tanks aircraft ships missiles nukes
          offensive_wars_count defensive_wars_count last_active
          alliance { name }
        }
      }
    }
  `, { name });

  const results = data?.nations?.data || [];

  // Find exact case-insensitive match first
  const nameLower = name.toLowerCase();
  const exactMatch = results.find(n => n.nation_name.toLowerCase() === nameLower);
  const nation = exactMatch || results[0] || null;

  if (nation) setCache(cacheKey, nation, CACHE_TIMES.nation);
  return nation;
}

// ============================================================
// ALLIANCE FUNCTIONS
// ============================================================

async function getAllianceInfo(allianceId) {
  const cacheKey = `alliance_info_${allianceId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const data = await pwQuery(`
    query GetAlliance($id: [Int]) {
      alliances(id: $id, first: 1) {
        data { id name score color num_nations }
      }
    }
  `, { id: [parseInt(allianceId)] });

  const alliance = data?.alliances?.data?.[0] || null;
  if (alliance) setCache(cacheKey, alliance, CACHE_TIMES.alliance);
  return alliance;
}

// Search alliances by name — fetches top 20 and matches client-side
// This is the only reliable way to do case-insensitive search
async function searchAllianceByName(name) {
  const cacheKey = `alliance_search_${name.toLowerCase()}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  // Fetch a batch of alliances ordered by score (most prominent first)
  // The API's name filter is case-sensitive and exact, so we do NOT
  // pass the name as a filter — we fetch the top alliances and search ourselves
  const data = await pwQuery(`
    query SearchAlliances {
      alliances(first: 50, orderBy: { column: SCORE, order: DESC }) {
        data { id name score color num_nations }
      }
    }
  `);

  const alliances = data?.alliances?.data || [];
  const nameLower = name.toLowerCase();

  // Try exact match first (case-insensitive)
  let match = alliances.find(a => a.name.toLowerCase() === nameLower);

  // If no exact match, try "starts with"
  if (!match) {
    match = alliances.find(a => a.name.toLowerCase().startsWith(nameLower));
  }

  // If still nothing, try "includes"
  if (!match) {
    match = alliances.find(a => a.name.toLowerCase().includes(nameLower));
  }

  // If STILL nothing, the alliance might be smaller — try a second fetch
  // with the API's own name filter as a hint (even if case-sensitive)
  if (!match) {
    const fallback = await pwQuery(`
      query SearchAllianceFallback($name: String) {
        alliances(name: $name, first: 10) {
          data { id name score color num_nations }
        }
      }
    `, { name });

    const fallbackResults = fallback?.alliances?.data || [];
    match = fallbackResults.find(a => a.name.toLowerCase() === nameLower)
          || fallbackResults[0]
          || null;
  }

  if (match) setCache(cacheKey, match, CACHE_TIMES.alliance);
  return match;
}

// Get all TRUE members of an alliance (excludes applicants)
async function getAllianceMembers(allianceId) {
  const cacheKey = `alliance_members_${allianceId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  const data = await pwQuery(`
    query GetAllianceMembers($id: [Int]) {
      alliances(id: $id, first: 1) {
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

  const allNations = data?.alliances?.data?.[0]?.nations || [];

  // Filter out applicants — only count real members
  const members = allNations.filter(n =>
    MEMBER_POSITIONS.includes(n.alliance_position?.toUpperCase())
  );

  logger.debug(`Alliance ${allianceId}: ${allNations.length} total nations, ${members.length} actual members (${allNations.length - members.length} applicants excluded)`);

  setCache(cacheKey, members, CACHE_TIMES.alliance);
  return members;
}

async function getNationWars(nationId) {
  const data = await pwQuery(`
    query GetWars($nationId: [Int]) {
      wars(nation_id: $nationId, active: true, first: 10) {
        data {
          id date attid defid att_alliance_id def_alliance_id
          attacker { nation_name score }
          defender { nation_name score }
          status turnsleft
        }
      }
    }
  `, { nationId: [parseInt(nationId)] });
  return data?.wars?.data || [];
}

// ============================================================
// CACHE HELPERS
// ============================================================

function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key, data, ttl) {
  cache.set(key, { data, expiresAt: Date.now() + ttl });
}
function clearCache(key) {
  if (key) cache.delete(key);
  else cache.clear();
}

module.exports = {
  pwQuery,
  getNation, searchNationByName, resolveNation,
  getAllianceInfo, searchAllianceByName, resolveAlliance,
  getAllianceMembers, getNationWars,
  clearCache,
  MEMBER_POSITIONS,
};
