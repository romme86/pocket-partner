# Pocket Partner

**Learn your lines. Rehearse with your cast. Let the app read the missing parts.**

Pocket Partner is a mobile web app for theater actors and rehearsal groups. Import a play or a standalone scene, review the text, assign voices, and rehearse together—even when someone is absent. A role can be performed live by an actor or played by the app using recorded or generated audio.

This project is a **group exercise for the [AI Product Management (AIPM) – SPRINT course at Formation Continue UNIL–EPFL](https://www.formation-continue-unil-epfl.ch/formation/ai-product-management/)**. It explores the path from user research and MVP decisions to a working AI-assisted product. It is a course project, not an official university product.

The design uses curtain red, theater gold and a compact script reader. There is no sample onboarding rehearsal: new users create a group and add their own material.

## Try the app

[Open Pocket Partner](https://179.237.83.83/pocket-partner/)

Create an account with email and password, create a private group, and add a script. Group owners can create one-use invitation links to share with their cast. No Google account is required.

## What the MVP does

- Multiple private groups with owner, editor and member roles.
- Whole-play or standalone-scene import from text-based PDF, UTF-8 TXT or pasted text. Review character labels, stage directions and scene boundaries before saving. Correct lines afterward.
- A prominent **Record & AI** workspace: record individual lines, listen to a take, replace existing audio, choose a voice per character, and prepare missing voices with ElevenLabs.
- Neutral or expressive AI delivery. Existing recordings are preserved during generation, including when a take is saved while an AI job is running.
- One controlling device for solo or group rehearsal. Choose which roles are Live and which are App; recorded app parts advance after playback, while live parts wait for Continue.
- Five dialogue entries in the reader: two before, the current line and two after when available. Long speeches scroll while controls remain accessible.
- Hide live-role lines, reveal hints, replay a cue, adjust playback speed, and loop a scene or a selected line range.
- **My practice** suggests scenes and lines using a transparent repetition heuristic. Select **My part** to associate help requests with the signed-in actor.
- Prepare a scene and its audio for up to 24 hours of offline use on the same browser. Offline practice events synchronize on reconnection. Sign-out clears that user’s downloaded data.
- Profile changes, password recovery, group/member/invitation management and account deletion.

### Practice suggestions

Repeating a cue adds 2 to the current personal line’s priority. A hint adds 3 once per visit. Explicitly marking the line **Remembered** subtracts 2, down to zero. Priorities of 2 or more appear in the review list; priorities of 8 or more receive extra emphasis. Saved lines remain until unsaved. Scenes aggregate their suggested and saved lines.

Moving forward, pausing or spending a long time on a line does not prove success or difficulty. This is a rehearsal aid, not an assessment of acting or an automatic memory measurement. Editing a line resets its practice history.

### MVP boundaries

No automatic speech recognition or voice commands, scanned-PDF OCR, voice cloning or transformation of human recordings, acting feedback, video, synchronized multi-device rehearsal, or automatic invitation emails. Invitation links are shared by the group owner. Script extraction is deterministic; importing never sends the document to an LLM. AI delivery varies by voice and is not a guarantee of dramatic interpretation.

Offline access cannot instantly reflect revoked group membership, and browser storage is subject to eviction. Prepared data expires after 24 hours; reconnect to check access and prepare it again. A removed member may retain material already downloaded, just as with other file-sharing systems.

## Architecture

- **Client:** React, TypeScript and Vite, with locally bundled fonts.
- **Authentication:** Firebase email/password on the **Spark/free plan**. No Firebase Hosting, Firestore, Cloud Storage, Cloud Functions or paid-plan upgrade is used.
- **Application:** Node.js and Express on an Infomaniak VPS.
- **Data:** PostgreSQL for groups, permissions, scripts, practice history, job reservations and invitations.
- **Files:** Private VPS volume. Every download checks current group membership; files are not served from a public directory or permanent bearer URL.
- **Audio:** Browser MediaRecorder; FFmpeg normalizes recordings to MP3. ElevenLabs supplies generated voices.
- **Processing:** PostgreSQL job queue, one worker enforced by a database lease, 60-second provider timeout and no automatic retries after an uncertain billable result.
- **Deployment:** Docker Compose behind the existing HTTPS reverse proxy at `/pocket-partner/`. API, assets and offline worker scope use the same prefix.

Firebase identifies the user. The VPS—not Firebase client configuration—decides which group data that user can access. Service-account credentials and the ElevenLabs key stay server-side.

### Resource and cost bounds

The initial deployment reserves at most **10,000 AI text characters per UTC calendar month globally**, and **3,000 per group**. Reservations are atomic across simultaneous requests. Failed or interrupted provider calls keep their reservation because a timeout does not establish whether the provider charged. Existing AI clips are reused; regeneration is explicit. Limits apply only to calls from this app, not other uses of the same ElevenLabs account.

Other initial limits: 100 MB stored per group, 1 GB globally, 10 MB per upload, 3 minutes per recording, 2 simultaneous upload conversions, 100 queued lines per generation request, 2,000 characters per generated line, 3,000 imported lines, 50 scripts per group, 30 members per group and 10 owned groups per user. New writes pause if the server has less than 2 GB of available disk space; deletion remains available. The app, worker and database have container memory/CPU limits. These are configurable application safeguards, not a currency-denominated provider billing cap. ElevenLabs usage remains separate from the Firebase free plan.

## Local development

Requires Node.js 24+, PostgreSQL 17, FFmpeg and Poppler (`pdftotext`). Alternatively, use the Docker image for the application’s system dependencies.

1. Run `npm ci`.
2. Copy `.env.example` to `.env` and set your private local values.
3. Create a PostgreSQL database and run `npm run migrate`.
4. Register a Firebase Web app and enable email/password Authentication. Save its browser config JSON at `FIREBASE_WEB_CONFIG_FILE`; set `GOOGLE_APPLICATION_CREDENTIALS` to a private Firebase Admin service-account file. No billing upgrade is needed.
5. Start `npm run dev:server` and `npm run dev` in separate terminals.
6. Open `http://127.0.0.1:4173/pocket-partner/`. Ensure `APP_ORIGIN` matches the URL you use.

Microphone access requires HTTPS in deployment, or a browser-recognized localhost context in development. Credentials, uploaded plays, personal recordings and experimental outputs are excluded from Git and the Docker build context.

`npm run build` produces the browser assets and server code. `npm start` and `npm run worker` run them. The repository does not include a real Firebase project configuration or credentials.

## Validation

`npm test` uses a real PostgreSQL database whose name must end in `_test`. Set `TEST_DATABASE_URL` (see `.env.example`). Tests never call paid audio services. They verify:

- script parsing and scene boundaries;
- group isolation across nested resources and original-file references;
- current membership checks for private files;
- one-use invitation redemption under simultaneous requests;
- member/editor permissions;
- private, idempotent practice events;
- atomic AI allowance reservations and duplicate job suppression;
- preservation of human recordings when a late AI result arrives.

CI also checks TypeScript, production builds, tracked files for secrets, and production dependency advisories. Browser/device visual and microphone-permission behavior require testing on the target phones; passing API tests does not replace that testing.

## VPS operations

See [deployment notes](deploy/README.md). The Compose stack isolates this app from other hosted projects. Database and file volumes persist across container updates. Database migrations are applied before starting the application. Backups include matching database and file snapshots, and credentials are handled separately.

## Data and source materials

Use scripts and recordings you are entitled to share with your rehearsal group. Uploaded content is private application data and is never committed to this public repository. AI preparation sends only the selected lines to ElevenLabs. Firebase processes account credentials. The bundled DM Sans and Instrument Serif font licenses are included in `public/fonts/`.
