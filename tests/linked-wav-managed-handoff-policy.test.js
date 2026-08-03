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

	for (const rule of [portable, handoff]) assertClassicAiffProfile(
		`${rule.requiredOutcome} ${rule.currentBehavior}`,
	);
	assert.match(
		portable.requiredOutcome,
		/512 MiB.*sender.*no owned PCM.*canonical `audio-f32le-chunks-v1`.*no locator identity.*external container bytes.*fresh portless recipient.*owned canonical PCM.*durable reopen/iu,
	);
	assert.match(
		portable.currentBehavior,
		/whole source snapshot.*exact-revision range capability.*sequential SHA-256.*at-most-4-MiB.*recheck.*binding.*without another whole-original `Blob`.*external BW64 or AIFF container.*absent.*zero linked bindings.*close and reopen.*exact samples/iu,
	);
	assert.match(
		handoff.requiredOutcome,
		/point-in-time.*512 MiB.*main-private.*pathless.*whole source snapshot.*exact-revision range capability.*full sequential SHA-256.*at-most-4-MiB.*without another whole-original `Blob`.*no owned PCM body.*two full source-API passes.*fresh recipient.*without the original locator.*external container.*must not enter.*catalog/iu,
	);
	assert.match(
		handoff.currentBehavior,
		/`linked-audio-range-v1`.*exact locator revision.*at-most-4-MiB `206`.*read session.*release.*`prepareHandoff`.*two canonical Float32 PCM source-API passes.*fresh recipient.*reopens.*without a linked-original port.*not content-frozen.*cross-process snapshot/iu,
	);
	for (const text of [portable.currentBehavior, handoff.currentBehavior]) {
		assert.match(text, /AIFF metadata preservation.*AIFC|AIFC.*metadata preservation/iu);
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
});

test('linked PCM desktop security controls preserve the closed AIFF boundary', async () => {
	const matrix = await readJson(securityUrl);
	const archiveRisk = requiredRisk(matrix.risks, 'scape-archive-structure-integrity');
	const readRisk = requiredRisk(matrix.risks, 'desktop-read-path-capabilities');
	const libraryRisk = requiredRisk(matrix.risks, 'shared-desktop-project-library-integrity');
	const portability = requiredControl(archiveRisk, 'linked-pcm-canonical-portability');
	const range = requiredControl(readRisk, 'owner-scoped-linked-audio-range-lifecycle');
	const handoff = requiredControl(libraryRisk, 'point-in-time-linked-pcm-managed-handoff');

	assert.equal(archiveRisk.status, 'enforced');
	assert.equal(libraryRisk.status, 'partial');
	for (const control of [portability, range, handoff]) assertClassicAiffProfile(control.summary);
	assert.match(
		range.summary,
		/pathless DTO.*exact locator revision.*128 capabilities.*64 GiB.*512 MiB per file.*16 active (?:range )?requests.*4 MiB per response.*exact closed ranges.*binding and CAS fence.*without another whole-original Blob.*release once/iu,
	);
	assert.match(
		handoff.summary,
		/main-private.*pathless point-in-time binding.*no owned PCM body.*whole external container.*exact digest.*canonical geometry.*two canonical Float32 PCM passes.*fresh recipient.*without the original locator.*source-container bytes.*locator identity.*never cross/iu,
	);
	assert.match(
		portability.summary,
		/current-format exact-schema-9 `.scape`.*no owned sender PCM.*canonical Float32 chunks.*`audio-f32le-chunks-v1`.*external container bytes.*locator identity.*excluded.*fresh portless import.*owned PCM.*durable reopen/iu,
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
	const residual = libraryRisk.residualRisks.find(
		({ id }) => id === 'shared-library-cross-product-media-availability',
	);
	assert.match(
		residual?.exposure ?? '',
		/maintained linked-PCM exception.*point-in-time.*whole-body binding materialization.*exact-revision owner-scoped stable-handle range lease.*canonical Float32 PCM.*fresh recipient.*without the locator.*external WAV or AIFF container.*does not cross/iu,
	);
	assert.match(residual?.exposure ?? '', /Linked audio beyond.*classic integer-PCM AIFF/iu);
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
		assertClassicAiffProfile(documentation);
		assert.match(documentation, /canonical `audio-f32le-chunks-v1`/iu);
		assert.match(documentation, /fresh (?:portless )?recipient.*owned (?:canonical )?PCM/isu);
		assert.match(documentation, /external (?:source-)?container bytes.*locator identity.*(?:absent|do not cross)/isu);
		assert.match(documentation, /same-inode.*mutation.*not fenced/isu);
		assert.match(documentation, /packaged executable or UI.*operating-system/isu);
		assert.match(documentation, /metadata preservation/iu);
		assert.match(documentation, /reference-scale/iu);
	}
});

function assertClassicAiffProfile(text) {
	assert.match(text, /AIFF/iu);
	assert.match(text, /\.aif.*\.aiff|\.aiff.*\.aif/isu);
	assert.match(text, /audio\/aiff/iu);
	assert.match(text, /FORM\/AIFF/iu);
	assert.match(text, /COMM.*SSND|SSND.*COMM/isu);
	assert.match(text, /signed big-endian.*8.*16.*24.*32/isu);
	assert.match(text, /(?:AIFC|AIFF-C).*reject|reject.*(?:AIFC|AIFF-C)/isu);
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
