/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);
const EVIDENCE_KINDS = ['implementation', 'test', 'workflow', 'audit', 'document'];

test('security claims point to checked-in implementation and verification evidence', async () => {
	const matrix = await readMatrix();
	const boundaries = new Map(matrix.boundaries.map((boundary) => [boundary.id, boundary]));
	assert.equal(boundaries.size, matrix.boundaries.length, 'boundary IDs must be unique');

	const evidence = [];
	for (const boundary of matrix.boundaries) {
		assert.match(boundary.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
		assert.ok(boundary.entryPoints.length > 0, `${boundary.id} needs an entry point or explicit fence`);
		evidence.push(...boundary.evidence);
	}
	for (const risk of matrix.risks) {
		for (const boundaryId of risk.boundaryIds) assert.ok(boundaries.has(boundaryId), `${risk.id} references ${boundaryId}`);
		for (const control of risk.currentControls) {
			assert.match(control.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
			assert.ok(control.summary.length > 0, `${risk.id}/${control.id} needs a summary`);
			assert.ok(control.evidence.length > 0, `${risk.id}/${control.id} needs evidence`);
			evidence.push(...control.evidence);
		}
	}

	for (const item of evidence) {
		assert.ok(EVIDENCE_KINDS.includes(item.kind), `invalid evidence kind ${item.kind}`);
		assert.ok(item.path !== matrix.modelDocument, 'the threat model is not implementation evidence');
		assert.notEqual(item.path, 'roadmap.md', 'the roadmap is not implementation evidence');
		await assert.doesNotReject(
			access(new URL(`../${item.path.split('#')[0]}`, import.meta.url)),
			`Missing security evidence: ${item.path}`,
		);
	}
});

test('threat-model documentation defines the limits of enforced controls', async () => {
	const matrix = await readMatrix();
	const documentationUrl = new URL(`../${matrix.modelDocument}`, import.meta.url);
	const documentation = await readFile(documentationUrl, 'utf8');

	for (const risk of matrix.risks) assert.match(documentation, new RegExp(`\\b${risk.id}\\b`, 'u'));
	assert.match(documentation, /enforced does not mean risk-free/iu);
	assert.match(documentation, /workers? provide fault isolation, not an operating-system security boundary/iu);
	assert.match(documentation, /native plug-ins? execute arbitrary code with the user account's authority/iu);
	assert.match(documentation, /local operating-system compromise is out of scope/iu);
	assert.match(
		documentation,
		/desktop-read-path-capabilities.*enforced for the current versioned materialized and Scape range profiles.*main assigns an immutable `?materialized-v1`?.*`?scape-range-v1`?.*store.*frozen descriptor.*canonical capability URL.*request lease.*128 pending\/live.*`?materialized-v1`?.*512 MiB.*per-owner.*`?scape-range-v1`?.*at most four capabilities.*65 GiB.*globally and per owner.*count.*before open.*bytes.*after stat.*before descriptor publication.*cleanup failure.*retains the range charge.*fences.*OS-open dispatch.*four Scape descriptors.*fifth.*unopened.*acknowledged release.*redispatches.*renderer-send failure.*releases.*descriptor/isu,
	);
	assert.match(
		documentation,
		/bounded desktop materializer.*forwards a supplied signal.*releases its capability on abort.*open.*import orchestration does not consistently own or provide that signal/isu,
	);
	assert.match(
		documentation,
		/`?scape-range-v1`? protocol.*only `GET`.*closed `?bytes=start-end`? range.*at most 16 MiB.*wholly inside.*always responds `206`.*full-file.*`HEAD`.*suffix.*open-ended.*multiple.*oversized.*end-of-file-overrun.*refuse.*profile parsing.*descriptor\/profile comparison.*range validation.*before acquisition.*cannot renew.*TTL.*store repeats.*expected-profile.*before renewal.*one active range request globally.*successful Web response body.*`?done`?.*preserves.*pinned handle.*cancellation.*request abort.*inner stream failure.*retires.*whole capability.*native stream close.*pinned handle close.*cleanup barrier.*preload validation.*exact profile.*name.*MIME.*profile-specific size.*canonical URL-path.*no query or fragment.*renderer repeats.*generic materialization rejects Scape.*strict archive adapter.*partial-response contract.*exactly once.*invalid or mismatched renderer route.*released before refusal.*Browser Blob.*Audacity/isu,
	);
	assert.match(
		documentation,
		/`?materialized-v1`? tier.*whole `?Blob`?.*512 MiB.*excludes Scape.*declared `?Content-Length`?.*emitted-byte.*final `?Blob`?-size.*16 MiB.*caller.*`?AbortSignal`?.*never calls `?response\.blob\(\)`?.*not decoder amplification or whole-process RSS/isu,
	);
	for (const claim of [
		/point-in-time-import-capacity-admission.*validated manifest asset size.*checked safe-integer arithmetic.*ceil\(10%\)/isu,
		/collision-cancel decision.*before copy remapping.*transaction construction.*source metadata reads.*writer creation.*obtains exactly one storage estimate/isu,
		/cancel performs no estimate.*copy and replace.*full incoming asset total.*missing or unknown estimate permits.*known insufficient.*QUOTA_EXCEEDED/isu,
		/maintained native-controller route.*exclusively.*decorated preflight callback.*raw asset-byte total.*composed import task signal/isu,
		/storage-capacity service.*same exact headroom requirement.*checking.*ready.*unknown.*insufficient.*lastPreflight.*one normalized estimate.*Scape quota decision/isu,
		/cancellation.*signal-ignoring estimate.*no writer or extraction.*restores the prior settled preflight snapshot.*late provider resolution or rejection.*generation-fences older work.*newer state/isu,
		/standalone undecorated imports.*optional direct store estimator.*do not update controller state/isu,
		/8,589,932,094.*9,448,925,304-byte.*before its media writer/isu,
		/does not reserve capacity.*real browser or filesystem quota accuracy.*durable 8 GiB.*overhead.*policy headroom.*write-time success.*concurrent writers/isu,
	]) assert.match(documentation, claim);
	for (const claim of [
		/inspection collision-cancel witness.*exact 8 GiB sparse Zip64 current-schema `?\.scape`? fixture.*real read-capability store.*protocol handler.*renderer adapter.*structural inspection.*collision lookup.*before cancellation.*less than 8 MiB.*65,557-byte suffix.*does not hash/isu,
		/authentic exact 8 GiB fixture.*8,589,932,094-byte.*SHA-256.*7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be.*CRC-32.*2,909,126,900.*`?checkSignature: true`?.*negative rollback/isu,
		/full-import witness.*real read-capability store.*Node protocol handler shim.*renderer adapter.*file service.*project service.*full import.*independent counting-SHA-256.*zero payload retention.*point-in-time capacity estimate.*precedes the media writer.*9,448,925,304.*no Blob materialization.*capability release.*exactly once.*pinned handle close.*exactly once/isu,
		/verified reference evidence.*opt-in.*`npm run test:reference:scape-8gib`.*routine Node.*coverage.*fast-skip.*measured all-files coverage.*passed.*525 seconds.*does not demote.*collision-cancel.*corrupted-CRC negative rollback.*routine coverage.*sparse-file support.*Node protocol shim.*(?:not|rather than) packaged UI/isu,
		/OPFS.*IndexedDB.*durable.*real production browser or filesystem quota accuracy.*reservation.*write-time success.*concurrent writers.*browser heap.*process RSS.*whole-storage atomicity.*publisher authentication/isu,
	]) assert.match(documentation, claim);
	assert.match(
		documentation,
		/shared-desktop-project-library-integrity.*partial.*product-neutral appData library.*fresh filesystem library scope `?v2`?.*ignores rather than migrates.*prior shared `?v1`? scope.*schema 1 database.*`?v2`? path.*rejected instead of implicitly migrated.*metadata schema 2.*separate opaque library entry ID.*exact schema 9.*bounded byte length.*SHA-256.*immutable revision-and-digest path.*canonical tagged-binary codec.*opaque binary state.*non-raiseable 256 MiB.*lower-only test seam.*persistence root.*reserves.*canonical path.*unique random attempt.*lease.*fencing-token.*authoritative project and stage inventories.*same immediate transaction.*before exclusive stage creation.*exact-lease cleanup.*acknowledged.*exclusive-open failure.*registration.*without unlinking.*error after exclusive creation.*registered random stage.*lost-lease or failed cleanup.*registration.*takeover.*successful materialization.*exact metadata and stage paths.*lease ID.*fencing token.*renames and syncs.*marks the canonical row materialized.*removes the stage row.*every catalog reference.*before an exact plus-one journaled catalog commit.*before staging.*before publication.*transactionally at catalog commit.*old or new complete file-and-catalog pair.*stale fencing token cannot publish.*serializes commits.*continues lease renewal while close fences new work and drains admitted work/isu,
	);
	assert.match(
		documentation,
		/after recovery.*before host exposure.*immutable-document collector.*authoritative project and stage inventories.*monotonic row IDs.*independent cycle high-waters.*both cursors.*alternating schedule.*100,000 total rows.*64-row batches.*immediate SQLite writer transaction.*exact unexpired lease.*before and after filesystem work.*current exact-lease stage.*live.*stale registered regular stage.*unlinked.*missing attempt retires.*non-regular target.*non-direct parent.*untouched and inventoried.*canonical rows.*current lease.*outstanding stage.*ineligible.*rescan flag.*restarting the canonical high-water.*portable case-folded reachability.*current catalog.*previous and next snapshots.*pending prepared or committed journals.*deterministic noncatalogable quarantine.*unregistered stage-looking.*canonical.*forged quarantine.*do not consume.*budget.*untouched.*100,001-row.*successive bounded passes.*later inserts.*next high-water cycle.*low- and mixed-cap.*canonical rescanning.*yield.*renewal and cancellation.*stale takeover.*tested reclamation failure during startup.*releases its still-owned lease.*cleanup failure.*reported.*static symlinked project root.*managed media.*untouched.*without adding renderer IPC/isu,
	);
	assert.match(
		documentation,
		/main-owned editor service.*bounded document.*strict exact-schema-9 maintained-persistence-domain validator.*before.*host commit.*before project staging.*loaded commit result.*stored reads.*before returning a renderer response.*core project, document, media, and graph structures.*strictly checked.*all audio effects.*cloneable.*generic identity, enabled, and parameter structure.*type-specific semantic checks.*missing-effect compatibility metadata.*parametric EQ.*other first- and third-party effect payload semantics.*not gated.*invalid collection shapes.*duplicate identities.*dangling source or clip references.*invalid loaded commit result.*input-side failures.*do not reach a host commit or project file.*packaged-runtime fixture.*validator.*emitted and active/isu,
	);
	assert.match(
		documentation,
		/before `JSON\.parse`.*structurally scans every schema.*101,536 JSON values.*depth 130.*exact schema 9.*independent decoded-codec.*structural-validator.*100,000 logical nodes.*depth 128 per phase/isu,
	);
	assert.match(
		documentation,
		/over-budget renderer input.*rejects before host commit.*before project staging.*loaded commit result.*rejected after the host has already published.*neither.*reaches a renderer response/isu,
	);
	assert.match(
		documentation,
		/canonical JSON-derived production graphs.*ordinary direct objects.*not arbitrary in-realm proxies.*malicious injected hosts or providers.*within that scope.*accessors.*`?toJSON`? hooks.*method-shadowed arrays.*hidden or symbol data.*cycles.*exotic containers.*non-JSON scalars.*reject without invoking application accessors/isu,
	);
	assert.match(
		documentation,
		/identity service.*frozen preload.*owner-scoped IPC.*bounded, pathless list, read, commit, and delete.*256 MiB.*4 KiB.*10,000-summary.*catalog summaries.*entry IDs.*main-owned catalog\/filesystem paths.*digests.*product preferences.*raw `updatedAtMs` fields.*leases.*fencing tokens.*owner revocation.*fences new work.*drains admitted operations/isu,
	);
	assert.match(
		documentation,
		/renderer repository.*repeats maintained-persistence-domain exact-schema-9 validation and canonical reserialization.*before local mutation.*product-local shadow.*shared latest document and summary list.*authoritative.*fails closed.*incomplete desktop bridge.*source-free editor fixture.*Soundscaper.*same identity and revision.*fresh Framescaper-local store.*next revision.*higher fencing token.*shared media catalog.*empty/isu,
	);
	assert.match(
		documentation,
		/dedicated Linux x64 CI.*two separate unpacked packages.*Soundscaper.*Framescaper.*Soundscaper.*isolated appData.*separate product profiles.*reuses.*Soundscaper profile.*renderer[- ]ready.*pathless preload IPC.*exact[- ]SHA-256.*source-free.*schema 9.*revisions 1, 2, and 3.*summary.*main-only catalog row.*clean recovery.*no stale takeover.*higher fencing token.*increasing catalog revisions?.*preferred product.*process exit.*lease release.*combined with.*composed editor.*closes only.*generic packaged source-free preload\/IPC\/multi-process\/executable lifecycle gap/isu,
	);
	assert.match(
		documentation,
		/does not qualify packaged controller autosave or tab activation.*source-bearing bytes, playback, or managed media.*concurrent opens.*crash or stale takeover.*interruption or power loss.*path identity.*installers or file associations.*Windows, macOS, or ARM64.*third-party.*gating.*legacy Soundscaper.*migration/isu,
	);
	assert.match(
		documentation,
		/latest authoritative exact-schema-9 source-bearing load.*4,094 reachable timeline, Project Bin, and fallback sources.*pre-existing latest recipient-local exact-schema-9 snapshot.*same project.*logical identity, kind, storage key, MIME type.*media geometry.*65,536 PCM chunks.*cumulative 64 GiB budget.*recipient-local video metadata sizes.*selected metadata.*before and after.*ordered Float32Array PCM.*exact chunk, channel, and frame geometry.*trusted recipient-local SHA-256.*before.*video body read.*genuine.*Blob.*SHA-256.*4 MiB.*must match.*legacy PCM-on-read migration and media-digest backfill.*disabled.*digestless legacy video.*ordinary local loading.*trusted digest backfill.*before retry.*failure raised by this repository admission.*precedes local shadow save or activation.*rendered-fallback-declaration digest check.*follows repository shadowing.*source-free.*zero source or media I\/O.*Bootstrap.*lifetime signal.*load, save, and delete.*serialized per project/isu,
	);
	assert.match(
		documentation,
		/privileged service.*compromised renderer.*over-budget or maintained-domain-invalid exact-schema-9 input.*before.*host.*stage a project.*maintained-domain-invalid or structurally over-budget loaded commit results and stored documents.*before a renderer response.*renderer repository.*repeats validation.*loaded-result refusal.*host commit may already be published.*closes.*privileged-domain-validation residual.*qualifies per-phase project-shape node and depth ceilings.*shared-project-parse-budget.*remains open.*256 MiB.*101,536-value\/depth-130 raw preflight.*per-phase 100,000-node\/depth-128.*do not combine.*end-to-end work budget.*CPU or elapsed time.*cancellation.*allocation.*main-process RSS.*bounded sequential readability check.*not an atomic snapshot.*selected metadata.*not transactionally bound.*same-metadata replacement.*can go undetected.*replacement or deletion afterward.*not fenced.*separate repository instances or processes.*not serialized.*fresh recipient lacks.*descriptor snapshot.*automatic byte acquisition.*managed-media.*Linux x64.*source-free packaged lifecycle.*qualified.*remaining platform.*fault.*power-loss.*parent- and database-path identity.*Windows directory-sync and deny-delete behavior.*junction.*time-of-check\/time-of-use.*interrupted foreign collisions.*registered random stage paths.*unregistered or legacy pre-inventory stage-looking files.*foreign.*not adopted or deleted.*compatibility beyond those retained raw-document migration paths.*prior shared `v1` scope or product-private Soundscaper libraries.*deferred and unsupported.*Audacity.*separate boundary/isu,
	);
	assert.doesNotMatch(documentation, /guaranteed progress after an incomplete|incomplete 100,000-entry reclamation inventory/iu);
	assert.doesNotMatch(documentation, /abandoned stage-file cleanup.*remain(?:s)? open/iu);
});

test('project feature requirements are bounded and fail closed at activation and pre-open inspection', async () => {
	const matrix = await readMatrix();
	const boundary = matrix.boundaries.find(({ id }) => id === 'external-input-to-parser');
	const projectDocuments = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	const control = projectDocuments?.currentControls.find(
		({ id }) => id === 'project-schema-and-forward-read-validation',
	);
	const fallbackAdmission = projectDocuments?.currentControls.find(
		({ id }) => id === 'controller-rendered-fallback-admission',
	);
	const fallbackPlayback = projectDocuments?.currentControls.find(
		({ id }) => id === 'first-party-audio-rendered-fallback-playback',
	);

	assert.ok(boundary);
	assert.ok(projectDocuments);
	assert.equal(projectDocuments.status, 'partial');
	assert.equal(projectDocuments.releaseDisposition, 'conditional');
	assert.ok(control);
	assert.ok(fallbackAdmission);
	assert.ok(fallbackPlayback);
	for (const path of [
		'src/common/editor/migration.js',
		'src/common/editor/project-feature-requirements.ts',
		'src/common/editor/project-v9.ts',
		'src/common/editor/retention.js',
		'src/common/editor/scape-project-assets.ts',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-project.js',
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-owned-feature-requirements.ts',
		'src/common/editor/project-feature-audio-effect-bypass.ts',
		'src/common/editor/project-feature-video-effect-bypass.ts',
		'src/common/editor/video-effects.js',
		'src/common/editor/project.js',
		'src/common/editor/project-feature-report-metadata.ts',
		'src/common/editor/session.js',
		'src/common/editor/controller/project-feature-compatibility-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/controller/document-snapshot.ts',
		'src/common/editor/controller/scape-inspection-service.ts',
		'src/common/editor/controller/scape-project-file-service.ts',
		'src/common/editor/controller/scape-open-request-service.ts',
		'src/common/editor/ui/workspace/scape-open-decision-continuation.ts',
		'src/common/editor/ui/workspace/useScapeOpenDecisionContinuation.ts',
		'src/common/editor/ui/workspace/ScapeOpenDecisionDialog.jsx',
		'src/common/editor/ui/workspace/project-feature-compatibility-notice.ts',
		'src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx',
		'src/common/editor/ui/workspace/AudioEditorWorkspaceView.jsx',
		'src/common/editor/ui/workspace/video-preview-effect-bypass.ts',
		'src/common/editor/ui/workspace/VideoPreviewPanel.jsx',
		'src/common/editor/app.js',
		'tests/audio-editor-project-feature-requirements.test.ts',
		'tests/audio-editor-project-v9.test.ts',
		'tests/audio-editor-feature-requirement-retention.test.ts',
		'tests/audio-editor-scape-feature-requirements.test.ts',
		'tests/audio-editor-scape-export-fallback-integrity.test.ts',
		'tests/audio-editor-project-feature-capabilities.test.ts',
		'tests/audio-editor-project-owned-feature-requirements.test.ts',
		'tests/audio-editor-project-feature-audio-effect-bypass.test.ts',
		'tests/audio-editor-project-feature-video-effect-bypass.test.ts',
		'tests/audio-editor-video-preview-effect-bypass.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-session.test.js',
		'tests/audio-editor-document-snapshot.test.ts',
		'tests/audio-editor-scape-inspection-service.test.ts',
		'tests/audio-editor-scape-project-file-service.test.ts',
		'tests/audio-editor-scape-open-request-service.test.ts',
		'tests/audio-editor-scape-open-decision-continuation.test.ts',
		'tests/audio-editor-scape-open-decision-dialog.test.ts',
		'tests/audio-editor-project-feature-compatibility-notice.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);
	for (const path of [
		'src/common/editor/migration.js',
		'src/common/editor/project-feature-requirements.ts',
		'src/common/editor/project-v9.ts',
	]) assert.ok(boundary.entryPoints.includes(path), path);

	assert.match(control.summary, /bounded declarative.*deep-frozen/iu);
	assert.match(control.summary, /duplicate requirement IDs.*noncanonical feature IDs.*unsupported dispositions/iu);
	assert.match(control.summary, /without executing project-supplied identifiers or mutating/iu);
	assert.match(control.summary, /current-schema.*current-format.*\.scape.*preserve.*manifest.*fallback-only source assets.*collision remapping/iu);
	assert.match(control.summary, /stable.*product capability registry.*strict `true`.*unregistered IDs.*unknown/iu);
	assert.match(control.summary, /schema 9.*create.*load.*clone.*commit.*reserved `soundscaper\.audio-effects`.*track.*group.*send.*master.*disabled.*inactive.*publisher-authored.*take precedence.*missing.*foreign.*do not trigger.*reserved-ID conflicts.*reject/iu);
	assert.match(control.summary, /same paths.*reserved `soundscaper\.video-effects`.*timeline.*Project Bin.*video clips.*disabled.*publisher-authored.*take precedence.*missing.*foreign.*non-video clips.*do not trigger.*reserved-ID conflicts.*reject/iu);
	assert.match(control.summary, /schema 9.*actual project history.*before activation.*intrinsically read-only.*deep-frozen.*session metadata clones.*snapshot.*future schemas.*null.*not traversed/iu);
	assert.match(control.summary, /same-ID tab.*stored read-only declaration.*ignored incoming.*flags/iu);
	assert.match(control.summary, /current-format \.scape inspection.*provider-owned.*caller.*override.*exact schema 9.*before.*collision lookup.*deep-frozen.*future schemas.*null.*not traversed/iu);
	assert.match(control.summary, /one.*decision.*no-collision.*open-read-only.*cancel.*combined.*copy-read-only.*cancel/iu);
	assert.match(control.summary, /cancel.*before.*import.*persistence.*activation.*actual project history.*intrinsically read-only/iu);
	assert.match(control.summary, /localized.*stable feature IDs.*declared disposition.*defaults? focus.*Cancel.*Escape/iu);
	assert.match(control.summary, /active workspace.*persistent.*non-dismissible.*document-level.*counts.*bounded display names.*stable feature IDs.*declared dispositions.*tab.*active/iu);
	assert.match(control.summary, /available items.*excluded.*evaluator messages.*fallback internals.*not read.*no activation controls.*runtime fallback.*third-party/iu);
	assert.match(control.summary, /exact schema 9.*registered `audioEffects`.*unavailable.*declared `bypass`.*effective `bypassed`.*bounded.*non-persisted.*engine projection.*before activation side effects.*canonical project.*history.*persistence.*unchanged/iu);
	assert.match(control.summary, /active.*enabled.*not already bypassed.*maintained first-party.*track.*group.*send.*master.*4,096.*params.*context.*state.*not read.*deep-frozen.*affected-object inventory.*localized.*no controls/iu);
	assert.match(control.summary, /unknown.*third-party.*rendered fallback.*offline render.*export.*activation controls.*outside/iu);
	assert.match(control.summary, /exact schema 9.*registered `videoEffects`.*unavailable.*declared `bypass`.*effective `bypassed`.*bounded.*non-persisted.*preview-playback projection.*before activation side effects.*canonical project.*history.*source loading.*persistence.*save paths.*offline render.*video export.*unchanged/iu);
	assert.match(control.summary, /enabled maintained first-party.*timeline.*Project Bin.*minimal disabled engine copies.*4,096.*256-character stable-ID.*128-character effect-type.*params.*context.*state.*opaque payloads.*not read/iu);
	assert.match(control.summary, /cached selector.*exact timeline clip-ID.*effect-ID.*effect-type.*before compositor rendering.*active-effect counting.*preserving unchanged stack references.*Project Bin.*not a compositor input/iu);
	assert.match(control.summary, /deep-frozen.*location.*clip ID.*effect ID.*effect type.*localized labels.*canonical clip ownership.*no controls.*future schemas.*before clip or Project Bin traversal/iu);
	assert.match(control.summary, /already-disabled.*foreign.*unknown.*third-party.*rendered fallback.*offline render.*export.*activation controls.*earlier Soundscaper project schemas.*outside this video slice/iu);
	assert.match(control.summary, /current-format.*exact schema 9.*fallback.*claim.*canonical asset descriptor.*before.*collision.*storage/iu);
	assert.match(control.summary, /export.*snapshot.*project root.*source records.*same sources.*toJSON rewrites.*hash.*before.*manifest.*commit.*import.*body.*SHA-256.*before.*publication/iu);
	assert.match(control.summary, /inspection.*descriptor binding.*does not hash.*asset bodies/iu);
	assert.match(control.summary, /separate maintained-controller admission.*exact-schema-9 raw and stored-project fallback bytes.*direct store loads.*runtime fallback substitution.*third-party/iu);
	assert.match(control.summary, /generic runtime fallback substitution.*generic unavailable-feature placeholders.*general per-feature activation controls.*outside/iu);
	for (const path of [
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/storage/media-content-digest.ts',
		'src/common/editor/storage.js',
		'src/common/editor/storage/source-read-repository.ts',
		'src/common/editor/storage/source-repository.ts',
		'src/common/editor/storage/media-asset-digest-backfill.ts',
		'src/common/editor/storage/media-repository.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/session-activation.js',
		'src/common/editor/session.js',
		'src/common/editor/app.js',
		'tests/audio-editor-project-fallback-integrity.test.ts',
		'tests/audio-editor-source-read-cancellation.test.ts',
		'tests/audio-editor-media-asset-load.test.ts',
		'tests/audio-editor-project-switch-fallback-integrity.test.ts',
		'tests/audio-editor-session-project-activation.test.js',
	]) assert.ok(fallbackAdmission.evidence.some((item) => item.path === path), path);
	assert.match(
		fallbackAdmission.summary,
		/authoritative exact-schema-9.*same-ID tab history.*session-owned history token.*local bytes.*before activation side effects.*exclusive session activation reservation.*history replacement.*competing active-project publication.*session publication.*released in finally.*audio-f32le-chunks-v1.*65,536-chunk.*video.*immutable original-media Blob.*4 MiB.*64 GiB.*before fallback body reads/iu,
	);
	assert.match(fallbackAdmission.summary, /disable.*PCM migration scheduling.*digest claim.backfill.*does not publish storage maintenance/iu);
	assert.match(fallbackAdmission.summary, /sequential.*cooperatively cancellable.*read-only video-metadata.*raced against cancellation.*signal-ignoring provider.*continue after admission rejects.*provider-stalled fallback body read.*delay cancellation settlement.*iterator cleanup/iu);
	assert.match(fallbackAdmission.summary, /deduplicates.*conflicting digests.*before storage reads/iu);
	assert.match(
		fallbackAdmission.summary,
		/no asset read.*future schemas.*point-in-time.*direct store\.loadProject.*continuously bind.*publisher authenticity.*runtime.*future schemas.*placeholder.*bypass.*third-party/iu,
	);
	for (const path of [
		'src/common/editor/project-feature-audio-rendered-fallback.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/source-lifecycle-service.ts',
		'src/common/editor/controller/source-audio.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/app.js',
		'tests/audio-editor-project-feature-audio-rendered-fallback.test.ts',
		'tests/audio-editor-playback-project-service.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
		'tests/audio-editor-required-source-preparation.test.ts',
		'tests/audio-editor-source-audio.test.ts',
		'tests/audio-editor-project-switch-fallback-integrity.test.ts',
		'tests/audio-editor-project-switch-playback-apply.test.ts',
		'tests/audio-editor-project-switch-source-preparation.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/browser/audio-editor-scape-open-compatibility.spec.js',
	]) assert.ok(fallbackPlayback.evidence.some((item) => item.path === path), path);
	assert.match(
		fallbackPlayback.summary,
		/exact schema 9.*registered audioEffects.*unavailable.*declared and effective rendered-fallback.*canonical manifest.*mono or stereo.*whole-mix.*frame zero.*removes canonical audio.*neutral.*mixer and master.*retains video and label/iu,
	);
	assert.match(
		fallbackPlayback.summary,
		/initial activation and later engine reapplies.*stored metadata.*rechecked.*short sources.*buffer geometry.*oversized sources.*streamable chunk provider.*does not prefetch or revalidate.*later provider failure/iu,
	);
	assert.match(
		fallbackPlayback.summary,
		/initial activation.*privately stages only the required fallback source.*before.*session activation reservation.*activation side effects.*decoded buffer or stream-provider candidate.*outside shared sourceBuffers.*shared sourceChunkProviders.*engine chunk-source publication.*pre-reservation.*metadata.*audio-context.*decoded-body.*controller-lifetime signal.*promptly.*exact reason.*late settlement.*buffers.*chunk providers.*engine chunk sources.*missing-source state.*status/iu,
	);
	assert.match(
		fallbackPlayback.summary,
		/readiness or reservation failure.*discards.*active project, tab, lock.*prior shared source identities.*rechecks fallback admission.*session-owned history identity.*before reserving.*currentness checks.*engine entry.*shared publication.*ordinary loading.*excludes.*staged fallback source/iu,
	);
	assert.match(
		fallbackPlayback.summary,
		/commit builds private buffer and provider snapshots.*current shared state.*ordinary transient buffers.*staged required source.*precedence.*conflicting transient.*engine.*private snapshots first.*after.*callback returns.*checks the signal.*owning admission or canonical-project identity assertion.*synchronously.*publication boundary.*no await intervenes.*required buffer or provider.*mutates shared state/iu,
	);
	assert.match(
		fallbackPlayback.summary,
		/engine failure.*cancellation.*reservation or currentness failure.*publication-boundary identity failure.*throwing cache publication.*preserve prior shared identities.*cache refusal.*removes.*stale required representation.*commit ownership.*single-use.*discard.*idempotent/iu,
	);
	assert.match(
		fallbackPlayback.summary,
		/each canonical playback reapply.*one replaceable controller-lifetime task.*newer reapply.*successful project switch.*abort.*metadata.*audio-context.*decoded-body.*exact reason.*late settlement.*buffers.*chunk providers.*engine chunk sources.*missing-source state.*status.*only the newest source-ready projection.*engine/iu,
	);
	assert.match(
		fallbackPlayback.summary,
		/engine\.applyProject or activation engine callback.*not abortable or transactional.*may have taken effect.*post-call publication-boundary assertion.*blocks shared publication.*later activation step.*successful engine and shared source publication.*not rolled back.*ordinary-source loading.*outside.*required-source publication transaction.*short-buffer retention.*cache-fit policy.*streamed chunks.*not prefetched or revalidated.*generic or video fallback.*unknown or third-party.*future schemas.*earlier Soundscaper/iu,
	);

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(documentation, /feature-requirements manifest.*deep-frozen/iu);
	assert.match(documentation, /do(?:es)? not hash or authenticate the referenced media bytes/iu);
	assert.match(documentation, /current-schema.*current-format `\.scape`.*preserve.*manifest.*fallback-only source assets.*collision remapping/iu);
	assert.match(documentation, /stable.*product capability registry.*strict `true`.*unregistered IDs.*unknown/iu);
	assert.match(documentation, /schema 9.*create.*load.*clone.*commit.*`soundscaper\.audio-effects`.*track.*group.*send.*master.*disabled.*inactive.*publisher-authored.*take precedence.*missing.*foreign.*do not trigger.*reserved-ID conflicts.*reject/iu);
	assert.match(documentation, /same paths.*`soundscaper\.video-effects`.*timeline.*Project Bin.*video clips.*disabled.*publisher-authored.*take precedence.*missing.*foreign.*non-video clips.*do not trigger.*reserved-ID conflicts.*reject/iu);
	assert.match(documentation, /schema 9.*actual project history.*before activation.*intrinsically read-only.*deep-frozen.*session metadata clones.*snapshot.*future schemas.*`null`.*not traversed/iu);
	assert.match(documentation, /same-ID tab.*stored read-only declaration.*ignored incoming.*flags/iu);
	assert.match(documentation, /active workspace.*persistent.*non-dismissible.*document-level.*counts.*bounded display names.*stable feature IDs.*declared dispositions.*tab.*active/iu);
	assert.match(documentation, /available items.*excluded.*evaluator messages.*fallback internals.*not read.*no activation controls.*runtime fallback.*third-party/iu);
	assert.match(documentation, /exact schema 9.*registered `audioEffects`.*unavailable.*declared `bypass`.*effective `bypassed`.*bounded.*non-persisted.*engine projection.*before activation side effects.*canonical project.*history.*persistence.*unchanged/iu);
	assert.match(documentation, /active.*enabled.*not already bypassed.*maintained first-party.*track.*group.*send.*master.*4,096.*does not read.*params.*context.*state.*deep-frozen.*localized.*noninteractive affected-object inventory/iu);
	assert.match(documentation, /unknown.*third-party.*rendered fallback.*offline render.*export.*activation controls.*outside/iu);
	assert.match(documentation, /exact schema 9.*registered `videoEffects`.*unavailable.*declared `bypass`.*effective `bypassed`.*bounded.*non-persisted.*preview-playback projection.*before activation side effects.*canonical project.*history.*source loading.*persistence.*save paths.*video export.*unchanged/iu);
	assert.match(documentation, /enabled maintained first-party.*timeline.*Project Bin.*minimal disabled copies.*4,096.*256-character stable-ID.*128-character effect-type.*does not read.*params.*context.*state.*opaque payloads/iu);
	assert.match(documentation, /deep-frozen.*Timeline or Project Bin.*location.*clip ID.*effect ID.*effect type.*localized.*control-free/iu);
	assert.match(documentation, /cached selector.*exact timeline.*clip ID.*effect ID.*effect type.*compositor rendering.*active-effect counting.*Project Bin.*not.*compositor/iu);
	assert.match(documentation, /future schemas.*before clip or Project Bin traversal.*unknown.*third-party.*rendered fallback.*offline render.*export.*activation controls.*outside/iu);
	assert.match(documentation, /current-format `\.scape` inspection.*provider-owned.*caller.*override.*schema 9.*before.*collision lookup.*deep-frozen.*future schemas.*`null`.*not traversed/iu);
	assert.match(documentation, /no-collision.*Open read-only.*Cancel.*combined.*Open as read-only copy.*single decision/isu);
	assert.match(documentation, /Cancel.*before import, persistence, or activation.*controller.*actual project history.*intrinsically read-only/isu);
	assert.match(documentation, /current-format.*exact schema 9.*fallback.*claim.*asset descriptor.*before.*collision.*storage/iu);
	assert.match(documentation, /export.*project root.*source records.*same sources.*accessors.*`toJSON` hooks.*without invocation.*hash.*before.*manifest.*commit.*import.*body.*SHA-256.*publication/iu);
	assert.match(documentation, /inspection.*does not hash.*asset bodies.*maintained exact-schema-9 controller activation.*referenced local audio and video fallback bytes/iu);
	assert.match(documentation, /disable.*PCM migration scheduling.*digest claim.backfill.*does not publish storage maintenance/iu);
	assert.match(documentation, /read-only video-metadata preflight.*raced against cancellation.*signal-ignoring provider.*continue after admission rejects.*fallback body read.*delay cancellation settlement/iu);
	assert.match(documentation, /direct `store\.loadProject\(\)` calls.*continuous integrity.*runtime fallback use.*future-schema.*outside/iu);
	assert.match(documentation, /point-in-time admission.*complete third-party activation gating/iu);
	assert.match(documentation, /first-party audio rendered-fallback playback.*exact schema 9.*whole-mix.*frame zero.*canonical project.*unchanged/isu);
	assert.match(documentation, /stored metadata.*rechecked.*short sources.*buffer geometry.*oversized sources.*streamable chunk provider.*does not prefetch or revalidate.*later provider failure/isu);
	assert.match(documentation, /initial activation.*privately stages only the required fallback source.*before.*session activation reservation.*activation side effects.*decoded buffer or stream-provider candidate.*outside shared `sourceBuffers`.*shared `sourceChunkProviders`.*engine chunk-source publication.*pre-reservation phase.*metadata.*audio-context.*decoded-body.*controller-lifetime signal.*exact reason.*late settlement.*buffers.*chunk providers.*engine chunk sources.*missing-source state.*status/isu);
	assert.match(documentation, /readiness or reservation failure.*discards.*active project.*tab.*lock.*prior shared source identities.*rechecks fallback admission.*session-owned history identity.*before reserving.*currentness checks.*engine entry.*shared publication.*ordinary loading.*excludes.*staged fallback source/isu);
	assert.match(documentation, /commit builds private buffer and provider snapshots.*current shared state.*ordinary transient buffers.*staged required source.*precedence.*conflicting transient.*engine.*private snapshots first.*after.*callback returns.*checks the signal.*owning admission or canonical-project identity assertion.*synchronously.*publication boundary.*no await intervenes.*required buffer or provider.*mutates shared state/isu);
	assert.match(documentation, /engine failure.*cancellation.*reservation or currentness failure.*publication-boundary identity failure.*throwing cache publication.*preserve.*prior shared identities.*cache refusal.*removes.*stale required representation.*commit ownership.*single-use.*discard.*idempotent/isu);
	assert.match(documentation, /each canonical playback reapply.*replaceable controller-lifetime task.*newer reapply.*successful project switch.*abort.*metadata.*audio-context.*decoded-body.*exact reason.*late settlement.*buffer.*provider.*engine.*missing-source.*status.*only the newest source-ready projection.*engine/isu);
	assert.match(documentation, /not a durable byte lease.*`engine\.applyProject` or activation engine callback.*not abortable or transactional.*may have taken effect.*post-call publication-boundary assertion.*blocks shared publication.*later activation step.*successful engine and shared source publication.*not rolled back.*ordinary-source loading.*outside.*required-source publication transaction.*short-buffer retention.*cache-fit policy.*streamed chunks.*not prefetched or revalidated.*generic and video fallback.*unknown or third-party activation/isu);
	const roadmap = await readFile(roadmapUrl, 'utf8');
	assert.match(roadmap, /first-party audio whole-mix editor playback through both.*short decoded-source.*oversized stream-provider paths.*persistent active-fallback\s+indicator.*browser-qualified.*activation.*playback-protocol stream.*correlated stream.*source chunk.*packet.*direct or.*resampled geometry.*direct stream-provider readiness\s+boundary.*unit-qualified.*does not prefetch or revalidate chunks after\s+point-in-time admission.*exit.*remains open/isu);
	assert.match(roadmap, /unit evidence.*private required-source staging before.*activation reservation.*prompt lifetime cancellation.*signal-ignoring\s+metadata.*audio-context.*decoded-body stalls.*exact reason preservation.*no late source or status publication.*discard.*failed currentness or\s+reservation.*prior shared identities intact.*private engine-input\s+snapshots.*staged fallback wins.*conflicting transient/isu);
	assert.match(roadmap, /shared\s+source maps publish only after.*engine callback succeeds.*lifetime\s+remains active.*each\s+canonical playback reapply.*replaceable\s+controller-lifetime task.*newer reapply.*successful project switch.*only the newest source-ready projection.*engine/isu);
	assert.match(roadmap, /entered engine call.*non-abortable.*non-transactional.*later activation failure.*does not undo.*successful commit.*ordinary-source loading.*outside.*transaction.*cache-fit policy/isu);
});

test('legacy AUP evidence pins structural and block-materialization budgets', async () => {
	const matrix = await readMatrix();
	const projectDocuments = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	assert.ok(projectDocuments);
	assert.equal(projectDocuments.status, 'partial');
	assert.equal(projectDocuments.releaseDisposition, 'conditional');

	const legacyAup = projectDocuments.currentControls.find(
		({ id }) => id === 'legacy-aup-xml-structural-budget',
	);
	assert.ok(legacyAup);
	assert.match(
		legacyAup.summary,
		/format-specific.*legacy `?\.aup`? XML.*authoritative declared `File\.size`.*independently measures.*returned text.*UTF-8 byte length.*16 MiB.*100,000.*elements.*400,000.*attributes.*depth.*128.*lower-only.*before.*`?_data`?.*block.*conversion.*project\/source persistence.*publication.*does not qualify.*elapsed time.*other project families.*PCM amplification.*total import working set/iu,
	);
	for (const path of [
		'src/common/editor/aup-legacy-xml.ts',
		'src/common/editor/aup-legacy.js',
		'src/common/editor/controller/project-import-service.ts',
		'tests/audio-editor-aup-legacy.test.js',
		'tests/audio-editor-aup-legacy-import-boundary.test.ts',
	]) assert.ok(legacyAup.evidence.some((item) => item.path === path));

	const blockBudget = projectDocuments.currentControls.find(
		({ id }) => id === 'legacy-aup-block-pcm-working-set-budget',
	);
	assert.ok(blockBudget);
	assert.match(
		blockBudget.summary,
		/canonical, default-sized legacy `?\.aup`?.*simple and silent.*non-raiseable.*lower-only.*65,536 selected.*65,536 materializing references.*2 MiB.*physical file.*1 MiB.*sample payload.*524,288.*frames per block.*512 MiB.*unique referenced `File\.size`.*512 MiB.*retained Float32 PCM.*bounded exact\/basename indexes.*positive block lengths.*24-byte AU header.*equal-length paired linked clips.*before retained-PCM allocation or block reads.*payload\/frame checks precede decoded-block allocation.*actual `ArrayBuffer\.byteLength`.*snapshotted declared size.*native-endian.*unique file.*preallocated output.*logically reachable parser-owned pending window.*2 MiB encoded.*2 MiB decoded.*without channel-normalization copies.*precedes conversion.*persistence.*publication.*does not qualify.*customized Audacity block-size.*garbage-collection lag.*total renderer RSS.*streaming-scale/iu,
	);
	for (const path of [
		'src/common/editor/aup-legacy-block-budget.ts',
		'src/common/editor/aup-legacy.js',
		'src/common/editor/controller/project-import-service.ts',
		'tests/audio-editor-aup-legacy-block-budget.test.ts',
		'tests/audio-editor-aup-legacy-block-compatibility.test.ts',
		'tests/audio-editor-aup-legacy.test.js',
		'tests/audio-editor-aup-legacy-import-boundary.test.ts',
	]) assert.ok(blockBudget.evidence.some((item) => item.path === path));

	const sharedBudget = projectDocuments.residualRisks.find(({ id }) => id === 'shared-project-parse-budget');
	const malformedCorpus = projectDocuments.residualRisks.find(({ id }) => id === 'malformed-project-corpus');
	assert.ok(sharedBudget);
	assert.match(
		sharedBudget.exposure,
		/legacy `?\.aup`? XML.*canonical, default-sized simple\/silent `?_data`?.*structural.*referenced-input.*block-geometry.*retained-PCM.*indexed-lookup.*parser-owned pending-window/iu,
	);
	assert.match(
		sharedBudget.exposure,
		/raw-JSON structural preflight.*every schema.*before `JSON\.parse`.*101,536 JSON values.*depth 130.*exact schema 9.*decoded.*semantic validator.*independent ceilings.*100,000 logical nodes.*depth 128/iu,
	);
	assert.match(
		sharedBudget.exposure,
		/over-budget renderer input.*before host commit or staging.*loaded commit result.*before the renderer response.*may follow host publication/iu,
	);
	assert.match(
		sharedBudget.exposure,
		/lexical preflight.*decoded-codec traversal.*validation admission.*response serialization.*reset their counters.*per-phase shape bounds.*aggregate execution budget.*CPU or elapsed time.*cancellation.*allocation.*provider-internal allocation.*garbage-collection lag.*total main-process RSS/iu,
	);
	assert.match(
		sharedBudget.exposure,
		/other supported project parsers.*elapsed-time budgets.*opaque-extension cloning.*aliases.*customized Audacity block sizes.*downstream.*total renderer RSS.*cancellation.*streaming-scale legacy import/iu,
	);
	assert.match(
		sharedBudget.requiredControl,
		/structural budgets.*remaining project families.*aggregate CPU or elapsed-time.*cancellation.*scalar-byte work.*end-to-end working-set.*repeated main shared-project phases.*downstream legacy-import/iu,
	);
	assert.ok(malformedCorpus);
	assert.match(
		malformedCorpus.exposure,
		/focused legacy `?\.aup`? XML and AU-block.*declared.*returned XML bytes.*elements.*attributes.*depth.*selected.*referenced.*indexed lookup.*ambiguity.*declared\/actual block bytes.*header minimum.*positive block.*payload\/frame.*native endianness.*pre-allocation refusal.*retained PCM.*silence.*repeated references.*stereo padding.*unequal linked-pair rejection.*does not yet cover every supported project family/iu,
	);

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(
		documentation,
		/external-project-document-validation.*partial.*legacy `?\.aup`? XML.*`File\.size`.*UTF-8 byte length.*16 MiB.*100,000.*400,000.*128.*canonical, default-sized simple\/silent `?_data`?.*65,536.*2 MiB.*1 MiB.*524,288.*512 MiB.*retained Float32 PCM.*exact\/basename indexes.*positive block lengths.*24-byte AU header.*equal-length paired linked clips.*precedes retained-PCM allocation or block reads.*precedes decoded-block allocation.*native-endian.*unique file.*preallocated output.*logically reachable parser-owned window.*precedes conversion.*persistence.*publication.*do not qualify.*customized Audacity block-size.*garbage-collection lag.*total renderer RSS.*streaming-scale.*corpus/isu,
	);
	assert.match(
		documentation,
		/shared-project-parse-budget.*remains open.*101,536-value\/depth-130 raw preflight.*per-phase 100,000-node\/depth-128 exact-V9 decode and validator admissions.*do not combine.*end-to-end work budget.*CPU or elapsed time.*cancellation.*allocation.*total main-process RSS/isu,
	);

	const roadmap = await readFile(roadmapUrl, 'utf8');
	assert.match(
		roadmap,
		/security control matrix.*legacy.*\.aup.*XML.*16\s+MiB.*100,000.*400,000.*128/isu,
	);
	assert.match(
		roadmap,
		/block\/PCM budget.*65,536.*2 MiB.*1 MiB.*524,288.*512 MiB.*retained Float32 PCM/isu,
	);
	assert.match(
		roadmap,
		/before allocation\s+or block reads.*decoded-block allocation.*exact\/basename.*native-endian.*unique block.*preallocated clip outputs.*parser-owned/isu,
	);
	assert.match(
		roadmap,
		/every serialized\s+project.*lexical preflight.*101,536 JSON values.*depth 130.*before `JSON\.parse`.*each exact-V9 decoded codec traversal.*maintained-domain\s+validation phase.*independently.*100,000 nodes.*depth 128.*future-schema JSON.*structural preflight.*neither decoded nor\s+interpreted/isu,
	);
	assert.match(
		roadmap,
		/renderer input refusal.*precedes host mutation.*staging.*loaded commit result.*before the renderer response.*host publication may already have completed.*counters reset between.*lexical.*codec.*validator.*serialization phases.*per-phase shape.*not aggregate work.*CPU\/elapsed time.*allocation amplification.*cancellation latency.*resident memory/isu,
	);
	assert.match(
		roadmap,
		/prove refusal before conversion.*project\/source persistence.*imported-project publication/isu,
	);
	assert.match(
		roadmap,
		/default-sized blocks.*customized Audacity.*unsupported.*(?:still|also)\s+leaves.*elapsed\s+time.*aliases.*garbage-collection lag.*total renderer\s+RSS.*streaming-scale/isu,
	);
});

test('project publication evidence keeps canonical admission distinct from backend capacity', async () => {
	const matrix = await readMatrix();
	const projectDocuments = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	assert.ok(projectDocuments);
	const admission = projectDocuments.currentControls.find(
		({ id }) => id === 'maintained-project-publication-admission',
	);
	const accounting = projectDocuments.residualRisks.find(
		({ id }) => id === 'project-publication-capacity-accounting',
	);
	assert.ok(admission);
	assert.match(
		admission.summary,
		/maintained caller save.*`AudioEditorProjectStore\.saveProject`.*canonical.*UTF-8.*non-raiseable 256 MiB.*lower-only.*before repository save.*queued controller.*twice.*gross proxy.*current.*revision.*ceil\(10%\).*known insufficient IndexedDB.*before repository.*success side effects.*unknown.*non-IndexedDB.*proceeds.*successor/isu,
	);
	for (const path of [
		'src/common/editor/project-publication-admission.ts', 'src/common/editor/storage.js',
		'src/common/editor/controller/project-save-service.ts',
		'src/common/editor/controller/storage-capacity-runtime.ts',
		'src/common/editor/controller/storage-capacity-service.ts', 'src/common/editor/app.js',
		'tests/audio-editor-project-publication-admission.test.ts',
		'tests/audio-editor-project-store-publication-admission.test.ts',
		'tests/audio-editor-project-save-publication-admission.test.ts',
		'tests/audio-editor-controller-disposal.test.js',
		'tests/audio-editor-storage-capacity-runtime.test.ts',
		'tests/audio-editor-storage-capacity-service.test.ts',
	]) assert.ok(admission.evidence.some((item) => item.path === path), path);
	assert.ok(accounting);
	assert.match(
		accounting.exposure,
		/twice-canonical.*not.*structured-clone.*repository compaction.*revision-wrapper.*record.*key.*property.*transaction.*journal.*replacement.*pruning.*allocation-unit.*estimates may lag.*concurrent writers.*write-time quota.*after canonical serialization.*snapshot.*serializ.*heap.*RSS.*garbage collection.*queued controller saves.*direct store-facade saves.*project-row capacity check.*route-specific controls.*memory fallback.*no durable-capacity claim.*desktop.*local IndexedDB shadow.*not.*IPC.*appData.*directly constructed repository.*pre-existing over-limit/isu,
	);
	assert.match(accounting.requiredControl, /actual backend publication geometry.*resident working set.*reserve.*concurrent writes.*desktop appData/isu);

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(documentation, /maintained-project-publication-admission.*`AudioEditorProjectStore\.saveProject`.*canonical.*256 MiB.*queued autosave.*explicit flush.*terminal flush.*twice.*gross proxy.*ceil\(10%\).*known insufficient IndexedDB.*unknown.*non-IndexedDB.*successor/isu);
	assert.match(documentation, /project-publication-capacity-accounting.*not an exact IndexedDB byte count.*structured-clone.*point-in-time.*no reservation.*direct store-facade saves.*project-row capacity check.*route-specific controls.*memory fallback.*desktop.*local IndexedDB shadow.*appData.*heap.*RSS/isu);
	const roadmap = await readFile(roadmapUrl, 'utf8');
	assert.match(roadmap, /canonical project-publication admission.*`AudioEditorProjectStore\.saveProject`.*non-raiseable 256 MiB.*queued autosave.*explicit flush.*terminal flush.*twice.*gross proxy.*ceil\(10%\).*known insufficient IndexedDB.*non-IndexedDB.*proceeds.*successor/isu);
	assert.match(roadmap, /not an exact IndexedDB byte count.*structured-clone.*heap.*RSS.*point-in-time.*no reservation.*direct\s+store-facade saves.*project-row capacity check.*route-specific controls.*memory fallback.*desktop.*local\s+IndexedDB shadow.*appData/isu);
});

test('desktop save admission evidence pins product-wide capacity before staging', async () => {
	const matrix = await readMatrix();
	const desktopWrite = matrix.risks.find(({ id }) => id === 'desktop-write-path-capabilities');
	assert.ok(desktopWrite);
	assert.equal(desktopWrite.status, 'partial');
	assert.equal(desktopWrite.releaseDisposition, 'conditional');

	const admission = desktopWrite.currentControls.find(
		({ id }) => id === 'aggregate-save-capacity-and-disk-admission',
	);
	assert.ok(admission);
	assert.match(
		admission.summary,
		/16 outstanding product-wide targets.*4 pending or live sessions.*65 GiB per-save and aggregate admitted bytes.*synchronously.*before the first await.*lower-only.*bigint `statfs`.*available.*before staging open.*point-in-time.*not an operating-system reservation.*cleanup failure.*charged/iu,
	);
	for (const path of [
		'desktop/constants.js',
		'desktop/preload.mjs',
		'desktop/save-targets.js',
		'tests/desktop-save-capacity.test.js',
		'tests/desktop-protocol.test.js',
	]) assert.ok(admission.evidence.some((item) => item.path === path));

	assert.equal(desktopWrite.residualRisks.some(
		({ id }) => id === 'write-capacity-and-disk-admission',
	), false);
	assert.ok(desktopWrite.residualRisks.some(
		({ id }) => id === 'in-flight-write-cancellation',
	));

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(
		documentation,
		/desktop-write-path-capabilities.*partial.*16 outstanding product-wide save targets.*4 pending or live save sessions.*65 GiB per-save and aggregate admitted bytes.*synchronously before the first await.*lower-only.*BigInt `statfs`.*before staging open.*point-in-time.*not an operating-system reservation.*cleanup failure.*charged.*active chunk.*parent-directory/isu,
	);

	const roadmap = await readFile(roadmapUrl, 'utf8');
	assert.match(
		roadmap,
		/Electron Enhanced — In progress:.*16 outstanding product-wide save targets.*4\s+pending or live save sessions.*65 GiB per-save and aggregate admitted\s+bytes.*BigInt `statfs`.*before staging open.*point-in-time.*not an operating-system reservation.*cleanup\s+failure.*charged/isu,
	);
});

async function readMatrix() {
	return JSON.parse(await readFile(matrixUrl, 'utf8'));
}
