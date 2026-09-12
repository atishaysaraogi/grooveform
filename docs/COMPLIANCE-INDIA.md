# Compliance in India — consumer fitness marketplace framing

This is engineering guidance, not legal advice; have a lawyer review the privacy notice and terms before launch, and again when the DPDP Rules' remaining provisions take effect (see dates below).

## 1. Positioning: why this is not a "medical" service

The app is sold as a fitness and movement tool. Nothing in it diagnoses, treats or prescribes; the only "clinical" actors are independent curators who bring their own professional relationship with the client. Keep that true in copy and in product:

- The privacy notice, the home page, every curator profile and the curator listing editor all say the app is not a medical service and curators are independent. Keep those sentences when editing copy.
- Do not collect diagnoses, conditions, pain scores or injury details as structured fields. The app deliberately has **effort** (0–10 exertion) rather than **pain**, free-text notes rather than condition pickers, and no age band. A member may type "ACL surgery" into a note or connection request; that is their choice and their text, encrypted at rest, and it is never used for anything but display to them (and, for connection requests, to the curator they addressed).
- Curators self-declare credentials. "Verified" means an admin checked a registration number against a public register (IAP, state council) and nothing more; the badge copy says so. Never say "licensed by Fyzio" or "our physiotherapists".
- The Telemedicine Practice Guidelines 2020 apply to registered medical practitioners giving consultations, not to a software platform that lets a physio send exercise routines; the curator remains responsible for whether their own practice is compliant. Put that in the curator terms (see §5).
- Trainers and coaches are not regulated professions in India; the `kind` field (physiotherapist / trainer / coach / other) exists so members can tell the difference.

## 2. DPDP Act 2023 and Rules 2025 — what the app already does

The Digital Personal Data Protection Act 2023 was notified in Rules on 13 November 2025. Consent, notice and consent-manager provisions phase in; the bulk of obligations (notice format, breach notification, erasure, children's data) apply from **13 May 2027**, with the Data Protection Board and consent-manager registration earlier. Build for the full set now.

| Obligation | Where it lives |
|---|---|
| Notice + free, specific, informed consent, itemised by purpose | `privacyNotice()` in `server/api.js`, shown at first sign-in and whenever `CONSENT_VERSION` changes; purposes `account` (required) and `diagnostics` (optional) recorded in `consent_records` with version, timestamp and IP |
| Withdraw consent as easily as giving it | Account → untick "Store movement keypoints"; delete account button |
| Right to access / portability | `GET /api/me/export` — everything about the user as JSON (decrypted server-side for them only) |
| Right to erasure | `POST /api/me/erasure` → status `erasure_requested`, 7-day grace (configurable), then housekeeping deletes user, sessions, notes, routines, connections; payments rows are kept with the user id only, for tax records (see §4) |
| Data minimisation | no video ever leaves the device; keypoints stored only with the optional purpose; identifiers hashed for lookup and encrypted for display; names/notes/messages encrypted |
| Security safeguards | AES-256-GCM at rest for personal fields, TLS in transit, HMAC-hashed tokens, CSP/HSTS, rate limits, audit log |
| Breach notification (72 h to the Board and to affected users) | OPERATIONS.md §Incident has the runbook; the audit log and `sessions` table give you the affected-user list |
| Grievance officer | `GRIEVANCE_CONTACT` shown in notice and Account; respond within the Rules' timeline (currently 90 days, expected to tighten) |
| Children | The notice states the service is for adults; there is no age gate because no age is collected. If you later target under-18s you need verifiable parental consent under the Rules — do not. |
| Data retention | audit log ≥ 1 year (`AUDIT_RETENTION_DAYS=400`), OTPs 5 min, sessions 30 days sliding, everything else until erasure |
| Cross-border | Host in India (Fly `bom`). MediaPipe model files are fetched by the browser from a CDN — that is the user's device fetching a public file, not a transfer of personal data. Razorpay is Indian. If you use Twilio/Resend, OTP delivery sends the phone/email abroad — mention it in the notice. |

### Significant Data Fiduciary

You are not one unless the government notifies you. A consumer fitness app of this size will not be, but if you reach large volumes the Rules add DPIA and audit requirements.

## 3. Curators and members' data

The curator sees: the member's display name, the connection message the member wrote, and completed sets (score, reps, faults, effort, the member's note) **only for routines that curator sent**. They do not see other curators' routines, other sets, notes, or contact details unless the member wrote them into a message. This scoping is enforced in `GET /api/curator/members/:id`. The privacy notice says this; keep it accurate if you widen access.

Curators are independent data fiduciaries for whatever they do with a client outside the app (their own clinic records). Inside the app you are the fiduciary and they are, at most, a recipient the member consented to when they connected.

## 4. Payments, tax, consumer protection

- **GST**: subscriptions to an app are an OIDAR/online service; charge 18% GST and show GST-inclusive prices (the pricing page says so). Register for GST once turnover crosses the threshold (₹20 lakh; ₹10 lakh in some states) — for OIDAR B2C services registration is mandatory regardless of turnover if you are the supplier. Razorpay's dashboard exports invoices; put your GSTIN on them.
- **Records**: keep `payments` rows for 8 years for the Income-tax Act / GST audits; that is why erasure keeps them (user id only, no personal fields).
- **Razorpay live activation** wants Privacy Policy, Terms & Conditions, Refund/Cancellation Policy and Contact Us pages on your domain.
- **Consumer Protection (E-Commerce) Rules 2020**: show total price, a grievance contact, and do not auto-renew without consent — the app uses prepaid periods with no auto-renew, and cancellation keeps access to period end with no refund by default. State the refund policy (e.g. full refund within 7 days if unused).
- **RBI recurring-payment rules** do not apply because there is no mandate.

## 5. Terms you should publish (checklist for your lawyer)

Member terms: not medical advice; consult a clinician before exercising after injury; stop on pain; camera runs locally; subscription is prepaid, non-transferable; refund policy; governing law and arbitration (Indian seat).

Curator terms: independent professional, responsible for their own registration and scope of practice; may not diagnose or prescribe through the app; must hold whatever consent their own practice needs; fees charged to clients are outside the platform; listing may be removed for misrepresentation; "verified" badge process and its limits; data they see is confidential and only for coaching that member.

Platform: you are an intermediary for curator listings (IT Act §79 safe harbour) — publish a grievance mechanism and act on complaints about listings within the statutory timelines (IT Rules 2021: acknowledge in 24 h, resolve in 15 days).

## 6. Advertising and claims

Curators write their own headline/bio. Add a moderation step (admin unlist button exists) and prohibit in curator terms: guaranteed outcomes, "cure", treating named diseases, and use of "Dr" without a registrable medical qualification (Indian physiotherapists' use of the "Dr" prefix is contested; leave it to the curator's declaration and their council). The Drugs and Magic Remedies Act and ASCI guidelines apply to health claims in ads.
