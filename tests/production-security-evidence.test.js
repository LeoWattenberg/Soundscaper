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
		/desktop-read-path-capabilities.*enforced for the current bounded materialization surface.*512 MiB.*preload.*renderer materializer.*exact declared `Content-Length`.*emitted-byte.*final `Blob`-size.*response body stream.*16 MiB.*platform media-chunk limit.*caller-supplied `AbortSignal`.*stalled body read.*exact reason.*never calls `response\.blob\(\)`.*scoped descriptor.*protocol request abort.*whole `Blob`.*not decoder amplification or whole-process RSS.*larger range-backed reads.*fail admission/isu,
	);
	assert.match(
		documentation,
		/bounded desktop materializer.*forwards a supplied signal.*releases its capability on abort.*open.*import orchestration does not consistently own or provide that signal/isu,
	);
});

test('project feature requirements are bounded and fail closed at activation and pre-open inspection', async () => {
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
	for (const path of [
		'src/common/editor/migration.js',
		'src/common/editor/project-feature-requirements.ts',
		'src/common/editor/project-v9.ts',
		'src/common/editor/retention.js',
		'src/common/editor/scape-project.js',
		'src/common/editor/project-feature-capabilities.ts',
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
		'src/common/editor/app.js',
		'tests/audio-editor-project-feature-requirements.test.ts',
		'tests/audio-editor-project-v9.test.ts',
		'tests/audio-editor-feature-requirement-retention.test.ts',
		'tests/audio-editor-scape-feature-requirements.test.ts',
		'tests/audio-editor-project-feature-capabilities.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-session.test.js',
		'tests/audio-editor-document-snapshot.test.ts',
		'tests/audio-editor-scape-inspection-service.test.ts',
		'tests/audio-editor-scape-project-file-service.test.ts',
		'tests/audio-editor-scape-open-request-service.test.ts',
		'tests/audio-editor-scape-open-decision-continuation.test.ts',
		'tests/audio-editor-scape-open-decision-dialog.test.ts',
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
	assert.match(control.summary, /schema 9.*actual project history.*before activation.*intrinsically read-only.*deep-frozen.*session metadata clones.*snapshot.*future schemas.*null.*not traversed/iu);
	assert.match(control.summary, /same-ID tab.*stored read-only declaration.*ignored incoming.*flags/iu);
	assert.match(control.summary, /current-format \.scape inspection.*provider-owned.*caller.*override.*exact schema 9.*before.*collision lookup.*deep-frozen.*future schemas.*null.*not traversed/iu);
	assert.match(control.summary, /one.*decision.*no-collision.*open-read-only.*cancel.*combined.*copy-read-only.*cancel/iu);
	assert.match(control.summary, /cancel.*before.*import.*persistence.*activation.*actual project history.*intrinsically read-only/iu);
	assert.match(control.summary, /localized.*stable feature IDs.*declared disposition.*defaults? focus.*Cancel.*Escape/iu);
	assert.match(control.summary, /does not verify referenced fallback bytes/iu);
	assert.match(control.summary, /does not.*provide.*runtime fallback use.*post-open.*placeholder.*bypass/iu);

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(documentation, /feature-requirements manifest.*deep-frozen/iu);
	assert.match(documentation, /does not hash or authenticate the referenced media bytes/iu);
	assert.match(documentation, /current-schema.*current-format `\.scape`.*preserve.*manifest.*fallback-only source assets.*collision remapping/iu);
	assert.match(documentation, /stable.*product capability registry.*strict `true`.*unregistered IDs.*unknown/iu);
	assert.match(documentation, /schema 9.*actual project history.*before activation.*intrinsically read-only.*deep-frozen.*session metadata clones.*snapshot.*future schemas.*`null`.*not traversed/iu);
	assert.match(documentation, /same-ID tab.*stored read-only declaration.*ignored incoming.*flags/iu);
	assert.match(documentation, /current-format `\.scape` inspection.*provider-owned.*caller.*override.*schema 9.*before.*collision lookup.*deep-frozen.*future schemas.*`null`.*not traversed/iu);
	assert.match(documentation, /no-collision.*Open read-only.*Cancel.*combined.*Open as read-only copy.*single decision/isu);
	assert.match(documentation, /Cancel.*before import, persistence, or activation.*controller.*actual project history.*intrinsically read-only/isu);
	assert.match(documentation, /do not qualify.*runtime fallback use.*post-open.*placeholder.*bypass/iu);
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
		/legacy `?\.aup`? XML.*canonical, default-sized simple\/silent `?_data`?.*structural.*referenced-input.*block-geometry.*retained-PCM.*indexed-lookup.*parser-owned pending-window.*other supported project.*elapsed-time.*clon.*aliases.*customized Audacity block sizes.*provider-internal.*downstream.*garbage-collection lag.*total renderer RSS.*cancellation.*streaming-scale/iu,
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
		/prove refusal before conversion.*project\/source persistence.*imported-project publication/isu,
	);
	assert.match(
		roadmap,
		/default-sized blocks.*customized Audacity.*unsupported.*(?:still|also)\s+leaves.*elapsed\s+time.*aliases.*garbage-collection lag.*total renderer\s+RSS.*streaming-scale/isu,
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
