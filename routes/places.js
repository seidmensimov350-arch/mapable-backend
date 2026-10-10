const express = require("express");
const db = require("../db");
const { asyncHandler, parseId, getPaging, parseLocation, locationFilter } = require("../utils");

const router = express.Router();

const SOURCE_TYPES = ["official_open_data", "openstreetmap", "community", "other"];
const SCORE_COLUMNS = {
  mobility: "s.mobility_score",
  vision: "s.vision_score",
  hearing: "s.hearing_score",
  cognitive: "s.cognitive_score",
};

// Visitor answers to "Is the entrance step-free?"
const STEP_YES = `(SELECT COUNT(*) FROM verifications v1
  WHERE v1.place_id = p.id AND v1.accessibility_feature = 'stair_free_entrance' AND v1.reported_value = 'yes')`;
const STEP_NO = `(SELECT COUNT(*) FROM verifications v2
  WHERE v2.place_id = p.id AND v2.accessibility_feature = 'stair_free_entrance' AND v2.reported_value = 'no')`;

const PLACE_SELECT = `
  p.id, p.name, p.category, p.address, p.latitude, p.longitude,
  p.source_name, p.source_type,
  oa.wheelchair, oa.toilets_wheelchair,
  a.stair_free_entrance, a.assistance_animals, a.noise_level,
  a.flashing_screens, a.strong_smells,
  s.mobility_score, s.vision_score, s.hearing_score, s.cognitive_score,
  EXISTS (
    SELECT 1 FROM restaurant_accessibility_evidence r WHERE r.place_id = p.id
  ) AS has_restaurant_evidence,
  ${STEP_YES} AS step_yes,
  ${STEP_NO} AS step_no`;

const PLACE_JOINS = `
  FROM places p
  LEFT JOIN accessibility a ON a.place_id = p.id
  LEFT JOIN osm_accessibility oa ON oa.place_id = p.id
  LEFT JOIN official_place_scores s ON s.place_id = p.id`;

function formatPlace(row) {
  const scores = [row.mobility_score, row.vision_score, row.hearing_score, row.cognitive_score];
  const hasScores = scores.some((v) => v !== null);

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    distance_m: row.distance_m == null ? undefined : Math.round(row.distance_m),
    source: { name: row.source_name, type: row.source_type },
    accessibility: {
      wheelchair: row.wheelchair || "unknown",
      toilets_wheelchair: row.toilets_wheelchair || "unknown",
      stair_free_entrance: row.stair_free_entrance || "unknown",
      assistance_animals: row.assistance_animals || "unknown",
      noise_level: row.noise_level || "unknown",
      flashing_screens: row.flashing_screens || "unknown",
      strong_smells: row.strong_smells || "unknown",
    },
    official_scores: hasScores
      ? {
          mobility: row.mobility_score,
          vision: row.vision_score,
          hearing: row.hearing_score,
          cognitive: row.cognitive_score,
        }
      : null,
    has_restaurant_evidence: Boolean(row.has_restaurant_evidence),
    visitors: {
      step_free_yes: Number(row.step_yes) || 0,
      step_free_no: Number(row.step_no) || 0,
    },
  };
}

