# TestFlight real-device matrix — DayQuest iOS 1.0

**Status:** unexecuted template. Simulator, unit-test, Expo Go, and internal-development results do not replace production-profile TestFlight runs.

## Build identity

- Commit `{{CANDIDATE_COMMIT}}`; EAS build `{{EAS_BUILD_ID}}`; version/build `1.0.0 ({{REMOTE_IOS_BUILD_NUMBER}})`.
- Date `{{TESTFLIGHT_DATE}}`; non-secret environment IDs `{{PRODUCTION_ENVIRONMENT_IDS}}`.
- Coordinator `{{TESTER_OWNER}}`; archive `{{EVIDENCE_ARCHIVE}}`.

## Hardware/OS

| Lane | Physical device | iOS | Install/network | Focus | Result |
|---|---|---|---|---|---|
| A | `{{SUPPORTED_OLDER_IPHONE}}` | `{{OLDEST_SUPPORTED_IOS}}` | Fresh/Wi-Fi | performance, layout, permissions, guest quest | Not run |
| B | `{{CURRENT_STANDARD_IPHONE}}` | `{{CURRENT_IOS}}` | Fresh/cellular | signed-in/shared, photos, reminders | Not run |
| C | `{{CURRENT_LARGE_IPHONE}}` | `{{CURRENT_IOS}}` | Upgrade/Wi-Fi | persistence/migration/resume | Not run |
| D | `{{VOICEOVER_IPHONE}}` | `{{SUPPORTED_IOS}}` | Fresh/Wi-Fi | VoiceOver, Type, motion, contrast | Not run |
| E | `{{DELETION_IPHONE}}` | `{{CURRENT_IOS}}` | Fresh/reinstall | Apple/Google deletion | Not run |

Supported iOS floor from generated binary/ASC: `{{BLOCKER_SUPPORTED_IOS_VERSION}}`.

## Scenarios

### Launch/account
- [ ] Fresh guest/help and returning launch; Apple sign-in/cancel/return/sign-out; Google sign-in.
- [ ] Solo guest has no account trap.
- [ ] No ads/subscription/paywall/IAP/Custom Hunts UI.

### Location/map/content
- [ ] Foreground allowed; denied; Settings change; approximate accuracy; unavailable.
- [ ] No Always/background request; map key failure recoverable.
- [ ] Exact launch geography exposes only approved cohort; outside coverage is truthful.
- [ ] Reviewer path works outside NYC without spoofing.
- [ ] No source/remote-reviewed candidate presented as field verified.

### Hunt loop
- [ ] Clue peek/expand; hints; guidance does not mark found early.
- [ ] GPS jitter/movement gate/geofence/double-fire.
- [ ] Camera allowed/denied/cancel/unavailable; library fallback; skip; microphone never requested.
- [ ] Reveal/collect/advance/recap/history/collections/visited.
- [ ] Force-close/resume; abandon; local photos/share; no photo upload.
- [ ] Unsafe/closed/inaccessible stop is penalty-free, or record as release blocker.

### Social/privacy/reminders
- [ ] Friend invite/accept/decline/remove with disposable accounts.
- [ ] Shared hunt same content and expected result.
- [ ] Local notification allowed/denied/canceled; no remote push.
- [ ] Analytics off prevents later `track()`; feedback/score separately documented.
- [ ] Public links work; guest reset differs from account deletion.
- [ ] Full Apple/Google deletion checklist passes.

### Resilience/performance
- [ ] Offline cold start/saved quest; slow/lossy network; API errors; provider timeout; host restart.
- [ ] Curated/live fallback measured; first use not dependent on unbounded generation.
- [ ] Interruptions, background/foreground, memory/low battery.
- [ ] Thresholds `{{PERFORMANCE_AND_RELIABILITY_THRESHOLDS}}` pass.
- [ ] Monitoring excludes raw GPS/photos/answers/tokens/emails/full payloads.

### Accessibility observations
- [ ] VoiceOver labels/focus/modals/deletion states.
- [ ] Accessibility Dynamic Type without clipping.
- [ ] Reduce Motion reviewed; motion never blocks progress.
- [ ] Contrast/Differentiate Without Color; status not color-only.
- [ ] Touch targets/one-handed reach; light appearance.

## Exit

All P0s pass on older/current lanes; provider/destructive cases pass physically; no unexplained crash/data-loss/privacy/safety issue; blockers have owner/date; `{{QA_APPROVER}}` and `{{RELEASE_OWNER}}` sign the evidence.
