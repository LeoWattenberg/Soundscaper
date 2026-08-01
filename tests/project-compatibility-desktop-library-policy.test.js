/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);

test('shared desktop project policy pins the current editor handoff boundary', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-desktop-project-catalog-commit');
	const mediaAdmission = policy.rules.find(
		({ id }) => id === 'current-desktop-recipient-media-admission',
	);

	assert.ok(rule);
	assert.deepEqual(rule.evidence, [
		'desktop/project-library-api.ts',
		'desktop/project-library-contract.ts',
		'desktop/project-library-database.ts',
		'desktop/project-library-file-inventory.ts',
		'desktop/project-library-stage-inventory.ts',
		'desktop/project-library.ts',
		'desktop/project-library-projects.ts',
		'desktop/project-library-reclamation.ts',
		'desktop/project-library-host.ts',
		'desktop/project-library-editor-service.ts',
		'desktop/project-library-ipc.js',
		'desktop/preload.mjs',
		'desktop/main.mjs',
		'desktop/desktop-smoke.js',
		'scripts/lib/desktop-project-library-handoff-smoke.mjs',
		'scripts/desktop-project-library-handoff-smoke.mjs',
		'src/common/editor/scape-project-document.ts',
		'src/common/editor/scape-project-json-preflight.ts',
		'src/common/editor/persisted-audio-effect-validation.ts',
		'src/common/editor/project-v9-document-validation.ts',
		'src/common/editor/project-v9-media-validation.ts',
		'src/common/editor/project-v9-validation-budget.ts',
		'src/common/editor/project-v9-validation-primitives.ts',
		'src/common/editor/project-v9-validation.ts',
		'src/common/editor/project-v9.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage.js',
		'src/common/editor/app.js',
		'tests/audio-editor-scape-project-document.test.ts',
		'tests/audio-editor-project-v9-validation.test.ts',
		'tests/persisted-audio-effect-validation.test.ts',
		'tests/desktop-project-library-file-inventory.test.ts',
		'tests/desktop-project-library-projects.test.ts',
		'tests/desktop-project-library-reclamation.test.ts',
		'tests/desktop-project-library-reclamation-progress.test.ts',
		'tests/desktop-project-library-stage-reclamation.test.ts',
		'tests/desktop-project-library-handoff.test.ts',
		'tests/desktop-project-library-editor-service.test.ts',
		'tests/desktop-project-library-ipc.test.js',
		'tests/audio-editor-desktop-shared-project-repository.test.ts',
		'tests/desktop-project-library-editor-handoff.test.ts',
		'tests/desktop-project-library-packaging.test.js',
		'tests/desktop-smoke-probe.test.js',
		'tests/desktop-project-library-handoff-smoke.test.js',
		'tests/desktop-project-library-handoff-workflow.test.js',
		'.github/workflows/desktop-preview.yml',
	]);
	assert.match(
		rule.requiredOutcome,
		/bounded pathless main-owned service.*validates.*maintained exact-current-schema project domain.*before host staging.*catalog publication.*before returning.*shared read document.*renderer repeats validation.*defense in depth.*without receiving filesystem paths.*catalog entry IDs.*lease capabilities/iu,
	);
	assert.match(
		rule.requiredOutcome,
		/main-owned startup reclamation.*preserves every current or recoverable catalog reference.*retires abandoned registered stage attempts.*without removing live writer state.*fair progress.*shared bounded budget/iu,
	);
	assert.match(
		rule.currentBehavior,
		/fresh filesystem library scope v2.*ignores rather than migrates.*prior shared v1 scope.*schema 1 database.*v2 path.*rejected instead of implicitly migrated.*metadata schema 2.*separate opaque library entry ID.*project identity.*exact schema 9.*project revision.*byte length.*SHA-256.*immutable revision-and-digest path/iu,
	);
	assert.match(
		rule.currentBehavior,
		/main-only.*canonicalizes.*bounded tagged-binary Scape codec.*non-raiseable 256 MiB.*root schema, identity, title, and revision.*reserves.*unique random attempt.*lease.*fencing-token.*authoritative project and stage inventories.*same immediate transaction.*before exclusive stage creation.*exact-lease cleanup.*acknowledged.*exclusive-open failure.*registration.*without unlinking.*error after exclusive creation.*registered random stage.*lost-lease or failed cleanup.*registration.*takeover.*successful materialization.*exact metadata and stage paths.*lease ID.*fencing token.*atomically renames.*marks the canonical row materialized.*removes the stage row.*verifies.*catalog descriptor.*every catalog reference.*exact \+1 catalog revision.*fenced metadata journal/iu,
	);
	assert.match(
		rule.currentBehavior,
		/main-owned identity service.*shared strict exact-V9 maintained-persistence-domain validator.*before permitting host staging.*catalog publication.*renderer commit.*validates.*loaded commit result.*stored project again.*before returning.*canonical document.*strictly checks core project, document, media, and graph structures.*without loading legacy migrations.*executable effect and worker runtimes.*all audio effects.*cloneable.*generic effect identity, enabled, and parameter structure.*type-specific semantic checks.*missing-effect compatibility metadata.*parametric EQ.*other first- and third-party effect payload semantics.*not gated/iu,
	);
	assert.match(
		rule.currentBehavior,
		/(?:every serialized project.*preflight|before JSON\.parse.*every schema).*101,536 (?:JSON )?values.*depth 130/iu,
	);
	assert.match(
		rule.currentBehavior,
		/each exact-V9 decoded codec traversal and maintained-domain validation phase.*independently capped.*100,000 nodes.*depth 128/iu,
	);
	assert.match(
		rule.currentBehavior,
		/(?:renderer input refusal.*precedes host mutation|over-budget renderer input.*rejects before host commit).*staging.*loaded commit result.*(?:refused|rejected).*before (?:the )?renderer response.*(?:host publication may already have completed|after the host has already published)/iu,
	);
	assert.match(
		rule.currentBehavior,
		/canonical JSON-derived graphs.*ordinary direct objects.*reject accessors.*toJSON hooks.*method-shadowed arrays.*hidden or symbol data.*cycles.*exotic containers.*non-JSON scalars.*without invoking.*hostile proxies.*prototype-polluted or exotic injected graphs.*outside.*code-safety claim/iu,
	);
	assert.match(
		rule.currentBehavior,
		/lexical.*codec.*validator.*serialization phases.*per-phase shape.*not an aggregate work.*CPU.*elapsed-time.*allocation-amplification.*cancellation.*resident-memory/iu,
	);
	assert.match(
		rule.currentBehavior,
		/host serializes commits.*renews.*draining admitted work.*identity service.*owner-scoped IPC.*bounded project summaries.*canonical documents.*renderer-owner revocation.*fences new work.*drains admitted operations/iu,
	);
	assert.match(
		rule.currentBehavior,
		/after journal recovery.*before host exposure.*authoritative project and stage inventories.*monotonic row IDs.*independent cycle high-waters.*both cursors.*alternating schedule.*100,000 total rows.*64-row batches.*immediate SQLite writer fences.*exact lease checks.*current exact-lease stage.*live.*stale registered regular stage.*removed.*missing attempt retires.*non-regular target.*non-direct parent.*untouched and inventoried.*canonical rows.*outstanding stage.*ineligible.*rescan flag.*already-scanned parents.*portable case-folded reachability.*current catalog.*both sides.*pending recovery journal.*deterministic.*quarantine.*unregistered stage-looking.*canonical.*forged quarantine.*foreign.*do not consume.*budget.*untouched.*100,001-row.*successive bounded passes.*later inserts.*next high-water cycle.*low- and mixed-cap.*canonical rescanning.*crash-left quarantine.*symlinked project root.*corrupt metadata.*managed-media.*untouched/iu,
	);
	assert.match(
		rule.currentBehavior,
		/renderer repository.*repeats.*maintained-persistence-domain exact-V9 validation.*defense in depth.*before local mutation.*product-local shadow.*shared latest document.*authoritative.*fails closed.*incomplete desktop bridge/iu,
	);
	assert.match(
		rule.currentBehavior,
		/composed source-free editor fixture.*creates and autosaves in Soundscaper.*same identity and revision.*fresh Framescaper-local store.*next revision in Framescaper.*media catalog remains empty/iu,
	);
	assert.match(
		rule.currentBehavior,
		/dedicated Linux x64 CI.*two separate unpacked packages.*Soundscaper.*Framescaper.*Soundscaper.*share(?:d)? only.*isolated appData.*separate product profiles.*reuses.*Soundscaper profile.*renderer.*ready.*pathless preload IPC.*exact[- ]SHA-256.*source-free.*schema 9.*revisions 1, 2, and 3.*summary.*main-only catalog row.*clean recovery.*no stale takeover.*strictly higher fencing tokens.*increasing catalog revisions.*preferred product.*process exit.*lease release/iu,
	);
	assert.match(
		rule.currentBehavior,
		/closes only the generic packaged source-free preload\/IPC\/multi-process\/executable lifecycle gap.*not.*packaged controller autosave or tab activation.*source-bearing bytes, playback, or managed media.*concurrent opens.*crash or stale takeover.*interruption or power loss.*path identity.*installers or file associations.*Windows, macOS, or ARM64.*third-party.*gating.*legacy Soundscaper.*migration/iu,
	);

	const [documentation, roadmap] = await Promise.all([
		readFile(documentationUrl, 'utf8'),
		readFile(roadmapUrl, 'utf8'),
	]);
	assert.match(documentation, /Shared desktop current-schema persistence/u);
	assert.match(
		documentation,
		/fresh filesystem library scope `v2`/iu,
	);
	assert.match(
		documentation,
		/fresh filesystem library scope `v2`.*ignores rather than migrates.*prior\s+shared `v1` scope.*at the `v2` path.*SQLite database schema 2 rejects schema 1.*implicitly migrating/isu,
	);
	assert.match(
		documentation,
		/metadata\s+schema\s+2.*separate\s+opaque\s+library\s+entry\s+ID.*exact\s+schema\s+9.*project\s+revision.*byte\s+length.*SHA-256.*immutable\s+revision-and-digest\s+path/isu,
	);
	assert.match(
		documentation,
		/main process.*bounded tagged-binary Scape codec.*256 MiB.*low-level store.*root schema, identity,\s+title, and revision.*main-owned identity service.*strict\s+exact-V9 maintained-persistence-domain validator.*before\s+permitting host staging.*catalog publication.*renderer commit.*validates the loaded commit result.*stored project again.*before\s+returning.*canonical document/isu,
	);
	assert.match(
		documentation,
		/validator strictly checks core project,\s+document, media, and graph structures.*all\s+audio effects.*cloneable.*generic effect identity, enabled,\s+and parameter structure.*type-specific semantic checks.*missing-effect compatibility\s+metadata.*parametric EQ.*other first- and third-party effect payload semantics.*not gated/isu,
	);
	assert.match(
		documentation,
		/store reserves.*unique random attempt.*authoritative project\s+and stage inventories.*one transaction.*exclusively creates.*exact-lease cleanup.*acknowledged.*exclusive-open\s+failure.*registration.*without unlinking.*error\s+after exclusive creation.*registered random stage.*lost-lease or failed cleanup.*registration.*takeover.*successful\s+materialization.*exact metadata and stage paths.*lease ID.*fencing token.*atomic rename.*materialized.*removes the stage row.*every catalog reference.*exact \+1\s+catalog revision.*fenced\s+journal/isu,
	);
	assert.match(
		documentation,
		/(?:every serialized project.*preflight|before `?JSON\.parse`?.*every schema).*101,536 (?:JSON )?values.*depth 130/isu,
	);
	assert.match(
		documentation,
		/each exact-V9 decoded codec traversal and maintained-domain\s+validation phase.*independently capped.*100,000 nodes.*depth 128/isu,
	);
	assert.match(
		documentation,
		/renderer\s+input refusal.*precedes host mutation or staging.*loaded commit result.*refused.*before the renderer response.*host publication may already\s+have completed/isu,
	);
	assert.match(
		documentation,
		/canonical JSON-derived graphs.*ordinary\s+direct objects.*reject accessors.*`?toJSON`? hooks.*method-shadowed arrays.*hidden\s+or symbol data.*cycles.*exotic containers.*non-JSON scalars.*without\s+invoking.*hostile proxies.*prototype-polluted or\s+exotic\s+injected graphs.*outside.*code-safety claim/isu,
	);
	assert.match(
		documentation,
		/lexical.*codec.*validator.*serialization phases.*per-phase shape.*not an aggregate work.*CPU.*elapsed-time.*allocation-amplification.*cancellation.*resident-memory/isu,
	);
	assert.match(
		documentation,
		/after journal recovery.*before the host is exposed.*authoritative project and stage inventories.*monotonic\s+row IDs.*independent cycle high-waters.*both cursors.*alternating schedule.*100,000 total rows.*complete/isu,
	);
	assert.match(
		documentation,
		/immediate SQLite writer transaction.*exact\s+live lease.*before and after filesystem work.*current exact-lease stage.*live.*stale registered regular stage.*removed.*missing attempt retires.*non-regular target.*non-direct parent.*untouched and inventoried.*canonical rows.*current lease.*outstanding\s+stage.*ineligible.*rescan flag.*restarts the\s+canonical high-water.*portable case-folded reachability.*current catalog.*previous and next snapshots.*pending prepared or\s+committed journal/isu,
	);
	assert.match(
		documentation,
		/deterministic noncatalogable.*quarantine.*unregistered stage-looking.*canonical.*forged\s+quarantine.*do not consume.*budget.*100,001-row.*successive bounded passes.*later inserts.*next cycle.*higher fencing\s+token.*yields between batches/isu,
	);
	assert.match(
		documentation,
		/static\s+symlinked\s+project\s+root.*corrupt\s+catalog\s+or\s+journal\s+metadata.*malformed\s+names.*non-regular or symlinked entries.*managed media.*untouched.*host snapshot.*tested\s+reclamation\s+failure\s+during\s+startup.*releases\s+its\s+still-owned\s+lease.*cleanup\s+failure.*reported/isu,
	);
	assert.match(
		documentation,
		/identity service.*owner-scoped IPC.*bounded project\s+summaries.*canonical documents.*renderer loss.*fence new work.*drain operations/isu,
	);
	assert.match(
		documentation,
		/renderer repository.*repeats.*maintained-persistence-domain exact-V9\s+validation.*defense in depth.*before\s+local mutation.*shared catalog is authoritative.*product-local IndexedDB.*remote commit failure.*retryable local shadow.*incomplete shared-project bridge.*fails closed/isu,
	);
	assert.match(
		documentation,
		/composed source-free editor fixture.*creates and autosaves in Soundscaper.*same identity and\s+revision.*fresh Framescaper-local store.*next revision in\s+Framescaper.*empty shared media catalog/isu,
	);
	assert.match(
		documentation,
		/dedicated Linux x64 CI.*two separate unpacked packages.*Soundscaper.*Framescaper.*Soundscaper.*isolated appData.*separate product profiles.*reuses.*Soundscaper profile.*renderer[- ]ready.*pathless\s+preload IPC.*exact[- ]SHA-256.*source-free.*schema 9.*revisions 1, 2, and 3.*summary.*main-only catalog row.*clean recovery.*no stale\s+takeover.*higher fencing tokens?.*increasing catalog revisions?.*preferred product.*process exit.*lease\s+release/isu,
	);
	assert.match(
		documentation,
		/closes only the generic packaged\s+source-free preload\/IPC\/multi-process\/executable lifecycle gap.*does not\s+qualify packaged controller autosave or tab activation.*source-bearing bytes,\s+playback, or managed media.*concurrent opens.*crash or stale takeover.*interruption or power loss.*path identity.*installers or file associations.*Windows, macOS, or ARM64.*third-party.*gating.*legacy Soundscaper.*migration/isu,
	);
	assert.match(
		documentation,
		/existing V1–V8 raw-project migrations remain maintained.*compatibility\s+beyond those retained raw-document migration paths.*prior shared\s+`?v1`?\s+scope.*product-private Soundscaper libraries.*not a\s+current priority.*milestone prerequisite.*Audacity.*separate compatibility\s+boundary/isu,
	);
	assert.doesNotMatch(documentation, /guaranteed continuation after an incomplete|incomplete 100,000-entry inventory/iu);
	assert.doesNotMatch(documentation, /abandoned stage-file cleanup.*remain(?:s)? (?:open|outside)/iu);
	assert.match(
		roadmap,
		/dedicated Linux x64.*two separate unpacked.*source-free.*Soundscaper.*Framescaper.*Soundscaper.*packaged executables.*pathless preload IPC.*qualifies.*packaged source-free preload\/IPC\/multi-process\/executable.*Linux x64 only/isu,
	);
	assert.match(
		roadmap,
		/Simultaneous opens.*serialize through the shared\s+lease.*Linux x64.*source-free.*qualified.*remaining.*platform.*fault.*matrix.*open/isu,
	);

	assert.ok(mediaAdmission);
	assert.equal(mediaAdmission.status, 'implemented');
	assert.deepEqual(mediaAdmission.evidence, [
		'src/common/editor/controller/project-bootstrap-service.ts',
		'src/common/editor/retention.js',
		'src/common/editor/scape-abort.ts',
		'src/common/editor/scape-archive-envelope.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/scape-expanded-byte-budget.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage/desktop-shared-project-source-availability.ts',
		'src/common/editor/storage/media-asset-digest-backfill.ts',
		'src/common/editor/storage/media-content-digest.ts',
		'src/common/editor/storage/project-repository.ts',
		'src/common/editor/storage/retention-repository.ts',
		'src/common/editor/storage/source-read-repository.ts',
		'src/common/editor/storage.js',
		'src/common/editor/app.js',
		'tests/audio-editor-desktop-shared-project-mutation-serialization.test.ts',
		'tests/audio-editor-desktop-shared-project-repository.test.ts',
		'tests/audio-editor-desktop-shared-project-source-availability-integration.test.ts',
		'tests/audio-editor-desktop-shared-project-source-availability.test.ts',
		'tests/audio-editor-project-bootstrap-service.test.ts',
		'tests/desktop-project-library-editor-handoff.test.ts',
	]);
	assert.match(
		mediaAdmission.requiredOutcome,
		/authoritative latest exact-schema-9 desktop shared-project load.*reachable source references.*bounded sequential recipient-local readability admission.*before local shadow mutation and activation.*fail closed.*without replacing.*latest local shadow.*adding the remote revision.*recipient-local history/iu,
	);
	assert.match(
		mediaAdmission.currentBehavior,
		/4,094 reachable timeline, Project Bin, and fallback source references.*pre-existing latest recipient-local exact-schema-9 snapshot.*same project.*logical source identity, kind, storage key, MIME type.*frame and sample geometry.*compatible same-kind.*one physical storage key.*verified once.*conflicting bindings reject/iu,
	);
	assert.match(
		mediaAdmission.currentBehavior,
		/65,536 PCM chunks.*cumulative 64 GiB budget.*canonical audio archive bytes.*four framing bytes per chunk.*recipient-local video metadata sizes.*selected source or media metadata before and after.*fully consumes.*ordered Float32Array PCM.*exact chunk, channel, and frame geometry.*matching supplied index or frame fields.*trusted recipient-local SHA-256.*required before.*body read.*SHA-256.*genuine Blob.*4 MiB.*must match.*legacy PCM-on-read migration and media-digest backfill.*disabled.*digestless legacy video.*fails closed.*ordinary local load.*trusted digest backfill.*before retry.*audio.*not authenticated against a prior content digest.*failure raised by this repository admission.*before local shadow save or activation.*rendered-fallback-declaration digest check.*follows repository shadowing.*source-free.*no source or media I\/O/iu,
	);
	assert.match(
		mediaAdmission.currentBehavior,
		/bootstrap lifetime signal.*exact cancellation reason.*non-cooperative provider work.*continue after rejection.*shadow save.*not abort-atomic.*serializes latest load, save, and delete.*per project.*storage keys.*mixed audio and video.*bound by the latest local snapshot.*source-free success.*missing PCM.*pre-existing revision/iu,
	);
	assert.match(
		mediaAdmission.currentBehavior,
		/bounded sequential admission-time readability check.*not an atomic snapshot.*selected metadata.*not transactionally bound.*same-metadata replacement.*can go undetected.*replacement or deletion afterward.*not fenced.*separate repository instances or processes.*fresh recipient lacks both.*prerequisite local descriptor snapshot.*automatic acquisition.*copy, relink, managed storage.*codec playback.*packaged handoff/iu,
	);
	assert.match(
		mediaAdmission.currentBehavior,
		/existing V1-V8 raw-project migrations remain maintained.*compatibility beyond those retained raw-document migration paths.*prior shared v1 scope.*product-private Soundscaper libraries.*unsupported.*not a current priority.*Audacity.*separate.*third-party effect semantics.*not gated/iu,
	);
	assert.match(
		documentation,
		/latest exact-schema-9 source-bearing\s+shared load.*4,094.*pre-existing latest recipient-local\s+exact-schema-9 snapshot.*same project.*65,536.*cumulative 64 GiB budget.*recipient-local video metadata sizes.*metadata before and\s+after.*ordered\s+`?Float32Array`? channel\/frame geometry.*chunk index or\s+frame count.*trusted recipient-local\s+SHA-256.*before.*body.*genuine exact-size\s+video `?Blob`?.*SHA-256.*4 MiB.*must match.*legacy PCM-on-read\s+migration.*media-digest backfill.*disabled.*digestless legacy video.*ordinary local.*trusted digest backfill.*before retry.*failure raised by\s+this repository.*local shadow.*revision history.*activation.*later.*rendered-fallback-declaration digest check.*repository shadowing/isu,
	);
	assert.match(
		documentation,
		/source-free latest\s+loads.*zero source or media I\/O.*bootstrap.*lifetime\s+signal.*latest load, save, and\s+delete serialized.*per project.*storage\s+keys.*audio and video bytes already present.*pre-existing latest local\s+snapshot.*missing-recipient-PCM.*pre-existing revision/isu,
	);
	assert.match(
		documentation,
		/bounded sequential admission-time readability check.*not an\s+atomic snapshot.*media transfer.*publisher authentication.*durable byte\s+lease.*selected metadata.*not transactionally bound.*same-metadata replacement.*undetected.*replacement or\s+deletion afterward.*not fenced.*non-cooperative providers.*cancellation.*shadow\s+save.*not abort-atomic.*separate repository instances and\s+processes.*not serialized/isu,
	);
	assert.match(
		documentation,
		/fresh recipient lacks both the prerequisite\s+local descriptor snapshot and automatic acquisition.*copy, consolidation,\s+relink, managed storage, codec playback.*packaged.*source-bearing\s+handoff/isu,
	);
});
