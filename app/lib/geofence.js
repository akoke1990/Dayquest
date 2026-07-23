const FIND_RADIUS_M = 50;

function coordinate(value, primary, secondary) {
  const result = value?.[primary] ?? value?.[secondary];
  return Number.isFinite(result) ? result : null;
}

function distanceM(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function isWithinFindRadius(position, place, radiusM = FIND_RADIUS_M) {
  const latitude = coordinate(position, "latitude", "lat");
  const longitude = coordinate(position, "longitude", "lng");
  const targetLat = coordinate(place, "lat", "latitude");
  const targetLng = coordinate(place, "lng", "longitude");
  if (![latitude, longitude, targetLat, targetLng, radiusM].every(Number.isFinite)) return false;
  return distanceM(latitude, longitude, targetLat, targetLng) <= radiusM;
}

module.exports = {
  FIND_RADIUS_M,
  distanceM,
  isWithinFindRadius,
};
