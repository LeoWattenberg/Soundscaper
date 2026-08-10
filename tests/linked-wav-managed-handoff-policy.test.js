/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const compatibilityUrl = new URL('../config/project-compatibility.json', import.meta.url);
const compatibilityDocumentUrl = new URL('../docs/project-compatibility.md', import.meta.url);
const securityUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('linked PCM portability and handoff stay canonical and point-in-time', async () => {
	const policy = await readJson(compatibilityUrl);
	const portable = requiredRule(policy.rules, 'current-linked-pcm-portable-archive');
	const handoff = requiredRule(policy.rules, 'current-desktop-linked-pcm-managed-handoff');
	assert.equal(portable.status, 'implemented');
	assert.equal(handoff.status, 'implemented');
	assert.equal(policy.rules.some(({ id }) => id === 'current-linked-wav-portable-archive'), false);
	assert.equal(policy.rules.some(({ id }) => id === 'current-desktop-linked-wav-managed-handoff'), false);

	for (const rule of [portable, handoff]) assertMaintainedAiffProfile(
		`${rule.requiredOutcome} ${rule.currentBehavior}`,
	);
	assert.match(
		portable.requiredOutcome,
		/512 MiB.*sender.*no owned PCM.*canonical `audio-f32le-chunks-v1`.*no locator identity.*external container bytes.*fresh portless recipient.*owned canonical PCM.*durable reopen/iu,
	);
	assert.match(
		portable.currentBehavior,
		/whole source snapshot.*exact-revision range capability.*sequential SHA-256.*at-most-4-MiB.*recheck.*binding.*without another whole-original `Blob`.*external BW64, AIFF, or AIFF-C container.*absent.*zero linked bindings.*close and reopen.*exact samples/iu,
	);
	assert.match(
		handoff.requiredOutcome,
		/point-in-time.*512 MiB.*main-private.*pathless.*whole source snapshot.*exact-revision range capability.*full sequential SHA-256.*at-most-4-MiB.*without another whole-original `Blob`.*no owned PCM body.*two full source-API passes.*fresh recipient.*without the original locator.*external container.*must not enter.*catalog/iu,
	);
	assert.match(
		handoff.currentBehavior,
		/`linked-audio-range-v1`.*exact locator revision.*at-most-4-MiB `206`.*read session.*release.*`prepareHandoff`.*two canonical Float32 PCM source-API passes.*fresh recipient.*reopens.*without a linked-original port.*not content-frozen.*cross-process snapshot/iu,
	);
	assert.match(
		handoff.currentBehavior,
		/provider-owned stable PCM\s+read session.*one full-container digest,? and one parsed descriptor.*serialized random\s+or sequential chunk reads.*complete alias group.*exact\s+binding.*before and after.*per-read.*cancellation.*local.*provider replacement.*failed activation.*project switch.*deletion.*clear.*rollback.*controller.*store.*exact-once release.*backing cleanup/iu,
	);
	assert.match(
		handoff.requiredOutcome,
		/binding-backed.*Project Bin relink.*exactly one audio source.*must not depend on missing-source state.*exact content by default.*changed content.*explicit localized confirmation.*same maintained container identity.*exact frame count, channel count, sample rate, and original sample rate.*measured replacement byte length and SHA-256.*consumers and provider.*drain.*before.*binding-and-provisional-root compare-and-swap.*preserve project, source, clip, and history identity.*bounded.*alias-aware startup reconciliation/isu,
	);
	assert.match(
		handoff.currentBehavior,
		/eligibility.*current audio binding.*even when.*not missing.*classif.*byte length and SHA-256.*exact project and project revision.*changed choice.*localized confirmation.*structural probe.*before.*timeline transport.*Project Bin preview.*provider.*(?:retire|drain).*same maintained MIME and file identity.*exact frame count, channel count, sample rate, and original sample rate.*old binding and platform snapshot.*current.*candidate.*exact locator revision.*measured byte length and SHA-256.*synchronous.*assertCanPublish.*same compensated memory batch or IndexedDB.*binding-and-provisional-root CAS.*invalidate.*source buffer.*peaks.*waveform.*analysis.*displaced old locator.*startup reconciliation/isu,
	);
	assertLinkedAudioTargetAndRecovery(`${handoff.requiredOutcome} ${handoff.currentBehavior}`);
	for (const text of [portable.currentBehavior, handoff.currentBehavior]) {
		assert.match(text, /AIFF metadata preservation.*third-party AIFC interoperability/iu);
		assert.match(text, /packaged executable or UI.*operating-system/iu);
		assert.match(text, /reference-scale/iu);
		assert.match(text, /durable immutable byte lease/iu);
	}
	for (const path of [
		'src/common/editor/aiff-pcm-chunk-reader.ts',
		'src/common/editor/controller/linked-audio-import-admission.ts',
		'src/common/editor/storage/linked-audio-original-source-reader.ts',
		'tests/audio-editor-aiff-pcm-chunk-reader.test.ts',
		'tests/audio-editor-linked-wav-import.test.ts',
		'tests/audio-editor-linked-audio-range-source-reader.test.ts',
		'tests/audio-editor-linked-audio-scape-roundtrip.test.ts',
	]) assert.ok(portable.evidence.includes(path) || handoff.evidence.includes(path), path);
	assert.ok(handoff.evidence.includes('tests/desktop-project-library-managed-audio-handoff.test.ts'));
	for (const path of [
		'src/common/editor/app.js',
		'src/common/editor/controller/action-facade.ts',
		'src/common/editor/controller/clip-time-pitch-service.ts',
		'src/common/editor/controller/audio-relink-probe.ts',
		'src/common/editor/controller/project-bin-linked-audio-relink-service.ts',
		'src/common/editor/controller/project-bin-linked-original-relink-task.ts',
		'src/common/editor/controller/project-bin-service.ts',
		'src/common/editor/controller/project-bin-types.ts',
		'src/common/editor/controller/project-lock-service.ts',
		'src/common/editor/controller/project-admin-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/controller/source-audio.ts',
		'src/common/editor/controller/source-chunk-provider-registry.ts',
		'src/common/editor/controller/source-lifecycle-service.ts',
		'src/common/editor/storage/linked-original-pair-writer.ts',
		'src/common/editor/storage/linked-original-provisional-root.ts',
		'src/common/editor/storage/project-store-defaults.ts',
		'src/common/editor/storage/source-pcm-read-session.ts',
		'src/common/editor/ui/workspace/ProjectBinPanel.jsx',
		'src/common/editor/ui/workspace/linked-audio-choice-handoff.ts',
		'tests/audio-editor-controller-action-facade.test.ts',
		'tests/audio-editor-clip-time-pitch-service.test.ts',
		'tests/audio-editor-audio-relink-probe.test.ts',
		'tests/audio-editor-linked-audio-original-relink.test.ts',
		'tests/audio-editor-linked-audio-choice-handoff.test.ts',
		'tests/audio-editor-linked-audio-project-bin-ui.test.ts',
		'tests/audio-editor-linked-source-controller-disposal.test.js',
		'tests/audio-editor-project-bin-linked-audio-relink-service.test.ts',
		'tests/audio-editor-project-bin-linked-audio-changed-relink.test.ts',
		'tests/audio-editor-project-bin-service.test.ts',
		'tests/audio-editor-project-lock-service.test.ts',
		'tests/audio-editor-project-admin-service-coverage.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-source-audio.test.ts',
		'tests/audio-editor-source-chunk-provider-registry.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
	]) assert.ok(handoff.evidence.includes(path), path);
});

