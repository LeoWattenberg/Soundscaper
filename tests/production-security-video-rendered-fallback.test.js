/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('first-party video-effects fallback preview stays exact, transient, and narrowly qualified', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(
		({ id }) => id === 'external-project-document-validation',
	);
	const control = projectDocuments?.currentControls.find(
		({ id }) => id === 'first-party-video-effects-rendered-fallback-playback',
	);
	assert.ok(control);
	for (const path of [
		'src/common/editor/project-feature-video-rendered-fallback.ts',
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/controller/source-lifecycle-service.ts',
		'src/common/editor/controller/project-visual-service.ts',
		'src/common/editor/controller/document-snapshot.ts',
		'src/common/editor/project-feature-report-metadata.ts',
		'src/common/editor/session.js',
		'src/common/editor/ui/workspace/video-preview-visual.ts',
		'src/common/editor/ui/workspace/VideoPreviewPanel.jsx',
		'src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx',
		'src/common/editor/ui/workspace/AudioEditorWorkspaceView.jsx',
		'src/common/editor/app.js',
		'tests/audio-editor-project-feature-video-rendered-fallback.test.ts',
		'tests/audio-editor-project-fallback-integrity.test.ts',
		'tests/audio-editor-playback-project-service.test.ts',
		'tests/audio-editor-project-switch-fallback-integrity.test.ts',
		'tests/audio-editor-project-switch-source-preparation.test.ts',
		'tests/audio-editor-source-lifecycle-service.test.ts',
		'tests/audio-editor-project-visual-service.test.ts',
		'tests/audio-editor-video-preview-visual.test.ts',
		'tests/audio-editor-document-snapshot.test.ts',
		'tests/audio-editor-session.test.js',
		'tests/audio-editor-project-feature-compatibility-notice.test.ts',
		'tests/production-security-video-rendered-fallback.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);

	assert.match(
		control.summary,
		/exact schema 9.*registered first-party videoEffects.*unavailable.*declared and effective rendered-fallback.*exactly matches.*canonical manifest/iu,
	);
	assert.match(
		control.summary,
		/controller admission.*genuine immutable video Blob.*exact admitted size.*SHA-256.*4 MiB.*before activation.*currentness.*after required-source activation.*before.*engine/iu,
	);
	assert.match(
		control.summary,
		/transient.*full-length.*frame zero.*replaces.*video tracks and clips.*preserves.*audio.*labels.*Project Bin.*sources.*canonical document.*history.*unchanged/iu,
	);
	assert.match(
		control.summary,
		/exactly one video source.*kind.*sample rate.*positive.*frame count.*width.*height.*frame rate.*reserved.*track.*clip.*Project Bin.*reject/iu,
	);
	assert.match(
		control.summary,
		/manifest-only.*required video source.*activated.*before.*transient engine.*preview.*canonical clip.*exact fallback source ID.*canonical source.*synthetic clip ID.*never.*canonical/iu,
	);
	assert.match(control.summary, /deeply frozen.*metadata.*localized notice.*active during editor playback/iu);
	assert.match(
		control.summary,
		/no generic or third-party fallback.*authored proxy or freeze.*future.schema.*offline render.*video.export.*packaged.*browser.codec.*durable byte lease.*range.*reference-scale.*embedded video audio/iu,
	);

	const documentation = (await readFile(threatModelUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(
		documentation,
		/first-party video-effects rendered-fallback preview and playback.*exact schema 9.*registered first-party `videoEffects`.*unavailable.*declared and effective `rendered-fallback`.*canonical manifest/iu,
	);
	assert.match(
		documentation,
		/genuine immutable video Blob.*exact admitted size.*SHA-256.*4 MiB.*before activation.*currentness.*after.*required-source activation.*before.*engine/iu,
	);
	assert.match(
		documentation,
		/required manifest-only video source.*before.*transient engine.*preview.*canonical source lookup.*synthetic clip ID/iu,
	);
	assert.match(
		documentation,
		/generic or third-party fallback.*authored proxy or freeze.*future.schema.*offline render.*video.export.*packaged.*browser.codec.*durable byte lease.*range.*reference-scale.*embedded video audio/iu,
	);
});
