/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertOrderedClaim } from './helpers/ordered-evidence-claim.js';

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
			if (control.policyAuthority === 'historical-provenance-only') {
				assert.match(control.summary, /preserves pre-freeze.*no family-v1.*authority/iu);
				assert.equal(
					control.historicalPreFreezeNarrative?.status,
					'provenance-only-not-runtime-authority',
				);
				continue;
			}
			assert.equal(control.policyAuthority, 'family-v1-active', `${risk.id}/${control.id}`);
			assert.doesNotMatch(
				control.summary,
				/\b(?:S(?:2[1-9]|30)|F(?:1[89]|2\d|3[0-2]))\b|schema(?:Version)?[- ]?(?:1[5-9]|2\d|3[0-2])/u,
				`${risk.id}/${control.id} cites retired project authority`,
			);
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
	assert.match(documentation, /native plug-ins? execute arbitrary code.*exact per-OS launcher.*rather than.*same-UID/isu);
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
		/8,589,930,860.*9,448,923,946-byte.*before its media writer/isu,
		/does not reserve capacity.*real browser or filesystem quota accuracy.*durable 8 GiB.*overhead.*policy headroom.*write-time success.*concurrent writers/isu,
	]) assertOrderedClaim(documentation, claim);
	for (const claim of [
		/inspection refusal witness.*schema-9.*exact 8 GiB sparse Zip64 `?\.scape`? fixture.*read-capability store.*protocol handler.*renderer adapter.*structural inspection.*typed re-import error.*before any collision lookup.*less than 8 MiB.*65,557-byte suffix.*does not hash/isu,
		/authentic exact 8 GiB fixture.*8,589,930,860-byte.*SHA-256.*29fe8d0dc2c84f17f76b0a8a896c33042d832681351f0798a523dcbf72c49942.*CRC-32.*1,816,305,334.*`?checkSignature: true`?.*negative rollback/isu,
		/full-import witness.*real read-capability store.*Node protocol handler shim.*renderer adapter.*file service.*project service.*full import.*independent counting-SHA-256.*zero payload retention.*point-in-time capacity estimate.*precedes the media writer.*9,448,923,946.*no Blob materialization.*capability release.*exactly once.*pinned handle close.*exactly once/isu,
		/verified reference evidence.*opt-in.*`npm run test:reference:scape-8gib`.*routine Node.*coverage.*fast-skip.*measured all-files coverage.*passed.*525 seconds.*does not demote.*refusal inspection.*corrupted-CRC negative rollback.*routine coverage.*sparse-file support.*Node protocol shim.*(?:not|rather than) packaged UI/isu,
		/OPFS.*IndexedDB.*durable.*real production browser or filesystem quota accuracy.*reservation.*write-time success.*concurrent writers.*browser heap.*process RSS.*whole-storage atomicity.*publisher authentication/isu,
	]) assertOrderedClaim(documentation, claim);
	assert.match(
		documentation,
		/shared-desktop-project-library-integrity.*current authority is product-isolated.*Soundscaper and Framescaper desktop libraries.*family-v1 handshakes.*library schema 1.*SQLite user_version 1.*distinct kw\.media.*project-library\/v1 roots.*SSCP and FSCP application IDs.*schemaFamily and schemaVersion.*disjoint product:v1:project-library.*pre-release roots.*untouched and invisible.*no migration or copy-forward marker.*Historical pre-freeze provenance.*grants no current project, migration, storage, IPC, or package authority/isu,
	);
	assert.match(
		documentation,
		/family-qualified handshake.*current fenced lease.*only the current lease may publish.*immutable bodies.*digest-bound.*recovery roots.*before host exposure/isu,
	);
	assert.match(
		documentation,
		/Version-bearing S21–S30, F18–F32.*historical implementation provenance.*not runtime, migration, storage, or packaging authorities/isu,
	);
	assert.match(
		documentation,
		/Historical pre-freeze provenance.*shared-library description.*grants no current project, migration, storage, IPC, or package authority/isu,
	);
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
		'tests/audio-editor-video-derivative-binding.test.ts',
		'tests/audio-editor-video-derivative-publication-fence.test.ts',
		'tests/audio-editor-storage-records.test.ts',
		'tests/audio-editor-derivative-cache-consistency.test.ts',
		'tests/audio-editor-derivative-cache-paging.test.ts',
		'tests/audio-editor-source-import.test.ts',
		'tests/audio-editor-project-bin.test.js',
		'tests/audio-editor-scape-project.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), `Missing preview-cache evidence from ${path}`);
	assert.match(
		control.summary,
		/repository-trusted current SHA-256.*media-content token.*content-addressed key.*original storage key and digest.*poster\/thumbnail type.*normalized non-negative source time.*versioned recipe.*revalidates.*original digest\/token.*before publication.*atomically publishes.*payload and scalar companion.*failed publication.*staged OPFS output.*load.*current original.*payload\/companion.*match.*output size and SHA-256.*different original generation.*cache miss.*digest is unchanged.*legacy or unbound.*miss.*malformed pairs.*reject.*exact deletion.*media-asset cascade.*payload.*match.*scalar companion.*before any row.*deleted.*paths re-projected from validated payloads.*after commit.*mismatch aborts.*without OPFS disposal.*corrupt companion path.*cannot delete an unrelated original.*explicit recipe deletion selector.*normalized recipe ID\/version.*omitted recipe.*all revisions.*null.*posterStorageKey.*thumbnailStorageKey.*future read-only.*opaque.*desktop recipient binding.*excludes legacy locator.*no longer part of maintained durable binding identity.*not an editorial video proxy or relink relationship/iu,
	);
	const decoderResidual = mediaRisk?.residualRisks.find(({ id }) => id === 'compressed-media-corpus');
	assert.ok(decoderResidual);
	assert.match(
		decoderResidual.exposure,
		/dedicated audio WebAssembly.*WebCodecs.*Mediabunny.*decoders.*heap.*RSS.*GC.*qualification/isu,
	);

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	const normalizedDocumentation = documentation.replace(/\s+/gu, ' ');
	assert.match(
		normalizedDocumentation,
		/original-bound-disposable-video-preview-cache.*repository-trusted current SHA-256.*media-content token.*content-addressed key.*original storage key and digest.*poster or thumbnail type.*normalized non-negative source time.*versioned recipe.*revalidates.*immediately before publication.*payload and scalar companion.*failed publication.*staged OPFS output.*output size and SHA-256.*older original generation.*cache miss.*same digest.*malformed pair or binding.*reject.*legacy or unbound.*cache misses.*exact derivative deletion.*media-asset cascade.*full agreement.*scalar companion.*before deleting any row.*paths re-projected from validated payloads.*after the transaction commits.*mismatch.*without disposing any OPFS path.*corrupt companion path.*cannot delete an unrelated.*recipe.*normalized recipe ID and version.*omitting the recipe.*all revisions.*posterStorageKey.*thumbnailStorageKey.*null.*future read-only.*opaque.*durable desktop recipient binding.*no longer part of maintained durable binding identity.*not an editorial proxy or relink relationship/isu,
	);
	assertOrderedClaim(documentation, /selected Framescaper V27 activation\s+candidate locally implements.*general editorial proxy lifecycle.*Guided-local sign-off.*resource\s+qualification.*external qualification remain open/isu);
});

