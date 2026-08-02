/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('first-party video rendered-fallback export stays exact and narrowly qualified', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(
		({ id }) => id === 'external-project-document-validation',
	);
	const control = projectDocuments?.currentControls.find(
		({ id }) => id === 'first-party-video-rendered-fallback-export',
	);
	assert.ok(control);
	assert.equal(projectDocuments?.currentControls.some(
		({ id }) => id === 'first-party-video-effects-rendered-fallback-export',
	), false);

	for (const path of [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-feature-video-rendered-fallback.ts',
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/project-fallback-integrity-video.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/video-rendered-fallback-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx',
		'src/common/editor/video-export.js',
		'src/common/editor/video-ffmpeg.js',
		'src/common/editor/app.js',
		'tests/audio-editor-project-feature-video-rendered-fallback.test.ts',
		'tests/audio-editor-video-rendered-fallback-delivery-projection.test.ts',
		'tests/audio-editor-video-rendered-fallback-export.test.ts',
		'tests/audio-editor-project-fallback-integrity.test.ts',
		'tests/audio-editor-project-fallback-integrity-selection.test.ts',
		'tests/audio-editor-project-feature-compatibility-notice.test.ts',
		'tests/desktop-project-library-video-rendered-fallback-handoff.test.ts',
		'tests/production-security-video-rendered-fallback-export.test.js',
	]) {
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), path);
		assert.ok(control.evidence.some((item) => item.path === path), path);
	}

	assert.match(
		control.summary,
		/exact schema 9.*host-owned registered video capability allowlist.*videoImport.*videoPlayback.*videoTimelineEditing.*videoExport.*videoEffects.*videoCompositing.*unavailable.*declared and effective rendered-fallback.*only.*final video delivery.*canonical manifest/iu,
	);
	assert.match(
		control.summary,
		/report video descriptor.*canonical manifest requirement.*requirement ID.*feature ID.*video kind.*source ID.*SHA-256/iu,
	);
	assert.match(
		control.summary,
		/operation-time selector.mode.*exact requirement ID.*feature ID.*video kind.*source ID.*SHA-256.*unrelated inactive audio.*storage.*not read/iu,
	);
	assert.match(
		control.summary,
		/canonical native Blob.*size.check.*hash.*same.*object.*sole video input.*no second fallback.store read.*TOCTOU/iu,
	);
	assert.match(
		control.summary,
		/current.*before verification.*after.*admission.*before planning.*task signal.*audio render.*FFmpeg.*post-encode.*prior-output cleanup.*current.*before.*download publication/iu,
	);
	assert.match(
		control.summary,
		/export signal.*passed.*download publication.*after.*returns.*current.*recoverable.*cleanup/iu,
	);
	assert.match(
		control.summary,
		/canonical audio.*separate staged mix.*embedded fallback audio.*ignored/iu,
	);
	assert.match(control.summary, /canonical project.*history.*save.*unchanged/iu);
	assert.match(
		control.summary,
		/stale activation-time.*missing.*wrong.*digest.*before.*FFmpeg.*download/iu,
	);
	assert.match(
		control.summary,
		/videoCompositing.*composed Framescaper-to-fresh-Soundscaper.*manifest.*metadata.*localized source\/component UI.*exact feature ID.*requirement ID.*operation-time selector.*exact requirement ID.*feature ID.*video kind.*source ID.*SHA-256.*transfer.*descriptor.*body digest.*not.*manifest declaration.*tamper.*refus.*repair.*canonical.*shadow.*unchanged/iu,
	);
	assert.match(
		control.summary,
		/retained immutable Blob.*point-in-time bytes.*no durable storage-record lease.*cross-process replacement.*more than one.*different registered video feature IDs.*audio IDs.*unknown or third-party.*future.*earlier.*simultaneous.*authored.*freeze.*proxy.*linked-only.*unmanaged.*embedded fallback audio.*other export parity.*packaged runtime or UI.*browser.*codec.*range.*reference-scale.*whole-handoff atomicity/iu,
	);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	const sectionStart = threatModel.indexOf('Final video rendered-fallback delivery');
	const sectionEnd = threatModel.indexOf('\nDescriptor validation alone', sectionStart);
	assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
	const documentation = threatModel.slice(sectionStart, sectionEnd).replace(/\s+/gu, ' ');
	assert.match(
		documentation,
		/final video rendered-fallback delivery.*exact schema 9.*host-owned registered video capability allowlist.*`videoImport`.*`videoPlayback`.*`videoTimelineEditing`.*`videoExport`.*`videoEffects`.*`videoCompositing`.*unavailable.*declared and effective `rendered-fallback`.*only.*video delivery projection/iu,
	);
	assert.match(
		documentation,
		/report video descriptor.*canonical manifest.*requirement ID.*feature ID.*video kind.*source ID.*SHA-256/iu,
	);
	assert.match(
		documentation,
		/operation-time selector.mode.*exact requirement ID.*feature ID.*video kind.*source ID.*SHA-256.*unrelated inactive audio.*storage.*not read/iu,
	);
	assert.match(
		documentation,
		/canonical native `Blob`.*size.check.*hash.*same.*object.*sole video input.*no second fallback-store read.*TOCTOU/iu,
	);
	assert.match(
		documentation,
		/prior-output cleanup.*current.*before.*download publication.*export-task signal.*passed.*publication.*after.*returns.*current.*recoverable.*cleanup/iu,
	);
	assert.match(
		documentation,
		/canonical audio.*separately staged.*embedded audio.*fallback container.*ignored/iu,
	);
	assert.match(documentation, /canonical project.*history.*save.*unchanged/iu);
	assert.match(
		documentation,
		/`videoCompositing`.*composed Framescaper-to-fresh-Soundscaper.*manifest.*metadata.*localized source\/component UI.*exact feature ID.*requirement ID.*operation-time selector.*exact requirement ID.*feature ID.*video kind.*source ID.*SHA-256.*transfer.*descriptor.*body digest.*not.*manifest declaration.*tamper.*refus.*repair.*canonical.*shadow.*unchanged/iu,
	);
	assert.match(
		documentation,
		/retained immutable `Blob`.*point-in-time bytes.*not a durable storage-record lease.*cross-process replacement.*more than one.*different registered video feature IDs.*audio IDs.*unknown or third-party.*future.*earlier.*simultaneous.*authored.*freeze.*proxy.*linked-only.*unmanaged.*embedded fallback audio.*other export parity.*packaged runtime or UI.*browser.*codec.*range.*reference-scale.*whole-handoff atomicity/iu,
	);
});
