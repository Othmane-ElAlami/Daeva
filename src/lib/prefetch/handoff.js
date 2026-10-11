import { characterKey } from "../regions.js";
import { COMBAT_POWER, CP_SOURCE } from "../discovery-config.js";
import { setCachedPlayer } from "../db.js";
import { inspectPopulation } from "./population.js";

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

export async function acceptRunnerBuild(db, build, continuation) {
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
  const [player, ...remaining] = continuation.players;
  return {
    ...continuation,
    players: remaining,
    processedPlayers: [...continuation.processedPlayers, player],
    processedCount: continuation.processedCount + 1,
  };
}