test('project identities fail closed before traversal and expose no predecessor route', async () => {
	const matrix = await readMatrix();
	const boundary = matrix.boundaries.find(({ id }) => id === 'external-input-to-parser');
	const projectDocuments = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	const control = projectDocuments?.currentControls.find(
		({ id }) => id === 'project-schema-and-forward-read-validation',
	);

	assert.ok(boundary);
	assert.ok(projectDocuments);
	assert.equal(projectDocuments.status, 'partial');
	assert.equal(projectDocuments.releaseDisposition, 'conditional');
	assert.ok(control);
	assert.equal(control.policyAuthority, 'family-v1-active');

	const evidence = new Set(control.evidence.map(({ path }) => path));
	for (const path of [
		'src/common/editor/project-schema-identity.ts',
		'src/common/editor/project-current-runtime.ts',
		'src/common/editor/scape-archive-envelope.ts',
		'src/common/editor/scape-archive-copy.ts',
		'src/soundscaper/editor-project.ts',
		'src/soundscaper/editor-project-validation.ts',
		'src/framescaper/editor-project-runtime.ts',
		'tests/audio-editor-project-schema-identity.test.ts',
		'tests/audio-editor-scape-v1-baseline.test.ts',
	]) assert.equal(evidence.has(path), true, path);

	const activeRecord = JSON.stringify({ boundary, control });
	assert.doesNotMatch(activeRecord, /migration\.js|project-v\d+|schema-?(?:1[5-9]|2\d|3[0-2])\b/iu);
	for (const risk of matrix.risks) for (const candidate of risk.currentControls) {
		if (candidate.policyAuthority !== 'family-v1-active') continue;
		assert.doesNotMatch(
			candidate.summary,
			/(?:Soundscaper-to(?:-fresh)?-Framescaper|Framescaper-to(?:-fresh)?-Soundscaper|less-capable recipient)/iu,
			`${risk.id}/${candidate.id} cites a retired cross-family semantic workflow`,
		);
	}
	assert.match(control.summary, /own enumerable data properties.*schemaFamily.*soundscaper.*framescaper.*schemaVersion.*positive safe integer/isu);
	assert.match(control.summary, /exact family v1.*other known family.*later version.*opaque read-only custody.*without domain traversal/isu);
	assert.match(control.summary, /numeric-only.*REIMPORT_REQUIRED.*unknown.*malformed.*accessor-backed.*manifest\/root-disagreeing.*before project traversal, asset reads, or persistence/isu);
	assert.match(control.summary, /Format-1 Scape inspection.*tuple.*before any body read/isu);
	assert.match(control.summary, /no project migration, copy-forward, predecessor-validator dispatch.*family inferred from a bare number, suffix, feature wire, or native protocol version/isu);

	for (const path of [
		'src/common/editor/project-schema-identity.ts',
		'src/soundscaper/editor-project-validation.ts',
		'src/framescaper/editor-project-runtime.ts',
	]) assert.equal(boundary.entryPoints.includes(path), true, path);
	assert.equal(boundary.entryPoints.some((path) => /migration\.js|project-v\d+/u.test(path)), false);

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	const normalizedDocumentation = documentation.replace(/\s+/gu, ' ');
	assert.match(normalizedDocumentation, /1\.0 project-identity boundary.*schemaFamily:'soundscaper'.*schemaVersion:1.*schemaFamily:'framescaper'.*schemaVersion:1/isu);
	assert.match(normalizedDocumentation, /no project migration, copy-forward, predecessor-validator dispatch/isu);
	assert.match(normalizedDocumentation, /Fallback admission.*owning family-v1 identity.*same family.*foreign-family archive never enters those domain controls.*byte-exact Save Copy/isu);
	assert.match(normalizedDocumentation, /stable 1\.0.*blocked/isu);
});

async function readMatrix() {
	return JSON.parse(await readFile(matrixUrl, 'utf8'));
}
