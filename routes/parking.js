const express = require("express");
const db = require("../db");
const { asyncHandler, parseLocation, locationFilter } = require("../utils");

const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  const loc = parseLocation(req.query);
  if (loc && loc.error) return res.status(400).json({ error: loc.error });

  const lf = locationFilter(loc, "ap");

  const sql = `
    SELECT ap.id, ap.address, ap.latitude, ap.longitude, ap.number_of_places,
           ap.parking_space_type, ap.parking_space_dimensions, ap.positioning_mode,
           ap.disembarkation_area, ap.lower_sides, ap.comment,
           ${lf.select}
    FROM accessible_parking ap
    ${lf.where.length ? "WHERE " + lf.where.join(" AND ") : ""}
    ORDER BY ${lf.orderByDistance ? "distance_m" : "ap.id"}`;

  const [rows] = await db.query(sql, [...lf.selectParams, ...lf.whereParams]);

  res.json({
    count: rows.length,
    total_spaces: rows.reduce((sum, r) => sum + (r.number_of_places || 0), 0),
    parking: rows.map((r) => ({
      ...r,
      distance_m: r.distance_m == null ? undefined : Math.round(r.distance_m),
    })),
  });
}));

module.exports = router;