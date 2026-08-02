/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('registered first-party video fallback playback and handoff stay exact and narrowly qualified', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(
		({ id }) => id === 'external-project-document-validation',
	);
	const control = projectDocuments?.currentControls.find(
		({ id }) => id === 'first-party-video-rendered-fallback-playback',
	);
	assert.ok(control);
	assert.equal(projectDocuments?.currentControls.some(
		({ id }) => id === 'first-party-video-effects-rendered-fallback-playback',
	), false);
	for (const path of [
		'src/common/editor/project-feature-capabilities.ts',
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
		'tests/desktop-project-library-video-rendered-fallback-handoff.test.ts',
		'tests/production-security-video-rendered-fallback.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);

	assert.match(
		control.summary,
		/exact schema 9.*host-owned registered video capability allowlist.*videoImport.*videoPlayback.*videoTimelineEditing.*videoExport.*videoEffects.*videoCompositing.*unavailable.*declared and effective rendered-fallback.*exactly matches.*canonical manifest/iu,
	);
	assert.match(
		control.summary,
		/report video descriptor.*canonical manifest requirement.*requirement ID.*feature ID.*video kind.*source ID.*SHA-256/iu,
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
	assert.match(control.summary, /deeply frozen.*metadata.*localized source\/component UI.*exact feature ID.*requirement ID.*without.*source identity.*digest/iu);
	assert.match(
		control.summary,
		/videoCompositing.*explicit managed handoff.*manifest-only fallback.*editable retained original.*headless Framescaper-to-fresh-Soundscaper.*both exact video bodies.*canonical shadow.*controller independently verifies the manifest digest.*exact Blob URL.*transfer verifies each descriptor and body digest.*not the fallback declaration/iu,
	);
	assert.match(
		control.summary,
		/more than one.*different registered video feature IDs.*audio IDs.*unknown or third-party.*future.schemas.*earlier Soundscaper.*linked-only.*unmanaged.*generic.*author.*freeze.*proxy.*embedded fallback audio.*other export parity.*packaged runtime or UI.*browser.*codec.*range.*reference-scale.*durable byte lease.*cross-process.*whole-handoff atomicity.*final-video fallback delivery.*separate control/iu,
	);

	const documentation = (await readFile(threatModelUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(
		documentation,
		/first-party video rendered-fallback preview and playback.*exact schema 9.*host-owned registered video capability allowlist.*`videoImport`.*`videoPlayback`.*`videoTimelineEditing`.*`videoExport`.*`videoEffects`.*`videoCompositing`.*unavailable.*declared and effective `rendered-fallback`.*report video descriptor.*canonical manifest requirement.*requirement ID.*feature ID.*video kind.*source ID.*SHA-256/iu,
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
		/frozen.*metadata.*localized source\/component UI.*bind only.*feature ID.*requirement ID.*without.*source identity.*digest/iu,
	);
	assert.match(
		documentation,
		/`videoCompositing`.*same maintained first-party relationship.*explicit managed handoff.*headless Framescaper-to-fresh-Soundscaper.*manifest is its only project reference.*editable retained-video original.*two exact managed video bodies.*empty recipient.*both bodies.*exact canonical shadow.*controller independently authenticates.*fallback declaration.*exact fallback Blob URL.*transfer authenticates each descriptor and body digest.*not the manifest declaration/iu,
	);
	assert.match(
		documentation,
		/more than one.*different registered video feature IDs.*audio IDs.*unknown or third-party.*future.schemas.*earlier Soundscaper.*linked-only.*unmanaged.*generic.*author.*freeze.*proxy.*embedded fallback audio.*other export parity.*packaged runtime or UI.*browser.*codec.*range.*reference-scale.*durable byte lease.*cross-process.*whole-handoff atomicity.*final-video fallback delivery.*separate control/iu,
	);
});
