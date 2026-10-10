const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getPaging(query, defaultLimit = 100, maxLimit = 500) {
  let limit = parseInt(query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = defaultLimit;
  limit = Math.min(limit, maxLimit);

  let offset = parseInt(query.offset, 10);
  if (!Number.isInteger(offset) || offset < 0) offset = 0;

  return { limit, offset };
}

// ?lat=&lng=&radius= (metres)  or  ?bbox=minLng,minLat,maxLng,maxLat
function parseLocation(query) {
  if (query.bbox !== undefined) {
    const parts = String(query.bbox).split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return { error: "bbox must be minLng,minLat,maxLng,maxLat" };
    }
    const [minLng, minLat, maxLng, maxLat] = parts;
    return { minLat, maxLat, minLng, maxLng };
  }

  if (query.lat !== undefined || query.lng !== undefined) {
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    const radius = query.radius === undefined ? 1000 : Number(query.radius);

    if (
      !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lng) || lng < -180 || lng > 180
    ) {
      return { error: "lat and lng must be valid coordinates" };
    }
    if (!Number.isFinite(radius) || radius <= 0 || radius > 20000) {
      return { error: "radius must be between 1 and 20000 metres" };
    }

    const dLat = radius / 111320;
    const dLng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
    return {
      lat, lng, radius,
      minLat: lat - dLat, maxLat: lat + dLat,
      minLng: lng - dLng, maxLng: lng + dLng,
    };
  }

  return null;
}

function locationFilter(loc, alias) {
  const out = {
    select: "NULL AS distance_m",
    selectParams: [],
    where: [],
    whereParams: [],
    orderByDistance: false,
  };
  if (!loc) return out;

  out.where.push(`${alias}.latitude BETWEEN ? AND ?`, `${alias}.longitude BETWEEN ? AND ?`);
  out.whereParams.push(loc.minLat, loc.maxLat, loc.minLng, loc.maxLng);

  if (loc.radius) {
    const dist = `ST_Distance_Sphere(POINT(${alias}.longitude, ${alias}.latitude), POINT(?, ?))`;
    out.select = `${dist} AS distance_m`;
    out.selectParams.push(loc.lng, loc.lat);
    out.where.push(`${dist} <= ?`);
    out.whereParams.push(loc.lng, loc.lat, loc.radius);
    out.orderByDistance = true;
  }

  return out;
}

module.exports = { asyncHandler, parseId, getPaging, parseLocation, locationFilter };