const { isWithinFindRadius } = require("./geofence");
const { createAppReviewQuest } = require("./reviewRoute");

const REVIEW_DEMO_BANNER = "App Review Demonstration — simulated location, progress not saved";
const REVIEW_DEMO_RECAP_LABEL = "Demo — not saved";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createReviewDemoRuntime() {
  let quest = null;
  let progress = {};
  const checkpointIndex = {};

  function ensureStarted() {
    if (!quest) throw new Error("Start the review demonstration before using the runtime.");
  }

  function currentStop() {
    ensureStarted();
    return quest.stops.find((stop) => !progress[stop.order_index]?.found) || null;
  }

  function currentCheckpoint() {
    const stop = currentStop();
    if (!stop) return null;
    const index = checkpointIndex[stop.order_index] || 0;
    return stop.simulated_walk[index] || stop.simulated_walk[0] || null;
  }

  return {
    mode: "app_review",
    bannerText: REVIEW_DEMO_BANNER,
    recapLabel: REVIEW_DEMO_RECAP_LABEL,

    start() {
      quest = createAppReviewQuest();
      progress = {};
      for (const stop of quest.stops) checkpointIndex[stop.order_index] = 0;
      return clone(quest);
    },

    currentStop() {
      const stop = currentStop();
      return stop ? clone(stop) : null;
    },

    currentCheckpoint() {
      const checkpoint = currentCheckpoint();
      return checkpoint ? clone(checkpoint) : null;
    },

    advanceSimulatedWalk() {
      const stop = currentStop();
      if (!stop) return null;
      const current = checkpointIndex[stop.order_index] || 0;
      checkpointIndex[stop.order_index] = Math.min(current + 1, stop.simulated_walk.length - 1);
      return clone(stop.simulated_walk[checkpointIndex[stop.order_index]]);
    },

    tryFindCurrentStop() {
      const stop = currentStop();
      const checkpoint = currentCheckpoint();
      if (!stop || !checkpoint) return { found: false, reason: "complete" };
      if (!isWithinFindRadius(checkpoint, stop.place)) return { found: false, reason: "outside_geofence" };
      progress = {
        ...progress,
        [stop.order_index]: {
          ...(progress[stop.order_index] || {}),
          checkedIn: true,
          found: true,
          demo: true,
        },
      };
      return { found: true, stop: clone(stop), checkpoint: clone(checkpoint) };
    },

    getProgress() {
      return clone(progress);
    },

    isComplete() {
      ensureStarted();
      return quest.stops.every((stop) => progress[stop.order_index]?.found);
    },

    buildRecap() {
      ensureStarted();
      return {
        label: REVIEW_DEMO_RECAP_LABEL,
        saved: false,
        authoritative: false,
        quest: clone(quest),
        progress: clone(progress),
      };
    },
  };
}

module.exports = {
  REVIEW_DEMO_BANNER,
  REVIEW_DEMO_RECAP_LABEL,
  createReviewDemoRuntime,
};
