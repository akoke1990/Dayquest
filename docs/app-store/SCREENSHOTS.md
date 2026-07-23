# App Store screenshot capture matrix — DayQuest 1.0

**Status:** plan only; no final screenshots captured. Use the exact approved candidate with non-personal test data.

## Device sets

The app declares `supportsTablet: false`; plan iPhone only unless App Store Connect requires otherwise. Confirm current slot rules at capture time.

| Set | Device | Pixel size | Status |
|---|---|---:|---|
| 6.9-inch iPhone | `{{EXACT_6_9_INCH_CAPTURE_DEVICE}}` | `{{CURRENT_REQUIRED_PIXELS}}` | Not captured |
| 6.5-inch, if needed | `{{EXACT_6_5_INCH_CAPTURE_DEVICE}}` | `{{CURRENT_REQUIRED_PIXELS}}` | Not captured |
| Localizations | `{{SUPPORTED_LOCALIZATIONS}}` | Per ASC | Not captured |

## Six-frame story

| # | State | Overlay copy | Gate |
|---:|---|---|---|
| 1 | Welcome | `A city walk becomes your next quest` | No all-city/global implication |
| 2 | Live clue map | `Follow clues, not a turn-by-turn tour` | Approved cohort; no true target leak; no field-verified claim |
| 3 | Hints/warmer-colder | `Hints help without giving it all away` | Actual guidance behavior |
| 4 | Find/collectible | `Reach the place. Catch the surprise.` | Avoid bystanders; no photo recognition/remote verification implication |
| 5 | Completion recap | `See the adventure you completed` | Disposable local history; no personal GPS |
| 6 | Friends/shared hunt **or** collections | `Share a hunt with friends` / `Build your local collection` | Choose only stable shipping feature; no Custom Hunts implication |

Do not show deployment-2 Custom Hunts, prices, paywall, IAP, or subscription UI.

## Capture/copy constraints

- [ ] Record commit, version/build, device, OS, locale, raw/final checksum.
- [ ] No dev chrome, placeholders, debug errors, secrets, internal hosts, or fake UI.
- [ ] No names/emails/avatars/UIDs/invite tokens/home coordinates/personal photos.
- [ ] Use legally cleared disposable account and approved content cohort.
- [ ] Keep map/source attribution visible where required.
- [ ] Avoid third-party imagery without rights; avoid strangers/minors/private interiors/license plates.
- [ ] Do not depict unavailable behavior.
- [ ] Avoid “best,” “safest,” “accessible,” “verified,” “always open,” “offline,” “AI verified,” or “all NYC.”
- [ ] Do not obscure controls/permission text; ensure thumbnail legibility.
- [ ] Human-review translations; do not reuse English overlays for other locales.
- [ ] No transparency, borders, or distortion.
- [ ] Asset manifest includes slot, locale, device, pixels, build, commit, date, editor, checksum, approvals.

Do not use OS permission sheets as primary marketing frames. Keep separate evidence for foreground location, camera denied/skip, notification denied, no background location, and no microphone request.

## Gates

- `{{FINAL_SCREENSHOT_HEADLINES}}`
- `{{BRAND_AND_TRADEMARK_APPROVAL}}`
- `{{SHIPPING_COHORT_FIELD_STATUS}}`
- `{{SCREENSHOT_CONTENT_RIGHTS_APPROVAL}}`
- `{{FINAL_DEVICE_SLOT_REQUIREMENTS}}`
