import { characterKey } from "../regions.js";
import { COMBAT_POWER, CP_SOURCE } from "../discovery-config.js";
import { setCachedPlayer } from "../db.js";
import { inspectPopulation } from "./population.js";
import {
  MAX_UNAVAILABLE_PROFILES,
  MAX_CONSECUTIVE_UNAVAILABLE,
  UNAVAILABLE_CODES,
  unavailableStreak,
} from "./unavailable.js";

export function validUnavailablePlayer(unavailable, continuation) {
  return !!(
    continuation?.players?.length &&
    UNAVAILABLE_CODES.includes(unavailable?.code) &&
    typeof unavailable.reason === "string" &&
    unavailable.reason.length > 0 &&
    unavailable.reason.length <= 500 &&
    (continuation.sourceMeta.unavailablePlayers?.length || 0) < MAX_UNAVAILABLE_PROFILES &&
    unavailableStreak(continuation) < MAX_CONSECUTIVE_UNAVAILABLE
  );
}

export function omitUnavailablePlayer(unavailable, continuation) {
  const [player, ...players] = continuation.players;
  return {
    ...continuation,
    players,
    sourceMeta: {
      ...continuation.sourceMeta,
      unavailablePlayers: [
        ...(continuation.sourceMeta.unavailablePlayers || []),
        {
          ...player,
          code: unavailable.code,
          reason: unavailable.reason,
          preparedBuildCount: continuation.processedCount,
        },
      ],
    },
  };
}

export function validRunnerToken(token) {
  return typeof token === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token);
}

export function validPlayerStep(step, config) {
  const player = step?.player;
  return !!(
    validRunnerToken(step?.refreshToken) &&
    Number.isInteger(step.processedCount) &&
    step.processedCount >= 0 &&
    step.processedCount < config.limit &&
    player?.source === CP_SOURCE &&
    player.region === config.region &&
    player.class === config.cls &&
    typeof player.characterId === "string" &&
    player.characterId &&
    typeof player.characterName === "string" &&
    player.characterName &&
    Number.isInteger(player.serverId) &&
    player.serverId > 0 &&
    Number.isInteger(player.rank) &&
    player.rank > 0 &&
    Number.isFinite(player.combatPower) &&
    player.combatPower > 0
  );
}

// Only the authenticated scheduler can upload an enriched build. It must match
// the next character in the same discovered population, including its CP rank.
export function validRunnerBuild(build, continuation, config) {
  const player = continuation?.players?.[0];
  const age = Date.now() - build?.buildFetchedAt;
  return !!(
    config.lbType === COMBAT_POWER &&
    continuation?.processedCount < config.limit &&
    player &&
    build &&
    characterKey(build) === characterKey(player) &&
    build.rank === player.rank &&
    build.leaderboardCombatPower === player.combatPower &&
    build.leaderboardGearScore === player.gearScore &&
    build.name === player.characterName &&
    build.faction === player.faction &&
    Number.isFinite(build.gearScore) &&
    build.gearScore > 0 &&
    Number.isSafeInteger(build.buildFetchedAt) &&
    Number.isFinite(age) &&
    age >= -60000 &&
    age < 10 * 60000 &&
    build.activeSkills?.length &&
    [
      "stigmaSkills",
      "passiveSkills",
      "arcanas",
      "arcanaSets",
      "equipSubStats",
      "theostones",
      "manastones",
    ].every((field) => Array.isArray(build[field])) &&
    inspectPopulation(
      { builds: [build], source: CP_SOURCE, data: {} },
      config.cls,
      config.lbType,
      config.region
    ).valid
  );
}

export async function storeRunnerBuild(db, build) {
  // The normalized build includes equipment, skills, arcana, runes and stones.
  // It uses the existing versioned player-cache representation and keeps the
  // actual fetch timestamp; uploading never makes an old build fresh again.
  await setCachedPlayer(
    db,
    build.characterId,
    build.serverId,
    build.region,
    { _daevaBuildVersion: 1, _daevaBuild: build },
    [],
    build.gearScore,
    null,
    build.buildFetchedAt
  );
}

export function advanceRunnerPlayer(continuation) {
  const [player, ...remaining] = continuation.players;
  return {
    ...continuation,
    players: remaining,
    processedPlayers: [...continuation.processedPlayers, player],
    processedCount: continuation.processedCount + 1,
  };
}

export function runnerPublicationCheckpoint(continuation, limit) {
  return continuation.processedCount >= limit ||
    (!continuation.players.length && !continuation.sourceMeta.hasMore)
    ? { ...continuation, players: [], phase: "publish" }
    : continuation;
}

export async function acceptRunnerBuild(db, build, continuation) {
  await storeRunnerBuild(db, build);
  return advanceRunnerPlayer(continuation);
}