test('linked PCM desktop security controls preserve the maintained AIFF profiles', async () => {
	const matrix = await readJson(securityUrl);
	const archiveRisk = requiredRisk(matrix.risks, 'scape-archive-structure-integrity');
	const readRisk = requiredRisk(matrix.risks, 'desktop-read-path-capabilities');
	const libraryRisk = requiredRisk(matrix.risks, 'shared-desktop-project-library-integrity');
	const portability = requiredControl(archiveRisk, 'linked-pcm-canonical-portability');
	const range = requiredControl(readRisk, 'owner-scoped-linked-audio-range-lifecycle');
	const handoff = requiredControl(libraryRisk, 'point-in-time-linked-pcm-managed-handoff');

	assert.equal(archiveRisk.status, 'enforced');
	assert.equal(libraryRisk.status, 'partial');
	for (const control of [portability, range, handoff]) assertMaintainedAiffProfile(control.summary);
	assert.match(
		range.summary,
		/pathless DTO.*exact locator revision.*128 capabilities.*64 GiB.*512 MiB per file.*16 active (?:range )?requests.*4 MiB per response.*exact closed ranges.*binding and CAS fence.*without another whole-original Blob.*release once/iu,
	);
	assert.match(
		range.summary,
		/provider-owned stable PCM\s+read session.*one full-container digest,? and one parsed descriptor.*serialized random\s+or sequential chunk reads.*complete alias group.*exact\s+binding.*before and after.*per-read.*cancellation.*local.*provider retirement.*terminal.*exact-once release.*backing cleanup.*aggregate/iu,
	);
	assert.match(
		handoff.summary,
		/main-private.*pathless point-in-time binding.*no owned PCM body.*whole external container.*exact digest.*canonical geometry.*two canonical Float32 PCM passes.*fresh recipient.*without the original locator.*source-container bytes.*locator identity.*never cross/iu,
	);
	assert.match(
		handoff.summary,
		/binding-backed.*Project Bin relink.*exactly one audio source.*does not use missing-source state.*classif.*byte length and SHA-256.*exact project and project revision.*changed choice.*localized confirmation.*structural probe.*before.*timeline transport.*Project Bin preview.*(?:provider.*drain|drain.*provider).*same maintained MIME and file identity.*exact frame count, channel count, sample rate, and original sample rate.*old binding and platform snapshot.*current.*candidate.*exact locator revision.*measured byte length and SHA-256.*assertCanPublish.*same compensated memory batch or IndexedDB.*binding-and-provisional-root CAS.*project, source, clip, and history.*unchanged.*startup.*reconciliation/isu,
	);
	assertLinkedAudioTargetAndRecovery(handoff.summary);
	assert.match(
		portability.summary,
		/current-format exact-schema-14 `.scape`.*no owned sender PCM.*canonical Float32 chunks.*`audio-f32le-chunks-v1`.*external container bytes.*locator identity.*excluded.*fresh portless import.*owned PCM.*durable reopen/iu,
	);
	for (const control of [portability, range, handoff]) {
		assert.match(control.summary, /not.*packaged|does not qualify.*packaged/iu);
		assert.match(control.summary, /metadata preservation/iu);
		assert.match(control.summary, /content-frozen|durable.*cross-process/iu);
		assert.match(control.summary, /reference-scale/iu);
	}
	for (const path of [
		'src/common/editor/aiff-pcm-chunk-reader.ts',
		'tests/audio-editor-aiff-pcm-chunk-reader.test.ts',
	]) {
		assert.ok(portability.evidence.some((item) => item.path === path), path);
		assert.ok(handoff.evidence.some((item) => item.path === path), path);
	}
	for (const path of [
		'src/common/editor/app.js',
		'src/common/editor/controller/clip-time-pitch-service.ts',
		'src/common/editor/controller/project-admin-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/controller/source-audio.ts',
		'src/common/editor/controller/source-chunk-provider-registry.ts',
		'src/common/editor/controller/source-lifecycle-service.ts',
		'src/common/editor/storage/source-pcm-read-session.ts',
		'tests/audio-editor-clip-time-pitch-service.test.ts',
		'tests/audio-editor-linked-source-controller-disposal.test.js',
		'tests/audio-editor-project-admin-service-coverage.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-source-audio.test.ts',
		'tests/audio-editor-source-chunk-provider-registry.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
	]) assert.ok(range.evidence.some((item) => item.path === path), path);
	for (const path of [
		'src/common/editor/app.js',
		'src/common/editor/controller/action-facade.ts',
		'src/common/editor/controller/audio-relink-probe.ts',
		'src/common/editor/controller/project-bin-linked-audio-relink-service.ts',
		'src/common/editor/controller/project-bin-linked-original-relink-task.ts',
		'src/common/editor/controller/project-bin-service.ts',
		'src/common/editor/controller/project-bin-types.ts',
		'src/common/editor/controller/project-lock-service.ts',
		'src/common/editor/controller/source-lifecycle-service.ts',
		'src/common/editor/storage/linked-original-pair-writer.ts',
		'src/common/editor/storage/linked-original-provisional-root.ts',
		'src/common/editor/storage/project-store-defaults.ts',
		'src/common/editor/ui/workspace/ProjectBinPanel.jsx',
		'src/common/editor/ui/workspace/linked-audio-choice-handoff.ts',
		'tests/audio-editor-controller-action-facade.test.ts',
		'tests/audio-editor-audio-relink-probe.test.ts',
		'tests/audio-editor-linked-audio-original-relink.test.ts',
		'tests/audio-editor-linked-audio-choice-handoff.test.ts',
		'tests/audio-editor-linked-audio-project-bin-ui.test.ts',
		'tests/audio-editor-project-bin-linked-audio-relink-service.test.ts',
		'tests/audio-editor-project-bin-linked-audio-changed-relink.test.ts',
		'tests/audio-editor-project-bin-service.test.ts',
		'tests/audio-editor-project-lock-service.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
	]) assert.ok(handoff.evidence.some((item) => item.path === path), path);
	const residual = libraryRisk.residualRisks.find(
		({ id }) => id === 'shared-library-cross-product-media-availability',
	);
	assert.match(
		residual?.exposure ?? '',
		/maintained linked-PCM exception.*point-in-time.*whole-body binding materialization.*exact-revision owner-scoped stable-handle range lease.*canonical Float32 PCM.*fresh recipient.*without the locator.*external WAV or AIFF container.*does not cross/iu,
	);
	assert.match(residual?.exposure ?? '', /Linked audio beyond.*classic integer-PCM AIFF.*canonical first-party AIFF-C float32/iu);
	assert.match(
		residual?.requiredControl ?? '',
		/linked-PCM ranged reads.*packaged executables.*durable operating-system locator.*immutable or cross-process byte-identity/iu,
	);
});