async function listPlaces(req, res, { accessibleOnly = false, needRadius = false } = {}) {
  const q = req.query;

  const loc = parseLocation(q);
  if (loc && loc.error) return res.status(400).json({ error: loc.error });
  if (needRadius && (!loc || !loc.radius)) {
    return res.status(400).json({ error: "lat and lng are required" });
  }

  const lf = locationFilter(loc, "p");
  const where = [...lf.where];
  const whereParams = [...lf.whereParams];

  if (q.category) {
    const categories = String(q.category).split(",").map((c) => c.trim()).filter(Boolean);
    if (categories.length) {
      where.push("p.category IN (?)");
      whereParams.push(categories);
    }
  }

  if (q.source) {
    if (!SOURCE_TYPES.includes(q.source)) {
      return res.status(400).json({ error: `source must be one of: ${SOURCE_TYPES.join(", ")}` });
    }
    where.push("p.source_type = ?");
    whereParams.push(q.source);
  }

  if (q.q) {
    where.push("p.name LIKE ?");
    whereParams.push(`%${String(q.q).trim()}%`);
  }

  const wantAccessible = accessibleOnly || q.accessible === "true" || q.disability !== undefined;
  if (wantAccessible) {
    const disability = q.disability || "mobility";
    if (!SCORE_COLUMNS[disability]) {
      return res.status(400).json({ error: "disability must be mobility, vision, hearing or cognitive" });
    }

    const minScore = q.min_score === undefined ? 50 : Number(q.min_score);
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
      return res.status(400).json({ error: "min_score must be between 0 and 100" });
    }

    const scoreCol = SCORE_COLUMNS[disability];
    if (disability === "mobility") {
      where.push(`(
        oa.wheelchair IN ('yes', 'limited')
        OR ${scoreCol} >= ?
        OR EXISTS (SELECT 1 FROM restaurant_accessibility_evidence r2 WHERE r2.place_id = p.id)
        OR ${STEP_YES} > ${STEP_NO}
      )`);
    } else {
      where.push(`${scoreCol} >= ?`);
    }
    whereParams.push(minScore);
  }

  const { limit, offset } = getPaging(q);

  const sql = `
    SELECT ${PLACE_SELECT}, ${lf.select}
    ${PLACE_JOINS}
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ${lf.orderByDistance ? "distance_m" : "p.name"}
    LIMIT ? OFFSET ?`;

  const [rows] = await db.query(sql, [...lf.selectParams, ...whereParams, limit, offset]);
  res.json({ count: rows.length, limit, offset, places: rows.map(formatPlace) });
}

router.get("/", asyncHandler((req, res) => listPlaces(req, res)));
router.get("/nearby", asyncHandler((req, res) => listPlaces(req, res, { needRadius: true })));
router.get("/accessible", asyncHandler((req, res) => listPlaces(req, res, { accessibleOnly: true })));

router.get("/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid place id" });

  const [[row]] = await db.query(
    `SELECT ${PLACE_SELECT}, NULL AS distance_m,
            p.external_id, p.source_url, a.last_verified_at
     ${PLACE_JOINS}
     WHERE p.id = ?`,
    [id]
  );
  if (!row) return res.status(404).json({ error: "Place not found" });

  const [[assessments], [evidence], [verifications], [parking]] = await Promise.all([
    db.query(
      `SELECT disability_type, criterion, score
       FROM official_assessments
       WHERE place_id = ?
       ORDER BY disability_type, criterion`,
      [id]
    ),
    db.query(
      `SELECT restaurant_name, accessibility_claim, source_name, source_url
       FROM restaurant_accessibility_evidence
       WHERE place_id = ?`,
      [id]
    ),
    db.query(
      `SELECT accessibility_feature, reported_value, COUNT(*) AS votes
       FROM verifications
       WHERE place_id = ?
       GROUP BY accessibility_feature, reported_value`,
      [id]
    ),
    db.query(
      `SELECT * FROM (
         SELECT id, address, latitude, longitude, number_of_places, parking_space_type,
                ST_Distance_Sphere(POINT(longitude, latitude), POINT(?, ?)) AS distance_m
         FROM accessible_parking
       ) t
       WHERE t.distance_m <= 500
       ORDER BY t.distance_m
       LIMIT 5`,
      [row.longitude, row.latitude]
    ),
  ]);

  const officialAssessments = {};
  for (const a of assessments) {
    if (!officialAssessments[a.disability_type]) officialAssessments[a.disability_type] = [];
    officialAssessments[a.disability_type].push({ criterion: a.criterion, score: a.score });
  }

  const verificationSummary = {};
  for (const v of verifications) {
    if (!verificationSummary[v.accessibility_feature]) verificationSummary[v.accessibility_feature] = {};
    verificationSummary[v.accessibility_feature][v.reported_value] = v.votes;
  }

  const place = formatPlace(row);
  res.json({
    ...place,
    external_id: row.external_id,
    source: { ...place.source, url: row.source_url },
    last_verified_at: row.last_verified_at,
    official_assessments: officialAssessments,
    restaurant_evidence: evidence,
    verifications: verificationSummary,
    nearby_parking: parking.map((p) => ({ ...p, distance_m: Math.round(p.distance_m) })),
  });
}));

module.exports = router;
