/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
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
		/desktop-read-path-capabilities.*enforced for the current versioned materialized, Scape range, linked-audio range, and linked-video playback range profiles.*`?materialized-v1`?.*`?scape-range-v1`?.*`?linked-audio-range-v1`?.*`?linked-video-range-v1`?.*all four profiles.*128 pending\/live.*`?materialized-v1`?.*512 MiB.*per-owner.*`?scape-range-v1`?.*at most four capabilities.*65 GiB.*globally and per owner.*linked audio and video share.*128 capabilities.*64 GiB.*512 MiB per file.*16 active range requests.*count.*before open.*bytes.*after stat.*before descriptor publication.*cleanup failure.*retains the range charge.*fences.*expiry for the expiring profiles.*owner-pinned without wall-clock expiry.*OS-open dispatch.*four Scape descriptors.*fifth.*unopened.*acknowledged release.*redispatches.*renderer-send failure.*releases.*descriptor/isu,
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
		/separately admitted `?linked-audio-range-v1`? and `?linked-video-range-v1`? profiles.*exact current locator revision.*pathname stat.*opens an owner-scoped handle.*same identity.*pathname-replacement race.*128-capability.*64 GiB.*16-active-request.*512 MiB per file.*protocol admits `HEAD`.*start-based closed or open-ended `GET`.*4 MiB.*rejects a full-body `GET`.*successful response or ordinary cancellation.*preserves the pinned capability.*inner stream failure retires.*maintained WAV\/RF64 MIME\/name contract.*exact `?\.aif`? or `?\.aiff`? name.*`?audio\/aiff`?.*`?\.aifc`?.*hashes the entire admitted handle sequentially.*at-most-4-MiB `206` responses.*binding and CAS fence.*linked-PCM path.*without constructing a second whole-original Blob.*FORM\/AIFF.*COMM.*SSND.*signed big-endian integer PCM.*8.*16.*24.*32.*FORM\/AIFC.*FVER v1.*0xA2805140.*44-byte\s+COMM.*32-bit `?fl32`?.*Pascal compression name `?32-bit\s+floating point`?.*first-party label.*maintained fixture.*not authenticated provenance.*producer-neutral.*any producer.*exact tuple.*broader.*compressed.*other AIFC profiles reject.*broader third-party interoperability.*producer provenance.*unqualified.*release.*once.*aggregate error.*provider-owned stable PCM\s+read session.*one full-container digest,? and one parsed descriptor.*serialized random or sequential chunk reads.*complete alias group.*exact binding.*before and after.*per-read.*cancellation.*local.*provider retirement.*terminal.*exact-once release.*backing cleanup.*aggregate.*linked-PCM range control.*initial binding.*materialized the complete external WAV or AIFF.*512 MiB.*not a content-frozen, durable,.*cross-process lease.*same-inode mutation.*unfenced.*Float32 arrays.*source-container metadata.*does not preserve WAV or AIFF ancillary metadata.*no packaged-executable.*operating-system.*reference-scale qualification/isu,
	);
	assert.match(
		documentation,
		/`?materialized-v1`? tier.*whole `?Blob`?.*512 MiB.*excludes Scape and linked-original range descriptors.*declared `?Content-Length`?.*emitted-byte.*final `?Blob`?-size.*16 MiB.*caller.*`?AbortSignal`?.*never calls `?response\.blob\(\)`?.*not decoder amplification or whole-process RSS/isu,
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
		/shared-desktop-project-library-integrity.*partial.*product-neutral appData library.*fresh filesystem library scope `?v8`?.*SQLite `?user_version`? 10.*ignores rather than migrates.*prior shared `?v7`? scope.*preserv.*metadata schema 7.*exact schema 15.*user_version`? 9.*in place.*older.*v6.*schema-14.*user-version-8.*historical.*untouched.*copied `?v7`?.*`?user_version`? 9.*`?v8`? path.*reject.*without mutation.*migrat.*adopt.*backfill.*metadata schema 8.*separate opaque library entry ID.*exact schema 16.*bounded byte length.*SHA-256.*immutable revision-and-digest path.*canonical tagged-binary codec.*opaque binary state.*non-raiseable 256 MiB.*lower-only test seam.*persistence root.*reserves.*canonical path.*unique random attempt.*lease.*fencing-token.*authoritative project and stage inventories.*same immediate transaction.*before exclusive stage creation.*exact-lease cleanup.*acknowledged.*exclusive-open failure.*registration.*without unlinking.*error after exclusive creation.*registered random stage.*lost-lease or failed cleanup.*registration.*takeover.*successful materialization.*exact metadata and stage paths.*lease ID.*fencing token.*renames and syncs.*marks the canonical row materialized.*removes the stage row.*every catalog reference.*before an exact plus-one journaled catalog commit.*before staging.*before publication.*transactionally at catalog commit.*old or new complete file-and-catalog pair.*stale fencing token cannot publish.*serializes commits.*continues lease renewal while close fences new work and drains admitted work/isu,
	);
	assert.match(
		documentation,
		/after recovery.*before host exposure.*immutable-document collector.*authoritative project and stage inventories.*monotonic row IDs.*independent cycle high-waters.*both cursors.*alternating schedule.*100,000 total rows.*64-row batches.*immediate SQLite writer transaction.*exact unexpired lease.*before and after filesystem work.*current exact-lease stage.*live.*stale registered regular stage.*unlinked.*missing attempt retires.*non-regular target.*non-direct parent.*untouched and inventoried.*canonical rows.*current lease.*outstanding stage.*ineligible.*rescan flag.*restarting the canonical high-water.*portable case-folded reachability.*current catalog.*previous and next snapshots.*pending prepared or committed journals.*deterministic noncatalogable quarantine.*unregistered stage-looking.*canonical.*forged quarantine.*do not consume.*budget.*untouched.*100,001-row.*successive bounded passes.*later inserts.*next high-water cycle.*low- and mixed-cap.*canonical rescanning.*yield.*renewal and cancellation.*stale takeover.*tested reclamation failure during startup.*releases its still-owned lease.*cleanup failure.*reported.*static symlinked project root.*managed media.*untouched.*without adding renderer IPC/isu,
	);
	assert.match(
		documentation,
		/after metadata-journal recovery.*project-file reclamation.*before host exposure.*managed-media collector.*canonical and stage-attempt inventories.*descriptor.*project identity.*exact revision.*document digest.*storage key.*lease.*fencing token.*tracked catalog row.*exact current project tuple.*logically retires.*unmanaged or untracked.*preserved.*journal.*settled.*before physical deletion.*persisted.*independent high-waters.*alternating schedule.*100,000.*64-row batches.*current exact-lease.*current catalog.*outstanding stage.*protected.*deterministic noncatalogable quarantine.*crash-left.*promotion.*quarantine.*unregistered.*legacy.*symlink.*non-regular.*untouched.*later startup.*empty director.*SQLite\/WAL.*continuous runtime cleanup.*unqualified/isu,
	);
	assert.match(
		documentation,
		/main-owned editor service.*bounded document.*strict exact-schema-16 maintained-persistence-domain validator.*before.*host commit.*before project staging.*loaded commit result.*stored reads.*before returning a renderer response.*core project, document, media, and graph structures.*strictly checked.*all audio effects.*cloneable.*generic identity, enabled, and parameter structure.*type-specific semantic checks.*missing-effect compatibility metadata.*parametric EQ.*other first- and third-party effect payload semantics.*not gated.*invalid collection shapes.*duplicate identities.*dangling source or clip references.*invalid loaded commit result.*input-side failures.*do not reach a host commit or project file.*packaged-runtime fixture.*validator.*emitted and active/isu,
	);
	assert.match(
		documentation,
		/before `JSON\.parse`.*structurally scans every schema.*101,536 JSON values.*depth 130.*exact schema 16.*independent decoded-codec.*structural-validator.*100,000 logical nodes.*depth 128 per phase/isu,
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
		/identity service.*frozen preload.*owner-scoped IPC.*bounded, pathless list, read, bundle, commit, delete, and managed-source transfer.*256 MiB.*4 KiB.*10,000-summary.*64 GiB source-body.*4,094-bundle-descriptor.*4 MiB chunk.*renderer transfer code.*4,094 reachable logical sources.*before source-body or bridge-body I\/O.*four active source uploads.*four active source reads.*across the bridge service.*capacity remains charged.*publication or abort settlement.*disposal waits.*finishing publications.*catalog summaries.*entry IDs.*main-owned catalog\/filesystem paths.*digests.*product preferences.*raw `updatedAtMs` fields.*leases.*fencing tokens.*managed bundle descriptors.*binding IDs.*source identities and storage keys.*source kind.*audio-f32le-chunks-v1.*video-original-v1.*byte lengths.*SHA-256 digests.*owner revocation.*fences new work.*aborts owned upload sessions.*drains admitted operations/isu,
	);
	assert.match(
		documentation,
		/ordinary shared-project saves remain document-only.*managed canonical PCM and retained original video.*explicit project-handoff action.*before any source body read or bridge call.*4,094 reachable logical sources.*same-kind physical bindings.*rejects conflicting aliases.*aggregate 64 GiB audio-and-video byte budget.*audio-only 65,536-chunk budget.*two full validating reads.*binding is absent.*second read.*uploads bounded sequential chunks.*changed PCM, video bytes, or trusted video metadata/isu,
	);
	assert.match(
		documentation,
		/main revalidates the exact current project revision.*requested reachable source kind, identity, geometry.*audio-f32le-chunks-v1.*video-original-v1.*derives the catalog document SHA-256 rather than accepting it from the renderer.*serialized host repeats exact revision-and-document-digest validation.*immutable binding includes project identity, exact revision, exact document digest, and storage-key\/media geometry.*prior-revision row or same-revision document variant.*neither advertised nor accepted as present.*exact-present reuse.*declared length and SHA-256.*reverifies the regular body/isu,
	);
	assert.match(
		documentation,
		/schema-4 managed-media canonical and stage-attempt inventories.*exact descriptor.*project identity.*revision.*document digest.*storage key.*state.*lease ID.*fencing token.*after point-in-time capacity admission.*exact canonical row.*random upload or reuse stage.*before body or optional hard-link work.*before directory or stage creation.*materialization.*exact registered stage.*regular.*atomically renames.*syncs the directory.*canonical row to materialized.*removes the stage row.*catalog preparation.*exact materialized or published row.*catalog commit.*published in the same SQLite transaction as metadata/isu,
	);
	assert.match(
		documentation,
		/same-kind canonical binding.*fully verify the donor.*private random staged hard link.*verify it again.*promote it exclusively.*opaque or corrupt donor rows.*skipped.*exhausted donor link count.*another donor.*target race.*never overwritten.*unsupported hard-link behavior.*bounded upload.*other operational failures propagate.*private regular stage.*digest-verified and synced.*atomically renamed.*directory-synced before catalog publication.*publication failure.*materialized.*upload or linked.*retry.*without a renderer body upload.*does not consume.*offered stream/isu,
	);
	assert.match(
		documentation,
		/one managed-media store instance.*exact-absent audio or video binding.*prospective catalog.*same-instance pending descriptors.*50,000-row.*4 MiB serialized-metadata ceilings.*lower-only test seams.*synchronously reserves one row.*declared body bytes.*aggregate 64 GiB pending-byte ceiling.*BigInt `?statfs`?.*failed, malformed, or known-insufficient.*before managed-media directory work.*body iteration.*optional hard-link work.*held through descriptor-publication settlement.*final publication rereads the catalog.*revalidates.*exact-present bindings.*bypass.*descriptor and body verification.*not a universal copy-free guarantee.*hard-link reuse.*full declared body.*reject a feasible link/isu,
	);
	assert.match(
		documentation,
		/capacity admission.*store-instance and point-in-time.*not an operating-system.*cross-instance or cross-process.*whole-handoff.*renderer-session reservation.*beginSourceWrite.*return ready before asynchronous host\/store refusal.*appData project-document staging separately admits the exact serialized document size.*point-in-time fail-closed BigInt `statfs` for the projects root.*before document directory or stage work.*SQLite\/WAL allocation.*filesystem allocation overhead.*later external allocation.*write-time success.*UI state.*startup-bounded tracked-inventory reclamation.*separate.*continuous runtime cleanup.*100,000.*later startup.*unregistered or legacy.*empty director.*SQLite\/WAL.*unqualified/isu,
	);
	assert.match(
		documentation,
		/renderer repository.*repeats maintained-persistence-domain exact-schema-16 validation and canonical reserialization.*before local mutation.*product-local shadow.*shared latest document and summary list.*authoritative.*fails closed.*incomplete desktop bridge.*source-free editor fixture.*Soundscaper.*same identity and revision.*fresh Framescaper-local store.*next revision.*higher fencing token.*shared media catalog.*empty/isu,
	);
	assert.match(
		documentation,
		/dedicated Linux x64 CI.*two separate unpacked packages.*Soundscaper.*Framescaper.*Soundscaper.*isolated appData.*separate product profiles.*reuses.*Soundscaper profile.*renderer[- ]ready.*pathless preload IPC.*exact[- ]SHA-256.*source-free.*schema 16.*revisions 1, 2, and 3.*summary.*main-only catalog row.*clean recovery.*no stale takeover.*higher fencing token.*increasing catalog revisions?.*preferred product.*process exit.*lease release.*combined with.*composed editor.*closes only.*generic packaged source-free preload\/IPC\/multi-process\/executable lifecycle gap/isu,
	);
	assert.match(
		documentation,
		/does not qualify packaged controller autosave or tab activation.*source-bearing bytes, playback, or managed media.*concurrent opens.*crash or stale takeover.*interruption or power loss.*path identity.*installers or file associations.*Windows, macOS, or ARM64.*third-party.*gating.*legacy Soundscaper.*migration/isu,
	);
	assert.match(
		documentation,
		/latest authoritative exact-schema-16 source-bearing load.*4,094 reachable timeline, Project Bin, and fallback sources.*before source bodies are read.*same-kind physical bindings.*rejects conflicts.*aggregate 64 GiB audio-and-video byte ceiling.*audio-only 65,536-chunk ceiling.*fresh recipient first acquires.*managed canonical-PCM and retained-original-video descriptors.*bounded reads.*staged product-local audio-source or media-asset writers.*descriptor identity, kind and storage key.*exact byte length.*SHA-256.*atomic if-absent publication.*canonical audio byte geometry.*opaque exact bytes.*not decoded or probed for media geometry.*loses the absence race.*only its own staging.*preserves the winner.*partial transfers.*pre-shadow failures.*acquisition-owned audio records or owned video publications.*source-token, path, or media-chunk payloads.*concurrent replacement.*preserved.*not acquired.*pre-existing latest recipient-local exact-schema-16 snapshot.*logical identity, kind, storage key, MIME type.*kind-specific media geometry.*ordered Float32Array PCM.*trusted recipient-local SHA-256.*video body read.*genuine exact-size Blob.*SHA-256.*4 MiB windows.*no on-access storage maintenance.*failures detected before shadow publication.*preserve.*prior local shadow.*prevent activation.*cancellation.*after the exact shadow is durable.*retains the exact shadow and acquired audio and video.*source-free.*zero source or media I\/O/isu,
	);
	assert.match(
		documentation,
		/headless composed mixed-media fixture.*exact PCM plus one retained original video from Soundscaper.*fresh Framescaper-local store before activation.*no missing sources.*exact PCM to the playback engine.*exact video bytes.*shared Blob URL.*timeline and Project Bin.*play and stop state.*edits and saves in Framescaper.*returns to the original Soundscaper profile.*tested Linux filesystem.*revision-bound audio and video catalog rows.*distinct.*one inode.*local revision history.*no bridge or shared-library body read or upload.*controller\/headless evidence.*not packaged Electron UI or browser video-codec qualification/isu,
	);
	assert.match(
		documentation,
		/linked retained-video slice.*schema-1 closed product-local binding.*exact project and source.*pathless opaque locator ID.*opaque locator-revision fence.*independent repository-owned CAS binding token.*storage key.*video MIME.*exact source geometry.*byte length.*lowercase SHA-256.*no filesystem path, URL, handle, or linked body.*project ID, source ID, storage key, MIME type.*every geometry field.*before privileged platform I\/O.*expected locator revision.*exact length.*complete SHA-256.*4 MiB windows.*rereads.*binding.*CAS fence.*fresh per-operation alias session.*module-private WeakMap.*forged.*rejected.*complete reachable video alias group.*before any linked body read.*metadata.*aggregate budget preflight.*before lazy.*body resolution.*storage key alone.*never authorizes.*binding, descriptor-free shared admission, and visual activation.*no durable product-owned copy.*explicit managed handoff.*bounded same-store\/process lifecycle coordinator.*project deletion and whole-store clear.*local commit.*before exact metadata release.*live alias.*prevents release.*pending retry.*rechecks aliases.*fulfilled false.*settles.*external target.*untouched/isu,
	);
	assert.match(
		documentation,
		/ordinary locator load.*`?materialized-v1`?.*playback load.*exact locator revision.*opened.*`?linked-video-range-v1`? handle.*same identity.*replacement after admission cannot retarget/isu,
	);
	assert.match(
		documentation,
		/selection and import adapter.*whole-Blob materializer.*closed exact locator ID-and-revision CAS release.*missing, malformed, or accessor revision.*never authorizes cleanup.*explicit exact-content relink.*already-bound.*writable Project Bin video source.*whether or not it is currently missing.*missing-source state is not eligibility.*pathless selected Blob.*opaque locator ID and revision.*exact old binding token.*selected Blob.*old byte length and SHA-256.*candidate.*exact selected revision.*same selected length and digest.*synchronous `assertCanPublish`.*same compensated memory batch or IndexedDB readwrite transaction.*immediately before.*binding and provisional-root pair.*task cancellation.*writable writer.*project generation.*initially missing source.*missing-source status.*stops timeline playback and Project Bin preview.*revokes.*before CAS.*restores an initially available source's visual.*records missing state when restoration fails.*Activation happens after CAS.*clears missing state.*publishes.*records missing state on the committed binding.*canonical project.*history identities remain unchanged.*prepublication.*preserves the old binding.*alias-aware.*distinct candidate locator.*postpublication activation failure.*retains.*missing state.*displaced old locator.*not immediately released.*bounded later startup reconciliation.*desktop visual activation.*ranged playback lease.*exact binding revision.*complete pinned handle.*4 MiB ranges.*binding and CAS fence.*returns only the media URL and one-shot release.*does not construct another original-video Blob/isu,
	);
	assert.match(
		documentation,
		/visual service owns that lease.*Object URLs.*candidate and stored leases are released once.*bulk cleanup.*media-element failure.*exact media URL.*failed ranged admission.*does not silently retry.*platform port without the optional playback lease/isu,
	);
	assert.match(documentation, /maintained linked-PCM slice.*shared owner-scoped range pool.*exact-revision.*digest-verified.*WAV\/RF64, structurally validated classic AIFF, or canonical first-party AIFF-C float32 inspection.*canonical PCM chunk reads.*without a second whole-original Blob.*same-inode external mutation during or after sequential digest verification.*not fenced.*not an immutable, durable, or cross-process byte snapshot.*selection and initial binding, whole-Blob resolution, availability, handoff, and relink selection.*complete body.*512 MiB.*visual activation and linked-PCM canonical reads.*at-most-4-MiB responses.*without constructing another original Blob.*Float32 arrays.*metadata.*decoder or codec amplification.*RSS.*browser caching.*garbage-collection headroom.*no packaged, operating-system, or reference-scale evidence/isu);
	assert.match(documentation, /privileged service.*compromised renderer.*over-budget or maintained-domain-invalid exact-schema-16 input.*before.*host.*stage a project.*shared-project-parse-budget.*remains open.*unmanaged recipient admission.*not an atomic snapshot.*same-metadata replacement.*can go undetected.*owned canonical PCM.*generation-fenced.*root-to-base copy-on-write ancestry.*observed at session open.*not a durable proof.*intended base generation.*content or byte lease.*cross-store or cross-process.*managed handoff now closes.*Soundscaper-to-Framescaper edit\/save\/return.*canonical PCM and retained original video.*manifest-only exact-schema role-defined unknown-feature audio whole-mix.*role-defined.*unknown-feature whole-project video.*first-party videoEffects clip-target and first-party audioEffects track-target fallbacks.*startup-bounded tracked managed-media reclamation.*continuous runtime cleanup/isu);
	assert.match(
		documentation,
		/linked retained video.*product-local chooser.*validated main\/preload boundary.*whole-Blob selection\/import adapter.*exact-binding import.*closed exact locator ID-and-revision CAS release.*owner-scoped exact-revision ranged visual playback.*maintained linked-PCM slice.*shared owner-scoped range pool.*canonical PCM chunk reads.*without a second whole-original Blob.*private main-owned registry.*pathless.*not an operating-system bookmark.*pathname replacement after range admission cannot retarget.*same-inode external mutation.*not fenced.*not an immutable, durable, or cross-process byte snapshot.*selection and initial binding.*complete body.*visual activation and linked-PCM canonical reads.*at-most-4-MiB responses.*without constructing another original Blob.*Float32 arrays.*metadata.*decoder or codec amplification.*RSS.*browser caching.*no packaged, operating-system, or reference-scale evidence/isu,
	);
	assert.match(
		documentation,
		/bounded same-store\/process project-delete and clear cleanup.*local commit.*before metadata release.*live aliases.*pending retry.*bounded cooperative startup pass.*point-in-time authoritative catalog.*10,000 closed exact project\/revision summaries.*readwrite transaction.*local current projects and retained revisions.*100,000 closed mixed-kind binding rows.*generic pass.*128 mixed-kind exact locator\/revision pairs.*legacy video-only fallback.*reference cardinality and deletion only to video.*full-store rows and aliases.*preserving audio.*Catalog-absent bindings.*unreachable.*catalog-live binding.*source-pruned only.*bounded product-local exact-schema-16 current and retained graph.*current revision equals the catalog summary.*missing, stale, invalid, incomplete, or over-bound.*surviving alias.*remain live.*rolls back before IPC.*source-level reachability beyond bounded startup reconciliation, maintained saves, and successful writable activations remains open.*catalog snapshot.*binding transaction.*main registry write.*not one cross-boundary atomic operation.*hostile renderer.*inventory completeness.*separate store, profile, or process.*not serialized.*general continuous cleanup.*remains open.*packaged executable.*operating-system file-dialog and identity behavior.*broader linked audio.*authored-proxy relationships.*rendered-fallback authoring and managed handoff beyond the closed audio and closed whole-project video roles and the maintained first-party clip-local videoEffects and track-local audioEffects relationships.*browser.*video.*codec behavior.*two fixed Linux x64 Electron source-bearing shared-library workflows.*qualified separately.*activation and transport playback.*four frozen rendered-fallback roles.*two web.*\.scape.*counterparts.*fixed Chromium browser-download fixture.*packaged rendered-fallback final delivery.*fallback authoring or other relationships.*linked\/unmanaged-media relationships.*remaining browser and platform matrix.*open.*hard-link.*power-loss.*Linux x64 source-free packaged lifecycle.*remaining platform.*pre-release schemas 1 through 15.*source-media re-import.*no raw-project migration path.*prior shared.*v7.*older.*v6.*v5.*v4.*v3.*v2.*v1.*product-private Soundscaper libraries.*unsupported.*Audacity.*maintained interchange boundaries/isu,
	);
	assert.match(
		documentation.replace(/\s+/gu, ' '),
		/bounded cooperative startup reconciliation pass.*main\/renderer durability boundary.*durable IndexedDB opens.*before.*project loading.*point-in-time authoritative.*catalog.*10,000 project summaries.*closed\s+own-data.*id, revision.*invalid or duplicate identities.*invalid.*revisions.*summary bound.*reject.*before the binding transaction.*Memory fallback returns before catalog listing, binding mutation, or IPC.*durable platform port without reconciliation.*catalog.*no binding mutation or IPC.*one IndexedDB readwrite transaction.*local current projects, retained revisions, and linked-original bindings.*100,000 closed binding rows.*128 unique exact locator\/revision pairs.*complete mixed-kind inventory.*Malformed rows.*conflicting locator revisions or storage aliases.*bounds.*binding deletion failure.*abort and roll back.*before IPC.*catalog-absent projects.*Every audio or video binding.*project is absent.*unreachable.*catalog-live project.*source-level pruning.*product-local current document.*exact schema 16 at the catalog revision.*64 exact retained revisions.*current revision.*timeline, Project Bin, and every feature-fallback source.*without publisher gating.*Missing, older, newer, malformed, incomplete, or over-bound.*retains every binding.*100,000 aggregate roots.*suppress.*source-level pruning.*catalog-absent.*eligible.*surviving same-store alias.*positive inventory.*closed preload\/IPC path.*catalog summary.*authoritative for project presence and current revision.*not.*content.*product-local graph.*catalog snapshot.*local transaction.*main registry write.*not one cross-boundary atomic operation.*binding deletion commits before.*separate main operation.*later main.*rejection.*retry.*Main serializes.*startup-loaded metadata.*runtime-created records.*failed.*retry.*successful pass.*store\/process.*Unknown or stale references.*before mutation.*registry write.*in-memory inventory.*Owner revocation.*persisted restore.*on-disk outcome.*indeterminate.*never load, stat, write, or delete external media bytes.*project-absent or source-unreachable.*catalog-revision fence.*Current-process abandoned records.*later main-process restart.*cannot authenticate inventory or local-graph completeness.*compromised renderer.*omit.*live references.*startup metadata.*same-revision product-local graph.*not content-authenticated.*Separate store, profile, or process.*not serialized.*cooperative.*first-party lifecycle housekeeping.*not a renderer-compromise integrity control.*orderly close, dispose, and reopen.*abrupt process death.*fsync.*power loss.*not qualified.*source-level cleanup outside bounded startup, maintained saves, and successful writable activations.*general continuous cleanup beyond same-store startup\/save\/activation\/delete\/clear.*hostile IndexedDB row.*remain open/isu,
	);
	assert.doesNotMatch(documentation, /guaranteed progress after an incomplete|incomplete 100,000-entry reclamation inventory/iu);
	assert.doesNotMatch(documentation, /abandoned stage-file cleanup.*remain(?:s)? open/iu);
});

test('disposable video preview cache evidence binds current originals without claiming editorial proxies', async () => {
	const matrix = await readMatrix();
	const mediaRisk = matrix.risks.find(({ id }) => id === 'external-media-parser-bounds');
	const control = mediaRisk?.currentControls.find(
		({ id }) => id === 'original-bound-disposable-video-preview-cache',
	);
	assert.ok(control);
	for (const path of [
		'src/common/editor/storage/video-derivative-relationship.ts',
		'src/common/editor/storage/video-derivative-repository.ts',
		'src/common/editor/storage/media-repository.ts',
		'src/common/editor/storage/derivative-cache-entry.ts',
		'src/common/editor/storage/media-records.ts',
		'src/common/editor/controller/source-import.ts',
		'src/common/editor/commands/project-source-bin-runtime.js',
		'src/common/editor/scape-project.js',
		'src/common/editor/storage/desktop-shared-project-source-availability.ts',
		'tests/audio-editor-video-derivative-binding.test.ts',
		'tests/audio-editor-video-derivative-publication-fence.test.ts',
		'tests/audio-editor-storage-records.test.ts',
		'tests/audio-editor-derivative-cache-consistency.test.ts',
		'tests/audio-editor-derivative-cache-paging.test.ts',
		'tests/audio-editor-source-import.test.ts',
		'tests/audio-editor-project-bin.test.js',
		'tests/audio-editor-scape-project.test.js',
		'tests/audio-editor-desktop-shared-project-source-availability.test.ts',
		'tests/audio-editor-desktop-shared-project-media-sender-video.test.ts',
	]) assert.ok(control.evidence.some((item) => item.path === path), `Missing preview-cache evidence from ${path}`);
	assert.match(
		control.summary,
		/repository-trusted current SHA-256.*media-content token.*content-addressed key.*original storage key and digest.*poster\/thumbnail type.*normalized non-negative source time.*versioned recipe.*revalidates.*original digest\/token.*before publication.*atomically publishes.*payload and scalar companion.*failed publication.*staged OPFS output.*load.*current original.*payload\/companion.*match.*output size and SHA-256.*different original generation.*cache miss.*digest is unchanged.*legacy or unbound.*miss.*malformed pairs.*reject.*exact deletion.*media-asset cascade.*payload.*match.*scalar companion.*before any row.*deleted.*paths re-projected from validated payloads.*after commit.*mismatch aborts.*without OPFS disposal.*corrupt companion path.*cannot delete an unrelated original.*explicit recipe deletion selector.*normalized recipe ID\/version.*omitted recipe.*all revisions.*null.*posterStorageKey.*thumbnailStorageKey.*future read-only.*opaque.*desktop recipient binding.*excludes legacy locator.*no longer part of maintained durable binding identity.*not an editorial video proxy or relink relationship/iu,
	);
	const decoderResidual = mediaRisk?.residualRisks.find(({ id }) => id === 'compressed-media-corpus');
	assert.ok(decoderResidual);
	assert.match(decoderResidual.exposure, /decoder.*codec.*browser heap.*process RSS.*unbounded/iu);

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	const normalizedDocumentation = documentation.replace(/\s+/gu, ' ');
	assert.match(
		normalizedDocumentation,
		/original-bound-disposable-video-preview-cache.*repository-trusted current SHA-256.*media-content token.*content-addressed key.*original storage key and digest.*poster or thumbnail type.*normalized non-negative source time.*versioned recipe.*revalidates.*immediately before publication.*payload and scalar companion.*failed publication.*staged OPFS output.*output size and SHA-256.*older original generation.*cache miss.*same digest.*malformed pair or binding.*reject.*legacy or unbound.*cache misses.*exact derivative deletion.*media-asset cascade.*full agreement.*scalar companion.*before deleting any row.*paths re-projected from validated payloads.*after the transaction commits.*mismatch.*without disposing any OPFS path.*corrupt companion path.*cannot delete an unrelated.*recipe.*normalized recipe ID and version.*omitting the recipe.*all revisions.*posterStorageKey.*thumbnailStorageKey.*null.*future read-only.*opaque.*durable desktop recipient binding.*no longer part of maintained durable binding identity.*not an editorial proxy or relink relationship/isu,
	);
	assert.match(documentation, /Genuine editorial video proxies remain future work/iu);
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
		({ id }) => id === 'audio-rendered-fallback-playback',
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
		'src/common/editor/project-feature-requirements.ts', 'src/common/editor/project-feature-video-clip-render-v1.ts',
		'src/common/editor/project-v9.ts',
		'src/common/editor/retention.js',
		'src/common/editor/scape-project-assets.ts',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-project.js',
		'src/common/editor/project-feature-capabilities.ts', 'src/common/editor/project-owned-feature-requirements.ts', 'src/common/editor/project-v12-validation.ts', 'src/common/editor/track-folder-v12.ts', 'src/common/editor/track-hierarchy-v12.ts', 'src/common/editor/track-folder-state-projection.ts', 'src/common/editor/track-folder-media-runtime.ts', 'src/common/editor/controller/playback-project-service.ts', 'src/common/editor/controller/video-export-service.ts', 'src/common/editor/controller/video-export-timing.ts', 'src/common/editor/video-export.js', 'src/common/editor/video-timeline.js',
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
		'tests/audio-editor-project-feature-video-clip-render-v1.test.ts',
		'tests/audio-editor-project-v9.test.ts',
		'tests/audio-editor-feature-requirement-retention.test.ts',
		'tests/audio-editor-scape-feature-requirements.test.ts',
		'tests/audio-editor-scape-export-fallback-integrity.test.ts',
		'tests/audio-editor-project-feature-capabilities.test.ts',
		'tests/audio-editor-project-owned-feature-requirements.test.ts', 'tests/audio-editor-project-v15.test.ts', 'tests/audio-editor-track-folder-state-projection.test.ts', 'tests/audio-editor-track-folder-media-runtime.test.ts',
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
	assert.match(control.summary, /schema 16.*create.*load.*clone.*commit.*reserved `soundscaper\.audio-effects`.*track.*group.*send.*master.*disabled.*inactive.*publisher-authored.*take precedence.*missing.*foreign.*do not trigger.*reserved-ID conflicts.*reject/iu);
	assert.match(control.summary, /same paths.*reserved `soundscaper\.video-effects`.*timeline.*Project Bin.*video clips.*disabled.*publisher-authored.*take precedence.*missing.*foreign.*non-video clips.*do not trigger.*reserved-ID conflicts.*reject/iu);
	assert.match(control.summary, /schema-16 nested track folders.*closed top-level metadata.*authoritative closed per-sequence nodes.*exact derived sequence trackIds.*track and folder preorder.*`soundscaper\.track-folders`.*`Nested track folders`.*`bypass`.*no fallback.*Soundscaper registers.*available with native folder commands and tree UI.*Framescaper registers it known but unavailable.*preserved read-only there.*absent from both rendered-fallback eligibility.*audio or video fallback.*reject.*before playback, audio render, video preview, or video export.*transient projection.*inherited folder mute, solo, and hidden.*leaf track flags.*before rendered-fallback.*privately authenticates.*marker.*forged marker.*before hierarchy traversal.*canonical folder state.*leaf-local flags.*routing.*history.*persistence unchanged.*collapsed and height.*UI-only/iu);
	assert.match(control.summary, /schema 16.*actual project history.*before activation.*intrinsically read-only.*deep-frozen.*session metadata clones.*snapshot.*future schemas.*null.*not traversed/iu);
	assert.match(control.summary, /same-ID tab.*stored read-only declaration.*ignored incoming.*flags/iu);
	assert.match(control.summary, /current-format \.scape inspection.*provider-owned.*caller.*override.*exact schema 16.*before.*collision lookup.*deep-frozen.*future schemas.*null.*not traversed/iu);
	assert.match(control.summary, /one.*decision.*no-collision.*open-read-only.*cancel.*combined.*copy-read-only.*cancel/iu);
	assert.match(control.summary, /cancel.*before.*import.*persistence.*activation.*actual project history.*intrinsically read-only/iu);
	assert.match(control.summary, /localized.*stable feature IDs.*declared disposition.*defaults? focus.*Cancel.*Escape/iu);
	assert.match(control.summary, /active workspace.*persistent.*non-dismissible.*document-level.*counts.*bounded display names.*stable feature IDs.*declared dispositions.*tab.*active/iu);
	assert.match(control.summary, /available items.*excluded.*evaluator messages.*fallback internals.*not read.*no activation controls.*runtime fallback.*third-party/iu);
	assert.match(control.summary, /exact schema 16.*registered `audioEffects`.*unavailable.*declared `bypass`.*effective `bypassed`.*bounded.*non-persisted.*engine projection.*before activation side effects.*canonical project.*history.*persistence.*unchanged/iu);
	assert.match(control.summary, /active.*enabled.*not already bypassed.*maintained first-party.*track.*group.*send.*master.*4,096.*params.*context.*state.*not read.*deep-frozen.*affected-object inventory.*localized.*no controls/iu);
	assert.match(control.summary, /unknown.*third-party.*rendered fallback.*offline render.*export.*activation controls.*outside/iu);
	assert.match(control.summary, /exact schema 16.*registered `videoEffects`.*unavailable.*declared `bypass`.*effective `bypassed`.*bounded.*non-persisted.*preview-playback projection.*before activation side effects.*canonical project.*history.*source loading.*persistence.*save paths.*offline render.*video export.*unchanged/iu);
	assert.match(control.summary, /enabled maintained first-party.*timeline.*Project Bin.*minimal disabled engine copies.*4,096.*256-character stable-ID.*128-character effect-type.*params.*context.*state.*opaque payloads.*not read/iu);
	assert.match(control.summary, /cached selector.*exact timeline clip-ID.*effect-ID.*effect-type.*before compositor rendering.*active-effect counting.*preserving unchanged stack references.*Project Bin.*not a compositor input/iu);
	assert.match(control.summary, /deep-frozen.*location.*clip ID.*effect ID.*effect type.*localized labels.*canonical clip ownership.*no controls.*future schemas.*before clip or Project Bin traversal/iu);
	assert.match(control.summary, /already-disabled.*foreign.*unknown.*third-party.*rendered fallback.*offline render.*export.*activation controls.*earlier Soundscaper project schemas.*outside this video slice/iu);
	assert.match(control.summary, /current-format.*exact schema 16.*fallback.*claim.*canonical asset descriptor.*before.*collision.*storage/iu);
	assert.match(control.summary, /export.*snapshot.*project root.*source records.*same sources.*toJSON rewrites.*hash.*before.*manifest.*commit.*import.*body.*SHA-256.*before.*publication/iu);
	assert.match(control.summary, /inspection.*descriptor binding.*does not hash.*asset bodies/iu);
	assert.match(control.summary, /separate maintained-controller admission.*exact-schema-16 raw and stored-project fallback bytes.*direct store loads.*runtime fallback substitution.*third-party/iu);
	assert.match(control.summary, /generic runtime fallback substitution.*generic unavailable-feature placeholders.*general per-feature activation controls.*outside/iu);
	for (const path of [
			'src/common/editor/project-fallback-integrity.ts', 'src/common/editor/project-fallback-integrity-audio.ts', 'src/common/editor/project-fallback-integrity-video.ts', 'src/common/editor/project-fallback-integrity-snapshot.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/storage/media-content-digest.ts',
		'src/common/editor/storage.js',
		'src/common/editor/storage/source-read-repository.ts',
		'src/common/editor/storage/source-repository.ts',
		'src/common/editor/storage/media-asset-load-repository.ts',
		'src/common/editor/storage/media-repository.ts',
			'src/common/editor/controller/project-switch-service.ts', 'src/common/editor/controller/audio-rendered-fallback-export.ts', 'src/common/editor/controller/video-rendered-fallback-export.ts',
		'src/common/editor/session-activation.js',
		'src/common/editor/session.js',
		'src/common/editor/app.js',
			'tests/audio-editor-project-fallback-integrity.test.ts', 'tests/audio-editor-project-fallback-integrity-relationships.test.ts', 'tests/audio-editor-project-fallback-integrity-mixed-selection.test.ts',
		'tests/audio-editor-source-read-cancellation.test.ts',
		'tests/audio-editor-media-asset-load.test.ts',
			'tests/audio-editor-project-switch-fallback-integrity.test.ts', 'tests/audio-editor-mixed-rendered-fallback-video-export.test.ts',
		'tests/audio-editor-session-project-activation.test.js',
	]) assert.ok(fallbackAdmission.evidence.some((item) => item.path === path), path);
	assert.match(
		fallbackAdmission.summary,
		/authoritative exact-schema-16.*same-ID tab history.*session-owned history token.*local bytes.*before activation side effects.*exclusive session activation reservation.*history replacement.*competing active-project publication.*session publication.*released in finally.*audio-f32le-chunks-v1.*65,536-chunk.*video.*immutable original-media Blob.*4 MiB.*64 GiB.*before fallback body reads/iu,
	);
	assert.match(fallbackAdmission.summary, /Admission reads publish no storage maintenance/iu);
	assert.match(fallbackAdmission.summary, /sequential.*cooperatively cancellable.*read-only video-metadata.*raced against cancellation.*signal-ignoring provider.*continue after admission rejects.*provider-stalled fallback body read.*delay cancellation settlement.*iterator cleanup/iu);
	assert.match(fallbackAdmission.summary, /deduplicates.*conflicting digests.*relationship roles.*target clip or track IDs.*before storage reads/iu);
	assert.match(fallbackAdmission.summary, /video selector.*currentness snapshot.*role.*target clip ID.*source ID.*SHA-256.*source geometry.*drift.*before media use/iu);
	assert.match(
		fallbackAdmission.summary,
			/future schemas.*no asset read.*joint final-video admission.*one audio.*one video selector.*cumulative.*before.*body reads.*operation-time full-source verification.*bounded per-chunk digest table.*private provider.*currentness.*geometry.*digest.*selected video delivery.*immutable Blob.*both selector identities.*activation admission remains point-in-time.*operation-scoped per-read validation.*durable storage-record lease.*cross-process immutability.*direct store\.loadProject.*publisher authenticity.*relationship roles beyond the closed audio and maintained video roles.*simultaneous.*beyond.*one-audio.one-video.*linked-only.*unmanaged.*discover, load, or execute third-party feature code.*future schemas.*placeholder.*bypass.*third-party activation gating/iu,
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
		/exact schema 16.*canonical namespaced feature ID.*unavailable or unknown.*declared and effective rendered-fallback.*closed project-audio-mix-v1 role.*canonical manifest.*mono or stereo.*whole-mix.*frame zero.*removes canonical audio.*neutral.*mixer and master.*retains video and label/iu,
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
		/engine\.applyProject or activation engine callback.*not abortable or transactional.*may have taken effect.*post-call publication-boundary assertion.*blocks shared publication.*later activation step.*successful engine and shared source publication.*not rolled back.*ordinary-source loading.*outside.*required-source publication transaction.*short-buffer retention.*cache-fit policy.*streamed chunks.*not prefetched or revalidated/iu,
	);

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(documentation, /feature-requirements manifest.*deep-frozen/iu);
	assert.match(documentation, /do(?:es)? not hash or authenticate the referenced media bytes/iu);
	assert.match(documentation, /current-schema.*current-format `\.scape`.*preserve.*manifest.*fallback-only source assets.*collision remapping/iu);
	assert.match(documentation, /stable.*product capability registry.*strict `true`.*unregistered IDs.*unknown/iu);
	assert.match(documentation, /schema 16.*create.*load.*clone.*commit.*`soundscaper\.audio-effects`.*track.*group.*send.*master.*disabled.*inactive.*publisher-authored.*take precedence.*missing.*foreign.*do not trigger.*reserved-ID conflicts.*reject/iu);
	assert.match(documentation, /same paths.*`soundscaper\.video-effects`.*timeline.*Project Bin.*video clips.*disabled.*publisher-authored.*take precedence.*missing.*foreign.*non-video clips.*do not trigger.*reserved-ID conflicts.*reject/iu);
	assert.match(documentation.replace(/\s+/gu, ' '), /schema 16.*nested track folders.*closed top-level metadata.*authoritative closed per-sequence nodes.*trackIds.*track and folder preorder.*soundscaper\.track-folders.*Nested track folders.*bypass.*no fallback.*Soundscaper registers its capability available.*folder-aware commands.*tree UI.*Framescaper registers it known but unavailable.*preserving nonempty state read-only.*excluded from audio and video fallback.*rejects.*manifest admission.*before playback.*audio.*render.*video preview.*video export.*transient projection.*inherited folder mute.*solo.*hidden state.*leaf track flags.*before rendered-fallback.*authenticates.*marker.*forged marker.*before hierarchy traversal.*canonical folder state.*leaf-local flags.*routing.*history.*persistence.*remain unchanged.*collapsed and height.*UI-only/isu);
	assert.match(documentation, /schema 16.*actual project history.*before activation.*intrinsically read-only.*deep-frozen.*session metadata clones.*snapshot.*future schemas.*`null`.*not traversed/iu);
	assert.match(documentation, /same-ID tab.*stored read-only declaration.*ignored incoming.*flags/iu);
	assert.match(documentation, /active workspace.*persistent.*non-dismissible.*document-level.*counts.*bounded display names.*stable feature IDs.*declared dispositions.*tab.*active/iu);
	assert.match(documentation, /available items.*excluded.*evaluator messages.*fallback internals.*not read.*no activation controls.*feature-code-loading claim/iu);
	assert.match(documentation, /exact schema 16.*registered `audioEffects`.*unavailable.*declared `bypass`.*effective `bypassed`.*bounded.*non-persisted.*engine projection.*before activation side effects.*canonical project.*history.*persistence.*unchanged/iu);
	assert.match(documentation, /active.*enabled.*not already bypassed.*maintained first-party.*track.*group.*send.*master.*4,096.*does not read.*params.*context.*state.*deep-frozen.*localized.*noninteractive affected-object inventory/iu);
	assert.match(documentation, /unknown.*third-party.*rendered fallback.*offline render.*export.*activation controls.*outside/iu);
	assert.match(documentation, /exact schema 16.*registered `videoEffects`.*unavailable.*declared `bypass`.*effective `bypassed`.*bounded.*non-persisted.*preview-playback projection.*before activation side effects.*canonical project.*history.*source loading.*persistence.*save paths.*video export.*unchanged/iu);
	assert.match(documentation, /enabled maintained first-party.*timeline.*Project Bin.*minimal disabled copies.*4,096.*256-character stable-ID.*128-character effect-type.*does not read.*params.*context.*state.*opaque payloads/iu);
	assert.match(documentation, /deep-frozen.*Timeline or Project Bin.*location.*clip ID.*effect ID.*effect type.*localized.*control-free/iu);
	assert.match(documentation, /cached selector.*exact timeline.*clip ID.*effect ID.*effect type.*compositor rendering.*active-effect counting.*Project Bin.*not.*compositor/iu);
	assert.match(documentation, /future schemas.*before clip or Project Bin traversal.*unknown.*third-party.*rendered fallback.*offline render.*export.*activation controls.*outside/iu);
	assert.match(documentation, /current-format `\.scape` inspection.*provider-owned.*caller.*override.*schema 16.*before.*collision lookup.*deep-frozen.*future schemas.*`null`.*not traversed/iu);
	assert.match(documentation, /no-collision.*Open read-only.*Cancel.*combined.*Open as read-only copy.*single decision/isu);
	assert.match(documentation, /Cancel.*before import, persistence, or activation.*controller.*actual project history.*intrinsically read-only/isu);
	assert.match(documentation, /current-format.*exact schema 16.*fallback.*claim.*asset descriptor.*before.*collision.*storage/iu);
	assert.match(documentation, /export.*project root.*source records.*same sources.*accessors.*`toJSON` hooks.*without invocation.*hash.*before.*manifest.*commit.*import.*body.*SHA-256.*publication/iu);
	assert.match(documentation, /inspection.*does not hash.*asset bodies.*maintained exact-schema-16 controller activation.*referenced local audio and video fallback bytes/iu);
	assert.match(documentation, /Admission reads publish no storage maintenance/iu);
	assert.match(documentation, /read-only video-metadata preflight.*raced against cancellation.*signal-ignoring provider.*continue after admission rejects.*fallback body read.*delay cancellation settlement/iu);
	assert.match(documentation, /direct `store\.loadProject\(\)` calls.*durable integrity after admission.*runtime fallback use by activation admission itself.*future-schema.*outside.*runtime selection.*playback controls.*operation-time-verified final-delivery controls/iu);
	assert.match(documentation, /point-in-time admission.*complete third-party activation gating/iu);
	assert.match(documentation, /role-defined audio rendered-fallback playback.*exact schema 16.*canonical namespaced feature ID.*unavailable or unknown.*declared and effective `rendered-fallback`.*closed `project-audio-mix-v1` role.*opaque identity.*does not discover, load, or execute.*feature code.*whole-mix.*frame zero.*canonical project.*unchanged/isu);
	assert.match(documentation, /stored metadata.*rechecked.*short sources.*buffer geometry.*oversized sources.*streamable chunk provider.*does not prefetch or revalidate.*later provider failure/isu);
	assert.match(documentation, /initial activation.*privately stages only the required fallback source.*before.*session activation reservation.*activation side effects.*decoded buffer or stream-provider candidate.*outside shared `sourceBuffers`.*shared `sourceChunkProviders`.*engine chunk-source publication.*pre-reservation phase.*metadata.*audio-context.*decoded-body.*controller-lifetime signal.*exact reason.*late settlement.*buffers.*chunk providers.*engine chunk sources.*missing-source state.*status/isu);
	assert.match(documentation, /readiness or reservation failure.*discards.*active project.*tab.*lock.*prior shared source identities.*rechecks fallback admission.*session-owned history identity.*before reserving.*currentness checks.*engine entry.*shared publication.*ordinary loading.*excludes.*staged fallback source/isu);
	assert.match(documentation, /commit builds private buffer and provider snapshots.*current shared state.*ordinary transient buffers.*staged required source.*precedence.*conflicting transient.*engine.*private snapshots first.*after.*callback returns.*checks the signal.*owning admission or canonical-project identity assertion.*synchronously.*publication boundary.*no await intervenes.*required buffer or provider.*mutates shared state/isu);
	assert.match(documentation, /engine failure.*cancellation.*reservation or currentness failure.*publication-boundary identity failure.*throwing cache publication.*preserve.*prior shared identities.*cache refusal.*removes.*stale required representation.*commit ownership.*single-use.*discard.*idempotent/isu);
	assert.match(documentation, /each canonical playback reapply.*replaceable controller-lifetime task.*newer reapply.*successful project switch.*abort.*metadata.*audio-context.*decoded-body.*exact reason.*late settlement.*buffer.*provider.*engine.*missing-source.*status.*only the newest source-ready projection.*engine/isu);
	assert.match(documentation, /not a durable byte lease.*`engine\.applyProject` or activation engine callback.*not abortable or transactional.*may have taken effect.*post-call publication-boundary assertion.*blocks shared publication.*later activation step.*successful engine and shared source publication.*not rolled back.*ordinary-source loading.*outside.*required-source publication transaction.*short-buffer retention.*cache-fit policy.*streamed chunks.*not prefetched or revalidated.*more than one.*feature identities.*non-audio roles.*fallback authoring.*freeze or proxy.*linked-only or unmanaged.*publisher authenticity.*third-party feature-code activation.*future schemas.*earlier Soundscaper schemas.*packaged runtime or UI.*browser.*reference-scale/isu);
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
		/raw-JSON structural preflight.*every schema.*before `JSON\.parse`.*101,536 JSON values.*depth 130.*exact schema 16.*decoded.*semantic validator.*independent ceilings.*100,000 logical nodes.*depth 128/iu,
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
		/shared-project-parse-budget.*remains open.*101,536-value\/depth-130 raw preflight.*per-phase 100,000-node\/depth-128 exact-V16 decode and validator admissions.*do not combine.*end-to-end work budget.*CPU or elapsed time.*cancellation.*allocation.*total main-process RSS/isu,
	);

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
		/16 outstanding product-wide targets.*4 pending or live sessions.*65 GiB per-save and aggregate admitted bytes.*synchronously.*before the first await.*lower-only.*bigint `statfs`.*available.*before staging open.*point-in-time.*not an operating-system reservation.*cleanup failure.*charged.*ENOSPC or EDQUOT.*qualified typed refusal.*staged temporary file is discarded.*admitted count and bytes release.*committed target file survives.*commit-time space failure cleans staging.*other write failures keep the session open/iu,
	);
	for (const path of [
		'desktop/constants.js', 'desktop/preload.mjs',
		'desktop/save-targets.js', 'desktop/save-space.js',
		'tests/desktop-save-capacity.test.js', 'tests/desktop-save-space-exhaustion.test.js',
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

});

async function readMatrix() {
	return JSON.parse(await readFile(matrixUrl, 'utf8'));
}