test('linked PCM compatibility and threat documentation own the detailed limits', async () => {
	const [compatibility, threatModel] = await Promise.all([
		readFile(compatibilityDocumentUrl, 'utf8'),
		readFile(threatModelUrl, 'utf8'),
	]);
	for (const documentation of [compatibility, threatModel]) {
		assert.match(documentation, /narrow linked-PCM portable-archive (?:exception|control)/iu);
		assert.match(documentation, /narrow linked-PCM managed-handoff exception/iu);
		assertMaintainedAiffProfile(documentation);
		assert.match(documentation, /canonical `audio-f32le-chunks-v1`/iu);
		assert.match(documentation, /fresh (?:portless )?recipient.*owned (?:canonical )?PCM/isu);
		assert.match(documentation, /external (?:source-)?container bytes.*locator identity.*(?:absent|do not cross)/isu);
		assert.match(documentation, /same-inode.*mutation.*not fenced/isu);
		assert.match(documentation, /packaged executable or UI.*operating-system/isu);
		assert.match(documentation, /metadata preservation/iu);
		assert.match(documentation, /reference-scale/iu);
		assert.match(
			documentation,
			/provider-owned stable PCM\s+read session.*one full-container digest,? and one parsed descriptor.*serialized random\s+or sequential chunk reads.*complete alias group.*exact\s+binding.*before and after.*per-read.*cancellation.*local.*exact-once release.*backing/isu,
		);
		assert.match(
			documentation,
			/binding-backed.*Project Bin.*(?:linked-PCM\s+)?relink.*exactly\s+one audio source.*(?:does not|must not|not).*missing-source\s+state.*pathless.*selected\s+`?File`?.*opaque locator ID\s+and\s+(?:exact\s+)?revision/isu,
		);
		assert.match(documentation, /classif.*byte length and SHA-256.*exact\s+project\s+and\s+project\s+revision.*changed choice.*localized confirmation/isu);
		assert.match(documentation, /(?:structural(?:ly)? (?:probe|inspect).*before.*timeline\s+transport.*Project\s+Bin\s+preview.*(?:provider.*drain|drain.*provider)|Before timeline\s+transport.*Project\s+Bin\s+preview.*structural probe.*controller.*(?:provider.*drain|drain.*provider))/isu);
		assert.match(documentation, /same\s+maintained\s+(?:container|MIME\s+and\s+file)\s+identity.*exact\s+frame\s+count,\s+channel\s+count,\s+sample\s+rate,\s+and\s+original\s+sample\s+rate/isu);
		assert.match(documentation, /timeline\s+transport.*Project\s+Bin\s+preview.*(?:provider.*drain|drain.*provider).*before.*storage/isu);
		assert.match(documentation, /default.*(?:same\s+byte\s+length\s+and\s+SHA-256|exact\s+byte-length\s+and\s+SHA-256\s+equality).*changed.*candidate.*exact\s+revision.*measured.*byte length.*SHA-256/isu);
		assert.match(documentation, /synchronous.*assertCanPublish/isu);
		assert.match(documentation, /same\s+compensated\s+memory\s+batch\s+or\s+IndexedDB.*binding-and-provisional-root/isu);
		assert.match(documentation, /(?:guard|assertCanPublish).*rechecks.*task.*project\s+generation.*writable/isu);
		assert.match(documentation, /project,\s+source,\s+clip,\s+and\s+history.*unchanged.*reactivat.*before.*availability/isu);
		assertLinkedAudioTargetAndRecovery(documentation);
	}
});

