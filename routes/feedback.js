const express = require("express");
const db = require("../db");
const { asyncHandler, parseId } = require("../utils");

const router = express.Router();

const VERIFICATION_VALUES = {
  stair_free_entrance: ["yes", "no"],
  assistance_animals: ["yes", "no"],
  noise_level: ["quiet", "moderate", "loud"],
  flashing_screens: ["yes", "no"],
  strong_smells: ["yes", "no"],
};

const REPORT_FEATURES = [
  "stair_free_entrance", "assistance_animals", "noise_level",
  "flashing_screens", "strong_smells", "general",
];

const REPORT_REASONS = [
  "incorrect_information", "outdated_information", "missing_information", "other",
];

const SUGGESTION_TYPES = [
  "add_ramp", "improve_entrance", "reduce_noise", "reduce_strong_smells",
  "reduce_flashing_screens", "improve_assistance_animal_access", "other",
];

function readComment(value) {
  if (value === undefined || value === null || value === "") return { comment: null };
  if (typeof value !== "string") return { error: "comment must be text" };
  const comment = value.trim();
  if (comment.length > 500) return { error: "comment must be 500 characters or fewer" };
  return { comment: comment || null };
}

router.post("/:id/verifications", asyncHandler(async (req, res) => {
  const placeId = parseId(req.params.id);
  if (!placeId) return res.status(400).json({ error: "Invalid place id" });

  const { visitor_id, accessibility_feature, reported_value } = req.body || {};

  if (typeof visitor_id !== "string" || !visitor_id.trim() || visitor_id.length > 100) {
    return res.status(400).json({ error: "visitor_id is required (max 100 characters)" });
  }
  const allowed = VERIFICATION_VALUES[accessibility_feature];
  if (!allowed) {
    return res.status(400).json({ error: `accessibility_feature must be one of: ${Object.keys(VERIFICATION_VALUES).join(", ")}` });
  }
  if (!allowed.includes(reported_value)) {
    return res.status(400).json({ error: `reported_value must be one of: ${allowed.join(", ")}` });
  }

  await db.query(
    `INSERT INTO verifications (place_id, visitor_id, accessibility_feature, reported_value)
     VALUES (?, ?, ?, ?) AS new
     ON DUPLICATE KEY UPDATE
       reported_value = new.reported_value,
       created_at = CURRENT_TIMESTAMP`,
    [placeId, visitor_id.trim(), accessibility_feature, reported_value]
  );

  res.status(201).json({ message: "Verification saved" });
}));

router.post("/:id/reports", asyncHandler(async (req, res) => {
  const placeId = parseId(req.params.id);
  if (!placeId) return res.status(400).json({ error: "Invalid place id" });

  const { accessibility_feature, reason } = req.body || {};

  if (!REPORT_FEATURES.includes(accessibility_feature)) {
    return res.status(400).json({ error: `accessibility_feature must be one of: ${REPORT_FEATURES.join(", ")}` });
  }
  if (!REPORT_REASONS.includes(reason)) {
    return res.status(400).json({ error: `reason must be one of: ${REPORT_REASONS.join(", ")}` });
  }
  const { comment, error } = readComment((req.body || {}).comment);
  if (error) return res.status(400).json({ error });

  const [result] = await db.query(
    `INSERT INTO reports (place_id, accessibility_feature, reason, comment)
     VALUES (?, ?, ?, ?)`,
    [placeId, accessibility_feature, reason, comment]
  );

  res.status(201).json({ message: "Report saved", id: result.insertId });
}));

router.post("/:id/suggestions", asyncHandler(async (req, res) => {
  const placeId = parseId(req.params.id);
  if (!placeId) return res.status(400).json({ error: "Invalid place id" });

  const { suggestion_type } = req.body || {};

  if (!SUGGESTION_TYPES.includes(suggestion_type)) {
    return res.status(400).json({ error: `suggestion_type must be one of: ${SUGGESTION_TYPES.join(", ")}` });
  }
  const { comment, error } = readComment((req.body || {}).comment);
  if (error) return res.status(400).json({ error });

  const [result] = await db.query(
    `INSERT INTO improvement_suggestions (place_id, suggestion_type, comment)
     VALUES (?, ?, ?)`,
    [placeId, suggestion_type, comment]
  );

  res.status(201).json({ message: "Suggestion saved", id: result.insertId });
}));

module.exports = router;