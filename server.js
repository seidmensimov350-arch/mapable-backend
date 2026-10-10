require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const db = require("./db");
const { asyncHandler } = require("./utils");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.json({ message: "Mapable API is running" });
});

app.get("/api/test-db", asyncHandler(async (req, res) => {
  const [rows] = await db.query("SELECT COUNT(*) AS total_places FROM places");
  res.json({ database: "connected", total_places: rows[0].total_places });
}));

app.get("/api/categories", asyncHandler(async (req, res) => {
  const [rows] = await db.query(`
    SELECT category, COUNT(*) AS count
    FROM places
    GROUP BY category
    ORDER BY count DESC
  `);
  res.json(rows);
}));

app.get("/api/stats", asyncHandler(async (req, res) => {
  const [[places]] = await db.query("SELECT COUNT(*) AS total FROM places");
  const [wheelchair] = await db.query(`
    SELECT COALESCE(NULLIF(wheelchair, ''), 'unknown') AS wheelchair_value, COUNT(*) AS count
    FROM osm_accessibility
    GROUP BY wheelchair_value
    ORDER BY count DESC
  `);
  const [[unverified]] = await db.query(`
    SELECT COUNT(*) AS total
    FROM osm_accessibility oa
    WHERE COALESCE(NULLIF(oa.wheelchair, ''), 'unknown') = 'unknown'
      AND NOT EXISTS (
        SELECT 1 FROM verifications v
        WHERE v.place_id = oa.place_id AND v.accessibility_feature = 'stair_free_entrance'
      )
  `);
  const [[official]] = await db.query("SELECT COUNT(*) AS total FROM official_place_scores");
  const [[parking]] = await db.query(
    "SELECT COUNT(*) AS locations, COALESCE(SUM(number_of_places), 0) AS spaces FROM accessible_parking"
  );
  const [[restaurants]] = await db.query(
    "SELECT COUNT(*) AS total FROM restaurant_accessibility_evidence WHERE place_id IS NOT NULL"
  );
  const [[visitors]] = await db.query(
    "SELECT COUNT(DISTINCT place_id) AS places, COUNT(*) AS answers FROM verifications"
  );

  res.json({
    total_places: places.total,
    osm_wheelchair: wheelchair,
    osm_unknown_unverified: unverified.total,
    official_scored_places: official.total,
    parking_locations: parking.locations,
    parking_spaces: parking.spaces,
    accessible_restaurants: restaurants.total,
    visitor_checked_places: visitors.places,
    visitor_answers: visitors.answers,
  });
}));

app.use("/api/places", require("./routes/places"));
app.use("/api/places", require("./routes/feedback"));
app.use("/api/parking", require("./routes/parking"));
app.use("/api/restaurants", require("./routes/restaurants"));

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (err.code === "ER_NO_REFERENCED_ROW_2") {
    return res.status(404).json({ error: "Place not found" });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
