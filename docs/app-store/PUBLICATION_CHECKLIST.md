# Public URL and legal-surface publication checklist

Repository drafts are not legal approval. A URL is not live until publicly tested over HTTPS without authentication.

| Surface | Values | Minimum content | Current state |
|---|---|---|---|
| Privacy | `{{PRIVACY_POLICY_URL}}` | Operator/contact; flows/purposes/processors; retention/backups; choices/deletion; rights/age/effective date/attribution | Draft only; config blank |
| Support | `{{SUPPORT_URL}}`, `{{SUPPORT_CONTACT}}` | Contact, troubleshooting, deletion help, safety boundary, approved response expectation | Draft only; config blank |
| Terms/Safety | `{{TERMS_URL}}` | Operator/eligibility, service limits, safety, accounts/content/third parties, counsel-approved consumer/dispute terms | Draft only; config blank |
| Deletion info | `{{DELETION_INFO_URL}}` | In-app path, deleted/retained data, timeline, logs/backups, help | Not supplied |
| Marketing | `{{MARKETING_URL_OR_NOT_USED}}` | Truthful coverage and legal/support links | Owner decision |

## Content/legal approval

- [ ] Legal entity/jurisdiction/address, rights holder, effective dates, versioning, governing law, territories, age/children position approved.
- [ ] Retention covers Supabase, JSONL, access/security logs, backups, support, local/device backups.
- [ ] Production processors/transfers/contracts match reality.
- [ ] Install-ID access/deletion and backup behavior resolved.
- [ ] OSM/ODbL, Wikipedia/Wikimedia, map-provider, and third-party notices approved.
- [ ] Content rights cover copy, icon, screenshots, maps, place/source data, and media.
- [ ] Terms do not make unsupported safety/accessibility guarantees.
- [ ] No invented SLA, retention duration, launch date, right, or remedy.

## Technical publication

- [ ] Canonical owner-controlled HTTPS pages load without auth, geo-block, app, or redirect loop.
- [ ] Mobile/desktop and basic VoiceOver/headings/links checked.
- [ ] Operator/contact/effective date and cross-links present.
- [ ] Set production EAS `EXPO_PUBLIC_PRIVACY_POLICY_URL`, `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_SUPPORT_URL`.
- [ ] Build fresh candidate; inspect public Expo config and installed links.
- [ ] Enter identical canonical URLs in App Store Connect.
- [ ] Test on Wi-Fi/cellular and logged-out/private browser.
- [ ] Archive copy approvals, HTTP checks, screenshots, timestamps, hashes.
- [ ] Assign DNS/TLS/page monitoring and support inbox ownership.

## Deletion page

- [ ] Says Menu → Profile → Delete account.
- [ ] Distinguishes Reset guest data as on-device reset.
- [ ] Matches actual live deletion/retention/backups.
- [ ] Does not claim revocation/immediacy/full erasure before proof.
- [ ] Gives failed-deletion help without requesting secrets.

Evidence archive: `{{PUBLICATION_EVIDENCE_ARCHIVE_PATH}}`. Until complete, status is **not verified**.