function assertLinkedAudioTargetAndRecovery(text) {
	assert.match(text, /pathless.*selected\s+`File`.*opaque\s+locator\s+ID.*revision.*exact\s+`?\{projectId, projectRevision\}`?\s+target/isu);
	assert.match(text, /target.*before.*shared.*relink\s+task.*(?:without|does not).*cancell?ing\s+current\s+work.*(?:recheck|rechecks|validate).*target.*storage\s+publication/isu);
	assert.match(text, /current\s+audio-operation\s+ownership.*active\s+project.*controller\s+lifetime.*rather\s+than\s+shared-task\s+currentness/isu);
	assert.match(text, /shared\s+video.*project-lock\s+cancellation.*before\s+publication.*restore.*old\s+runtime/isu);
	assert.match(text, /after\s+publication.*activation.*(?:did\s+not\s+complete|is\s+incomplete|incomplete).*(?:source\s+missing|missing\s+state)/isu);
	assert.match(text, /completed\s+owned\s+activation.*availability/isu);
	assert.match(text, /recovery.*rechecks.*operation\s+ownership.*after\s+metadata.*before\s+activation/isu);
	assert.match(text, /cross-store.*(?:cross-process|process) coordination.*(?:unqualified|not qualified)/isu);
}

function assertMaintainedAiffProfile(text) {
	assert.match(text, /AIFF/iu);
	assert.match(text, /\.aif.*\.aiff|\.aiff.*\.aif/isu);
	assert.match(text, /audio\/aiff/iu);
	assert.match(text, /FORM\/AIFF/iu);
	assert.match(text, /COMM.*SSND|SSND.*COMM/isu);
	assert.match(text, /signed big-endian.*8.*16.*24.*32/isu);
	assert.match(text, /FORM\/AIFC.*FVER v1.*0xA2805140.*44-byte\s+COMM.*32-bit `?fl32`?.*Pascal compression name `?32-bit\s+floating point`?.*SSND/isu);
	assert.match(text, /first-party\s+label.*maintained fixture.*not authenticated provenance.*producer-neutral.*any producer.*exact\s+tuple.*broader.*compressed.*other (?:AIFC|AIFF-C) profiles.*reject.*broader\s+third-party interoperability.*producer provenance.*unqualified/isu);
	assert.match(text, /third-party AIFC interoperability.*provenance.*`?\.aifc`? extension/isu);
}

function requiredRule(rules, id) {
	const rule = rules.find((candidate) => candidate.id === id);
	assert.ok(rule, id);
	return rule;
}

function requiredRisk(risks, id) {
	const risk = risks.find((candidate) => candidate.id === id);
	assert.ok(risk, id);
	return risk;
}

function requiredControl(risk, id) {
	const control = risk.currentControls.find((candidate) => candidate.id === id);
	assert.ok(control, id);
	return control;
}

async function readJson(url) {
	return JSON.parse(await readFile(url, 'utf8'));
}
