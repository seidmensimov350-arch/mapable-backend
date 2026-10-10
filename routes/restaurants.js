const express = require("express");
const db = require("../db");
const { asyncHandler } = require("../utils");

const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  const [rows] = await db.query(`
    SELECT r.id AS evidence_id, r.restaurant_name, r.accessibility_claim,
           r.source_name, r.source_url, r.match_method,
           p.id AS place_id, p.name, p.category, p.address, p.latitude, p.longitude
    FROM restaurant_accessibility_evidence r
    JOIN places p ON p.id = r.place_id
    ORDER BY r.restaurant_name
  `);

  res.json({
    count: rows.length,
    restaurants: rows.map((r) => ({
      place_id: r.place_id,
      name: r.name,
      category: r.category,
      address: r.address,
      latitude: r.latitude,
      longitude: r.longitude,
      evidence: {
        id: r.evidence_id,
        restaurant_name: r.restaurant_name,
        claim: r.accessibility_claim,
        source_name: r.source_name,
        source_url: r.source_url,
        match_method: r.match_method,
      },
    })),
  });
}));

module.exports = router;