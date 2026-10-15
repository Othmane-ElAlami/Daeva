// A small number of inaccessible characters may be replaced by the next CP
// ranks. An outage must still fail the refresh and retain the last good cache.
export const MAX_UNAVAILABLE_PROFILES = 25;
export const MAX_CONSECUTIVE_UNAVAILABLE = 5;
export const UNAVAILABLE_CODES = [
  "PROFILE_NOT_FOUND",
  "PROFILE_UNAVAILABLE",
  "PROFILE_IDENTITY_MISMATCH",
  "STATS_UNAVAILABLE",
  "EQUIPMENT_UNAVAILABLE",
  "ITEM_UNAVAILABLE",
];

export function unavailableCode(error) {
  // A failed proxy must not disguise an official rate limit, authentication
  // error or transport outage as a skippable missing profile/item.
  if (error?.officialFailure && !unavailableCode(error.officialFailure)) return null;
  if (error?.status === 404) return "PROFILE_NOT_FOUND";
  return UNAVAILABLE_CODES.includes(error?.code) ? error.code : null;
}

export function unavailableStreak(continuation) {
  const omitted = continuation?.sourceMeta?.unavailablePlayers || [];
  let count = 0;
  for (let index = omitted.length - 1; index >= 0; index--) {
    if (omitted[index].preparedBuildCount !== continuation.processedCount) break;
    count++;
  }
  return count;
}
