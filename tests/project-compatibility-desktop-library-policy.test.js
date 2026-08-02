/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const documentationUrl = new URL('../docs/project-compatibility.md', import.meta.url);

test('shared desktop project policy pins the current editor handoff boundary', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-desktop-project-catalog-commit');
	const mediaAdmission = policy.rules.find(
		({ id }) => id === 'current-desktop-recipient-media-admission',
	);
	const managedHandoff = policy.rules.find(
		({ id }) => id === 'current-desktop-managed-mixed-media-handoff',
	);
	const linkedVideoOriginal = policy.rules.find(
		({ id }) => id === 'current-desktop-linked-retained-video-original',
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
		'desktop/project-library-editor-media-service.ts',
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
		'tests/desktop-project-library-editor-media-service.test.ts',
		'tests/desktop-project-library-editor-media-lifecycle.test.ts',
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
		/fresh filesystem library scope v2.*ignores rather than migrates.*prior shared v1 scope.*schema 3 database.*v2 path.*rejects schemas 1 and 2.*implicitly migrating.*adopting.*backfilling.*metadata schema 2.*separate opaque library entry ID.*project identity.*exact schema 9.*project revision.*byte length.*SHA-256.*immutable revision-and-digest path/iu,
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
		/host serializes commits.*renews.*draining admitted work.*identity service.*owner-scoped IPC.*bounded project summaries.*canonical documents and bundles.*managed-source descriptors and chunks.*canonical PCM.*retained original video.*four active uploads.*four active reads.*across the bridge service.*owner revocation.*fences new work.*aborts owned uploads.*drains admitted operations/iu,
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

	const documentation = await readFile(documentationUrl, 'utf8');
	assert.match(documentation, /Shared desktop current-schema persistence/u);
	assert.match(
		documentation,
		/fresh filesystem library scope `v2`/iu,
	);
	assert.match(
		documentation,
		/fresh filesystem library scope `v2`.*ignores rather than migrates.*prior\s+shared `v1` scope.*at the `v2` path.*SQLite database schema 3 rejects schemas 1.*and 2.*implicitly migrating.*adopting.*backfilling/isu,
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
		/identity service.*owner-scoped IPC.*bounded project\s+summaries.*canonical documents and bundles.*managed-source descriptors and chunks.*renderer loss.*fence new\s+work.*abort.*managed-source upload sessions.*drain operations.*256 MiB.*4 KiB.*10,000-summary.*64 GiB.*4 MiB.*four.*upload sessions.*four.*managed-source reads.*across the bridge service.*capacity remains charged.*publication or.*abort settles.*disposal waits.*finishing publications.*Neither\s+layer exposes a path/isu,
	);
	assert.match(
		documentation,
		/renderer repository.*repeats.*maintained-persistence-domain exact-V9\s+validation.*defense in depth.*before\s+local mutation.*shared catalog is authoritative.*product-local IndexedDB.*remote commit failure.*retryable local shadow.*incomplete shared-project bridge.*fails closed/isu,
	);
	assert.match(
		documentation,
		/ordinary project\s+saves.*?canonical document.*?do not copy source bytes.*?explicit managed-handoff path.*?canonical PCM and retained\s+original\s+video.*?4,094\s+logical\s+sources.*?deduplicates compatible\s+same-kind physical\s+bindings.*?conflicting geometry.*?aggregate 64 GiB.*?canonical audio archive bytes.*?original-video bodies.*?65,536-PCM-chunk/isu,
	);
	assert.match(
		documentation,
		/before the first\s+source-body read or bridge body transfer.*canonical PCM.*two full\s+digesting source reads.*retained original video.*trusted.*SHA-256 metadata.*two full body-digest passes.*4 MiB windows.*metadata revalidation.*binding is absent.*second.*pass.*4-MiB chunks.*pathless bridge/isu,
	);
	assert.match(
		documentation,
		/four active uploads.*reachable source kind, identity,\s+and geometry.*exact current project revision.*derives the catalog\s+document SHA-256 itself rather than accepting it from the renderer.*encoding, project identity, revision,\s+document digest, and storage-key\/media geometry/isu,
	);
	assert.match(
		documentation,
		/exact\s+revision-and-document-digest check.*same-revision document variant.*neither advertised.*nor accepted as already present/isu,
	);
	assert.match(
		documentation,
		/exact-present reuse.*byte length and SHA-256.*reverifies the body/isu,
	);
	assert.match(
		documentation,
		/new\s+upload.*same digest.*current binding is absent.*main.*not the renderer.*same-kind.*donor.*byte length and SHA-256.*fully\s+verifies.*random same-directory hard-link stage.*verifies.*promotes it without overwriting.*syncs.*distinct\s+revision-bound descriptor.*unsupported linking.*missing or corrupt donor.*exhausted link count.*bounded upload fallback.*operational or\s+access failures.*fail closed/isu,
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
	assert.ok(managedHandoff);
	assert.equal(managedHandoff.status, 'implemented');
	assert.deepEqual(managedHandoff.evidence, [
		'desktop/project-library-editor-media-service.ts',
		'desktop/project-library-media-binding.ts',
		'desktop/project-library-media-capacity.ts',
		'desktop/project-library-media-inventory-reclamation.ts',
		'desktop/project-library-media-inventory-schema.ts',
		'desktop/project-library-media-inventory-store.ts',
		'desktop/project-library-media-inventory.ts',
		'desktop/project-library-media-reclamation.ts',
		'desktop/project-library-media-reuse.ts',
		'desktop/project-library-media.ts',
		'desktop/project-library-host.ts',
		'desktop/project-library-projects.ts',
		'desktop/project-library-ipc.js',
		'desktop/preload.mjs',
		'desktop/main.mjs',
		'src/common/editor/controller/project-admin-service.ts',
		'src/common/editor/storage/desktop-shared-project-media-acquisition.ts',
		'src/common/editor/storage/desktop-shared-project-media-contract.ts',
		'src/common/editor/storage/desktop-shared-project-media-sender.ts',
		'src/common/editor/storage/desktop-shared-project-media-sources.ts',
		'src/common/editor/storage/desktop-shared-project-media-transfer.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage/media-asset-owned-publication.ts',
		'src/common/editor/storage/media-asset-write-contract.ts',
		'src/common/editor/storage/media-asset-write-repository.ts',
		'src/common/editor/storage/media-content-digest.ts',
		'src/common/editor/storage/source-record-repository.ts',
		'src/common/editor/storage/source-repository.ts',
		'src/common/editor/storage/source-write-repository.ts',
		'src/common/editor/storage.js',
		'tests/audio-editor-project-admin-service.test.ts',
		'tests/desktop-project-library-host.test.ts',
		'tests/desktop-project-library-ipc.test.js',
		'tests/desktop-project-library-editor-media-service.test.ts',
		'tests/desktop-project-library-editor-media-lifecycle.test.ts',
		'tests/desktop-project-library-editor-media-freshness.test.ts',
		'tests/desktop-project-library-editor-media-reuse-fallback.test.ts',
		'tests/desktop-project-library-editor-video-media-service.test.ts',
		'tests/desktop-project-library-media-capacity.test.ts',
		'tests/desktop-project-library-media-inventory-store.test.ts',
		'tests/desktop-project-library-media-inventory.test.ts',
		'tests/desktop-project-library-media-reclamation.test.ts',
		'tests/desktop-project-library-media-reuse.test.ts',
		'tests/desktop-project-library-media.test.ts',
		'tests/desktop-project-library-video-media.test.ts',
		'tests/audio-editor-desktop-shared-project-media-sender-video.test.ts',
		'tests/audio-editor-desktop-shared-project-media-transfer.test.ts',
		'tests/audio-editor-desktop-shared-project-media-transfer-budget.test.ts',
		'tests/audio-editor-desktop-shared-project-media-transfer-ownership.test.ts',
		'tests/audio-editor-desktop-shared-project-mixed-media-acquisition.test.ts',
		'tests/audio-editor-desktop-shared-project-repository-handoff.test.ts',
		'tests/audio-editor-media-asset-ownership.test.ts',
		'tests/audio-editor-source-record-ownership.test.ts',
		'tests/audio-editor-source-write-cancellation.test.ts',
		'tests/desktop-project-library-managed-audio-handoff.test.ts',
		'tests/desktop-project-library-audio-rendered-fallback-handoff.test.ts',
		'tests/desktop-project-library-video-rendered-fallback-handoff.test.ts',
		'tests/desktop-project-library-mixed-media-roundtrip.test.ts',
		'tests/desktop-project-library-packaging.test.js',
	]);
	assert.match(
		managedHandoff.requiredOutcome,
		/explicit post-flush handoff.*maintained exact-current-schema desktop project.*bounded canonical PCM and retained original-video bodies.*pathless IPC.*sender and fresh-recipient admission.*logical-source, canonical-byte, and PCM-chunk budgets.*before.*source-body read.*bridge body transfer.*recipient write.*absent shared-library binding.*prospective catalog row and metadata.*aggregate in-process.*bytes.*destination filesystem capacity.*before.*hard-link, staging, or body work.*main-derived exact catalog project revision.*canonical document SHA-256.*identity, kind, storage key, exact byte length and digest.*canonical audio byte geometry.*atomic if-absent.*records and payload tokens it owns.*same-kind, same-content return handoff.*distinct revision-bound descriptor.*immutable body.*bounded upload fallback/iu,
	);
	assert.match(
		managedHandoff.currentBehavior,
		/ordinary shared-project saves remain document-only.*4,094 reachable logical sources.*deduplicates compatible same-kind physical bindings.*rejects conflicting geometry.*aggregate 64 GiB.*canonical audio archive bytes.*retained original-video bodies.*65,536-PCM-chunk ceiling.*before.*source-body read.*bridge body transfer.*canonical PCM.*two full digesting reads.*retained original video.*trusted exact-size SHA-256 metadata.*two full body-digest passes.*4-MiB windows.*metadata revalidation.*binding is absent.*second audio or video pass.*4-MiB pathless chunks/isu,
	);
	assert.match(
		managedHandoff.currentBehavior,
		/four active uploads.*four active reads.*across the bridge service.*owner-bound.*authorization and revocation.*loads the exact catalog project.*reachable source kind, identity, and geometry.*derives rather than accepts from the renderer.*catalog document SHA-256.*encoding, project ID, exact revision, exact document digest, and storage-key\/media geometry.*serialized host.*exact revision and document-digest checks.*older revision.*same-revision document variant.*neither advertised nor accepted as present.*exact-present reuse.*byte length.*SHA-256.*reverifies.*synced.*atomically renamed.*before catalog publication/isu,
	);
	assert.match(
		managedHandoff.currentBehavior,
		/current binding is absent.*main.*not the renderer.*canonical same-kind catalog donors.*byte length and SHA-256.*fully verifies.*random same-directory hard-link stage.*verifies the linked body.*without overwriting.*winning target.*syncs.*distinct revision-bound descriptor.*unsupported linking.*missing or corrupt donors.*exhausted link counts.*bounded upload fallback.*operational or access failures.*fail closed.*renderer path or donor/isu,
	);
	assert.match(
		managedHandoff.currentBehavior,
		/each absent audio or video binding.*synchronously reserves.*prospective catalog row.*metadata bytes.*other in-flight reservations.*50,000-row.*4 MiB.*64 GiB.*aggregate declared body-byte.*before.*filesystem query, hard-link attempt, directory or stage creation, or body consumption.*BigInt statfs.*managed-media destination.*available blocks.*aggregate in-flight declared bytes.*held.*descriptor publication settles.*released idempotently.*failure and cancellation.*publication.*revalidates.*current catalog.*exact-present retry.*bypasses.*new reservation and statfs.*reverifies.*existing body/isu,
	);
	assert.match(
		managedHandoff.currentBehavior,
		/after point-in-time capacity admission.*before directory or stage creation, hard-link work, or body consumption.*exact canonical row.*random upload or reuse stage.*schema-3 authoritative inventory.*descriptor provenance.*live lease and fencing token.*promotion.*registered regular stage.*atomically renames.*directory-syncs.*materialized.*removes the stage row.*persisted before-and-after lease checks.*catalog preparation.*exact materialized or published row.*catalog commit.*published atomically.*metadata.*catalog failure.*reverified.*without consuming another offered stream/isu,
	);
	assert.match(
		managedHandoff.currentBehavior,
		/after metadata-journal recovery and project-file reclamation.*startup logically retires only tracked catalog descriptors.*project ID, revision, and document digest.*preserving unmanaged rows.*normal journal.*persisted stage and canonical high-water batches.*100,000 rows.*64-row.*lease-fenced transactions.*registered regular stages.*deterministic quarantine.*current catalog rows.*protected.*non-regular, symlinked, unregistered, legacy, and foreign paths.*untouched.*restart.*canonical cursor.*snapshot counts.*startup failure.*releases the lease/isu,
	);
	assert.match(
		managedHandoff.currentBehavior,
		/fresh-recipient acquisition.*audio.*staged source writer.*video.*owned media-asset writer.*exact bounded reads.*descriptor identity, kind and storage key.*byte length.*SHA-256.*canonical audio byte geometry.*atomic if-absent.*retained original video.*opaque.*not decoded or probed for media geometry.*rolls back.*reverse order.*exact acquisition-owned.*source-token, path, or media-chunk payload.*preserving.*concurrent replacement.*exact authoritative shadow is durable.*retains.*acquired managed media/isu,
	);
	assert.match(
		managedHandoff.currentBehavior,
		/composed headless.*Soundscaper-to-fresh-Framescaper-to-Soundscaper.*empty missing-source set.*exact audio engine buffers.*video blob URL bytes.*transport play.*edit.*save.*same-inode.*canonical PCM and original-video bodies.*distinct revision-bound bindings.*without renderer body chunks.*original Soundscaper profile.*exact returned document.*product-local revision history.*zero bridge body I\/O.*no duplicate local media/isu,
	);
	assert.match(
		managedHandoff.currentBehavior,
		/narrower composed fixture.*canonical original PCM.*exact-schema-9 first-party audio whole-mix fallback.*only by its feature requirement.*fresh Framescaper.*both absent bodies.*exact canonical shadow.*read-only controller.*transient fallback.*exact samples.*transfer acquisition.*managed descriptor and body SHA-256.*feature-manifest fallback digest.*controller-owned.*after shadow publication.*before activation/isu,
	);
	assert.match(
		managedHandoff.currentBehavior,
		/parallel composed fixture.*Framescaper.*fresh Soundscaper.*exact-schema-9 first-party video-effects fallback.*feature requirement.*editable retained original.*two exact whole-Blob video bodies.*exact canonical shadow.*intrinsically read-only.*controller separately verifies.*manifest fallback digest.*after shadow publication.*before transient activation/isu,
	);
	assert.match(
		managedHandoff.currentBehavior,
		/injected-port linked retained-video slice.*qualified separately.*does not qualify.*packaged.*UI.*browser codec playback.*linked audio.*other linked and unmanaged originals.*authored proxies or generic rendered-fallback authoring and transfer semantics beyond.*separately maintained controller playback slices.*product chooser.*relink.*watch.*copy or consolidation.*continuous runtime cleanup beyond the startup-bounded tracked inventory.*whole-handoff.*durable capacity reservation.*operating-system.*exact allocation.*write-time capacity.*SQLite or WAL overhead.*external writers.*separate store instances or processes.*portable hard-link capacity.*durable playback identity.*shared cross-product revision journal or undo\/redo history/iu,
	);
	assert.ok(linkedVideoOriginal);
	assert.equal(linkedVideoOriginal.status, 'implemented');
	assert.deepEqual(linkedVideoOriginal.evidence, [
		'desktop/linked-video-locator-store.ts',
		'desktop/linked-video-locator-ipc.js',
		'desktop/preload.mjs',
		'desktop/main.mjs',
		'src/common/editor/controller/project-bootstrap-service.ts',
		'src/common/editor/storage/desktop-linked-video-original-port.ts',
		'src/common/editor/storage/linked-video-original-binding.ts',
		'src/common/editor/storage/linked-video-original-schema.ts',
		'src/common/editor/storage/linked-video-original-repository.ts',
		'src/common/editor/storage/linked-video-original-resolver.ts',
		'src/common/editor/storage/desktop-shared-project-linked-video-originals.ts',
		'src/common/editor/storage/desktop-shared-project-media-acquisition.ts',
		'src/common/editor/storage/desktop-shared-project-media-sender.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage/indexeddb-backend.ts',
		'src/common/editor/storage/memory-backend.ts',
		'src/common/editor/storage/project-repository.ts',
		'src/common/editor/storage/repositories.ts',
		'src/common/editor/storage.js',
		'tests/desktop-linked-video-locator-store.test.ts',
		'tests/desktop-linked-video-locator-ipc.test.js',
		'tests/desktop-preload-linked-video-original.test.js',
		'tests/desktop-linked-video-locator-reconciliation.test.ts',
		'tests/audio-editor-desktop-linked-video-original-port.test.ts',
		'tests/audio-editor-project-bootstrap-service.test.ts',
		'tests/audio-editor-linked-video-original-binding.test.ts',
		'tests/audio-editor-linked-video-original-repository.test.ts',
		'tests/audio-editor-linked-video-original-resolver.test.ts',
		'tests/audio-editor-linked-video-original-cleanup.test.ts',
		'tests/audio-editor-linked-video-original-storage-composition.test.ts',
		'tests/audio-editor-derivative-cache-schema.test.ts',
		'tests/browser/audio-editor-storage-migration.spec.js',
		'tests/audio-editor-desktop-shared-project-linked-video-original-session.test.ts',
		'tests/audio-editor-desktop-shared-project-linked-video-original.test.ts',
		'tests/audio-editor-desktop-shared-project-mixed-media-acquisition.test.ts',
	]);
	assert.match(
		linkedVideoOriginal.requiredOutcome,
		/explicitly injected product-local platform port.*retained original-video body.*exact project ID, logical source ID, physical storage key.*maintained source geometry.*MIME type, byte length, SHA-256.*opaque local locator and revision.*version-7 binding store.*scalar-only.*locator identity and bodies out of project documents.*fresh document-only latest shared load.*aggregate logical-source, byte, and PCM-chunk admission.*before lazy revision- and binding-fenced body verification.*must not create an owned-media copy.*only explicit handoff.*existing managed original-video sender.*concrete maintained desktop chooser.*raw paths main-private and bounded.*exact binding before canonical import commit.*complete bounded durable binding inventory/iu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/closed linked-video binding schema 1.*exact project, source, storage-key, MIME, byte-length, SHA-256, frame\/sample\/video geometry.*opaque locator ID.*opaque locator revision.*compare-and-swap token.*canonical timestamp.*IndexedDB database version 7.*memory backend.*only those scalar values.*source-shape scalars.*no project document or stored binding.*linked body, Blob, filesystem path, URL, platform handle, or playback lease.*only when.*injects.*LinkedVideoOriginalPort/iu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/latest exact-schema-9 document-only shared load.*every reachable linked-video alias.*without reading its body.*complete groups.*identical physical-body identity.*exact managed source geometry.*bound byte length.*4,094-source.*aggregate 64 GiB.*65,536-PCM-chunk preflight.*only after.*preflight succeeds.*first body request.*opaque locator.*expected revision.*exact size and SHA-256.*4-MiB digest windows.*recheck every binding token.*malformed, incomplete, conflicting, replaced, stale, wrong-size, or wrong-digest.*before shadow publication/iu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/exact fresh load.*authoritative local shadow.*without any owned-media read, write, or copy.*explicit prepareHandoff.*exact linked metadata and verified Blob.*maintained managed sender.*normal video digest, bounded transfer, and publication path.*first owned-media copy.*no product chooser.*relink or watch.*durable operating-system handle.*playback lease.*background copy\/consolidation.*alternate publisher.*does not qualify packaged executable or UI.*browser codec playback.*linked audio.*other linked or unmanaged original.*authored proxies.*generic video rendered-fallback relationships.*first-party video-effects fallback activation.*qualified separately/iu,
	);
	assert.match(
		linkedVideoOriginal.currentBehavior,
		/durable IndexedDB opens.*before project loading.*at most 100,000 closed binding rows.*one readonly cursor transaction.*validates authoritative keys and binding identities.*at most 128 exact locator\/revision pairs.*maintained bootstrap.*point-in-time inventory.*closed preload\/IPC boundary.*only after a complete scan.*memory fallback sends nothing.*corrupt or conflicting records.*reject bootstrap before IPC.*preserve locator metadata.*serialized pass.*only startup-loaded metadata.*absent from.*submitted positive inventory.*runtime-created records.*retry after failure.*at most once per store\/process.*failed first registry write.*restores the in-memory inventory.*owner revocation after publication.*second persisted restore.*surfaces either failure.*never stats or deletes external files.*next successful full bootstrap.*startup-loaded chooser metadata.*no durable binding.*binding rows.*durably removed.*surviving binding.*no longer reachable from a canonical project.*remains retained.*bindings disappear after the pass.*later main-process restart.*cannot authenticate inventory completeness.*compromised renderer.*omit live references.*delete startup locator metadata.*cooperative availability maintenance.*not a compromised-renderer integrity control.*continuous runtime cleanup.*hostile IndexedDB row.*unqualified/iu,
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
		'src/common/editor/storage/desktop-shared-project-media-acquisition.ts',
		'src/common/editor/storage/desktop-shared-project-media-contract.ts',
		'src/common/editor/storage/desktop-shared-project-media-sources.ts',
		'src/common/editor/storage/desktop-shared-project-media-transfer.ts',
		'src/common/editor/storage/desktop-shared-project-repository.ts',
		'src/common/editor/storage/desktop-shared-project-source-availability.ts',
		'src/common/editor/storage/media-asset-owned-publication.ts',
		'src/common/editor/storage/media-asset-write-contract.ts',
		'src/common/editor/storage/media-asset-write-repository.ts',
		'src/common/editor/storage/media-asset-digest-backfill.ts',
		'src/common/editor/storage/media-content-digest.ts',
		'src/common/editor/storage/project-repository.ts',
		'src/common/editor/storage/retention-repository.ts',
		'src/common/editor/storage/source-read-repository.ts',
		'src/common/editor/storage/source-record-repository.ts',
		'src/common/editor/storage/source-repository.ts',
		'src/common/editor/storage/source-write-repository.ts',
		'src/common/editor/storage.js',
		'src/common/editor/app.js',
		'tests/audio-editor-desktop-shared-project-mutation-serialization.test.ts',
		'tests/audio-editor-desktop-shared-project-repository.test.ts',
		'tests/audio-editor-desktop-shared-project-source-availability-integration.test.ts',
		'tests/audio-editor-desktop-shared-project-source-availability.test.ts',
		'tests/audio-editor-desktop-shared-project-media-transfer.test.ts',
		'tests/audio-editor-desktop-shared-project-media-transfer-budget.test.ts',
		'tests/audio-editor-desktop-shared-project-media-transfer-ownership.test.ts',
		'tests/audio-editor-desktop-shared-project-mixed-media-acquisition.test.ts',
		'tests/audio-editor-desktop-shared-project-repository-handoff.test.ts',
		'tests/audio-editor-media-asset-ownership.test.ts',
		'tests/audio-editor-source-record-ownership.test.ts',
		'tests/audio-editor-source-write-cancellation.test.ts',
		'tests/audio-editor-project-bootstrap-service.test.ts',
		'tests/desktop-project-library-editor-handoff.test.ts',
		'tests/desktop-project-library-managed-audio-handoff.test.ts',
		'tests/desktop-project-library-audio-rendered-fallback-handoff.test.ts',
		'tests/desktop-project-library-video-rendered-fallback-handoff.test.ts',
		'tests/desktop-project-library-mixed-media-roundtrip.test.ts',
	]);
	assert.match(
		mediaAdmission.requiredOutcome,
		/authoritative latest exact-schema-9 desktop shared-project load.*reachable source references.*preflight.*complete logical-source, canonical-byte, and PCM-chunk budgets.*before.*source-body read.*shared body transfer.*recipient write.*managed canonical PCM and retained original video.*fresh recipient.*digest-verified atomic if-absent publication.*remaining source.*bounded recipient-local admission.*fail before activation.*without deleting a concurrent local replacement/iu,
	);
	assert.match(
		mediaAdmission.currentBehavior,
		/4,094 reachable timeline, Project Bin, and fallback source references.*compatible same-kind physical bindings.*deduplicated.*conflicting geometry.*rejects.*aggregate 64 GiB.*canonical audio archive bytes.*recipient-local and managed original-video bodies.*65,536-PCM-chunk budget.*before.*source-body read.*shared body transfer.*recipient write.*fresh recipient.*managed canonical-PCM and original-video descriptors.*4 MiB reads.*audio.*staged source writer.*video.*owned media-asset writer.*logical identity, kind and storage key.*exact byte length.*SHA-256.*canonical audio byte geometry.*atomic.*only if.*storage key.*absent.*retained original video.*opaque.*not decoded or probed for media geometry/iu,
	);
	assert.match(
		mediaAdmission.currentBehavior,
		/losing absence race.*only.*staging.*preserves the winner.*partial transfer.*pre-shadow failure.*reverse order.*exact acquisition-owned audio record or owned video publication.*source-token, path, or media-chunk payload.*concurrent replacement remains current and intact.*exact authoritative shadow is durable.*late cancellation.*retains.*managed PCM and original video.*not trusted through managed acquisition.*pre-existing latest recipient-local exact-schema-9 snapshot.*logical source identity, kind, storage key, MIME type.*frame and sample geometry.*compatible aliases.*verified once.*conflicting bindings reject/iu,
	);
	assert.match(
		mediaAdmission.currentBehavior,
		/unmanaged audio.*ordered Float32Array PCM.*exact chunk, channel, and frame geometry.*video.*trusted recipient-local SHA-256.*full exact-size Blob.*4 MiB windows.*migration and media-digest backfill.*disabled.*pre-shadow source integrity, availability, binding, geometry, budget, body, and digest failures.*preserve.*prior local shadow and history.*prevent activation.*source-free loads.*no media I\/O.*serializes latest load, save, and delete/iu,
	);
	assert.match(
		mediaAdmission.currentBehavior,
		/first-party audio whole-mix fallback.*only by its exact-schema-9 manifest.*fresh recipient.*separate controller digest verification and activation.*managed transfer verifies its descriptor and body digest.*not the project fallback declaration.*managed mixed-media acquisition.*does not turn unmanaged admission into an atomic snapshot or publisher-authenticated stable playback lease.*injected-port linked retained-video slice.*qualified separately.*linked audio.*every other linked or unmanaged original.*authored proxies or generic rendered-fallback authoring and transfer semantics beyond.*separately maintained controller playback slices.*product chooser.*relink.*watch behavior.*copy or consolidation.*shared managed-media runtime cleanup beyond the startup-bounded tracked inventory.*recipient-local or whole-handoff capacity reservation.*stable playback identity.*packaged.*UI.*browser codec playback.*portable hard-link qualification.*shared cross-product revision and undo history remain unqualified/iu,
	);
	assert.match(
		mediaAdmission.currentBehavior,
		/first-party video-effects fallback.*manifest-only.*editable retained original.*Framescaper.*fresh Soundscaper.*two exact whole-Blob video bodies.*exact canonical shadow.*controller separately verifies.*manifest fallback digest.*after shadow publication.*before transient activation/iu,
	);
	assert.match(
		mediaAdmission.currentBehavior,
		/existing V1-V8 raw-project migrations remain maintained.*prior shared-v1.*product-private-library migration.*deferred and unsupported.*Audacity import.*separate.*first- and third-party effect semantics.*not gated/iu,
	);
	assert.match(
		documentation,
		/latest exact-schema-9 source-bearing\s+shared load.*4,094.*deduplicates compatible same-kind\s+physical bindings.*aggregate 64 GiB.*canonical audio archive bytes.*original-video bodies.*65,536-PCM-chunk.*before.*body read.*shared body transfer.*recipient\s+write.*fresh recipient.*managed canonical-PCM and\s+original-video descriptors.*4 MiB reads.*four\s+main-process reads active.*staged product-local audio source.*owned\s+video-media writer/isu,
	);
	assert.match(
		documentation,
		/transfer must match descriptor identity, kind and\s+storage key, exact byte length, SHA-256, and canonical audio byte geometry.*atomic if-absent publication.*retained original video.*opaque.*not decoded or probed for media geometry.*loses that absence race.*only its own staging.*preserves the winner.*partial acquisition, later admission failure.*roll back in reverse order.*exact\s+acquisition-owned audio\s+record or video publication.*source token, path, or media-chunk payload.*concurrent replacement is preserved.*source not acquired.*pre-existing latest\s+recipient-local exact-schema-9 snapshot.*same project/isu,
	);
	assert.match(
		documentation,
		/deliberately narrow linked retained-video path.*local binding.*exact project ID, logical video source ID.*physical storage key, MIME type, byte length, SHA-256.*frame\/sample\/video geometry.*opaque locator ID.*opaque locator\s+revision.*neither locator value appears in the project document.*IndexedDB\s+database version 7.*memory backend.*closed scalar-only binding\s+record.*scalar source-shape fields.*compare-and-swap token.*canonical\s+timestamp.*no linked body.*`Blob`.*filesystem path.*URL.*platform\s+handle.*playback lease/isu,
	);
	assert.match(
		documentation,
		/explicitly injected platform port.*fresh document-only latest shared\s+load.*complete exact linked-video alias group.*without a prior local\s+project snapshot or managed descriptor.*inspection performs\s+no privileged body read.*linked byte length.*complete logical-source, 64 GiB byte, and PCM-chunk preflight.*only after\s+that aggregate preflight succeeds.*opaque\s+locator.*expected revision.*exact byte length.*4-MiB windows.*recheck every binding token.*authoritative local shadow.*without\s+reading, writing, or copying an owned media asset.*malformed, incomplete,\s+conflicting, replaced, stale-revision, wrong-size, or wrong-digest bindings fail\s+closed before shadow publication/isu,
	);
	assert.match(
		documentation,
		/only an explicit `prepareHandoff`.*verified linked body.*owned\s+media.*exact linked-session overlay.*existing\s+managed original-video sender.*normal aggregate preflight,\s+digest, bounded-transfer, and publication contract.*no product\s+chooser, relink or watch flow.*durable operating-system handle.*playback\s+lease.*background\s+copy\/consolidation.*alternate publishing protocol.*linked\s+audio, every other\s+linked or unmanaged original.*authored proxies.*generic\s+video rendered-fallback relationships.*packaged executable\/UI behavior.*browser codec\s+playback remain\s+unqualified.*first-party\s+video-effects fallback activation.*separate/isu,
	);
	assert.match(
		documentation,
		/durable IndexedDB opens.*project loading.*100,000 closed binding rows.*readonly cursor transaction.*authoritative key.*binding identity.*128.*locator\/revision pairs.*maintained bootstrap.*point-in-time inventory.*preload\/IPC boundary.*complete scan.*Memory fallback sends nothing.*corrupt or conflicting records.*reject bootstrap before IPC.*preserve.*locator metadata/isu,
	);
	assert.match(
		documentation,
		/serialized pass.*startup-loaded metadata.*submitted positive inventory.*runtime-created records.*retry after failure.*at most once.*store\/process.*registry write.*in-memory inventory.*owner.*revocation.*persisted restore.*surfaces.*failure.*never.*stats.*deletes.*external files.*next successful full bootstrap/isu,
	);
	assert.match(
		documentation,
		/startup-loaded chooser metadata.*durable binding.*binding rows.*durably removed.*surviving binding.*canonical project.*remains retained.*current-process records.*one-shot pass.*later main-process restart.*cannot authenticate inventory completeness.*compromised.*renderer.*omit live references.*delete startup locator metadata.*cooperative availability maintenance.*not a compromised-renderer integrity.*control.*Continuous runtime cleanup.*hostile IndexedDB row.*not implemented/isu,
	);
	assert.match(
		documentation,
		/snapshots metadata before and\s+after.*ordered\s+`Float32Array` channel\/frame geometry.*trusted recipient-local\s+SHA-256.*genuine exact-size\s+video `Blob`.*SHA-256.*4 MiB windows.*body digest\s+must match.*legacy PCM-on-read migration and media-digest backfill are\s+disabled.*failure\s+detected before shadow publication.*latest local shadow\s+and revision history unchanged.*prevents bootstrap activation.*cancellation\s+first observed after the exact shadow is durable.*retains that shadow.*acquired managed media/isu,
	);
	assert.match(
		documentation,
		/source-free latest\s+loads.*zero source or media I\/O.*bootstrap.*lifetime\s+signal.*latest load, save, and\s+delete serialized.*per project.*storage\s+keys.*audio and video bytes already present.*pre-existing latest local\s+snapshot.*missing-recipient-PCM.*pre-existing revision/isu,
	);
	assert.match(
		documentation,
		/recipient-local admission for unmanaged sources.*bounded sequential\s+readability check.*not an atomic snapshot.*publisher authentication.*durable byte\s+lease.*selected metadata.*not transactionally bound.*same-metadata replacement.*undetected.*replacement or\s+deletion afterward.*not fenced.*non-cooperative providers.*cancellation.*shadow\s+save.*not abort-atomic.*separate repository instances and\s+processes.*not serialized/isu,
	);
	assert.match(
		documentation,
		/managed-media\s+runtime cleanup beyond the startup-bounded tracked inventory.*recipient-local or\s+whole-handoff capacity reservation.*stable byte\s+lease through playback.*browser codec playback.*packaged.*UI.*portable hard-link capacity\s+qualification.*shared cross-product\s+revision journal and undo\/redo history remain unqualified/isu,
	);
	assert.match(
		documentation,
		/each absent managed audio or video binding.*synchronously reserves.*prospective catalog row and metadata bytes.*other in-flight.*reservations.*50,000-row.*4 MiB.*64 GiB.*aggregate declared body bytes.*before.*filesystem query, hard-link attempt, directory or stage creation, or.*body consumption.*BigInt `statfs`.*managed-media destination.*available blocks.*aggregate in-flight declared bytes.*held until descriptor publication settles.*released\s+idempotently.*failure.*cancellation.*revalidates.*current catalog.*exact-present retry.*bypasses.*new reservation and `statfs`.*reverifies.*existing body/isu,
	);
	assert.match(
		documentation,
		/point-in-time in-process admission.*not an operating-system reservation.*exact allocation or write-time capacity guarantee.*allocation-unit rounding.*SQLite or WAL overhead.*external writers.*other store instances or processes.*whole handoff.*not reserved atomically.*hard-link\s+reuse.*does not establish a portable capacity.*claim/isu,
	);
	assert.match(
		documentation,
		/managed-media collector.*logical\s+retirement.*project ID, revision, and document digest.*unmanaged or opaque descriptors.*untouched.*normal\s+fenced metadata journal.*materialized or published\s+inventory row.*fails startup before managed-media filesystem mutation.*100,000 total\s+inventory rows.*64-row transactions.*canonical\s+rescan.*deterministic noncatalogable\s+quarantine.*unregistered and legacy.*neither adopted nor removed.*startup-only cooperative-writer reclamation.*not continuous runtime\s+cleanup.*later startup pass.*third-party database corruption/isu,
	);
});
