/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('role-defined whole-project and first-party clip-local video fallback playback stay narrow', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(
		({ id }) => id === 'external-project-document-validation',
	);
	const control = projectDocuments?.currentControls.find(
		({ id }) => id === 'video-rendered-fallback-playback',
	);
	assert.ok(control);
	assert.equal(projectDocuments?.currentControls.some(
		({ id }) => id === 'first-party-video-rendered-fallback-playback',
	), false);
	for (const path of [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-feature-video-rendered-fallback.ts',
		'src/common/editor/project-feature-video-clip-render-v1.ts',
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
		'tests/audio-editor-project-feature-video-clip-render-v1.test.ts',
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
		'tests/audio-editor-framescaper-baseline.test.ts',
		'tests/production-security-video-rendered-fallback.test.js',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);

	assert.match(
		control.summary,
		/exact owning-family v1.*project-video-render-v1.*canonical namespaced feature ID.*unavailable or unknown.*declared and effective rendered-fallback.*closed role.*feature ID.*opaque.*does not discover, load, or execute.*feature code.*canonical manifest/iu,
	);
	assert.match(
		control.summary,
		/video-clip-render-v1.*exact registered videoEffects.*unavailable.*declared and effective rendered-fallback/iu,
	);
	assert.match(
		control.summary,
		/report video descriptor.*canonical manifest requirement.*requirement ID.*feature ID.*relationship role.*optional target clip ID.*video kind.*source ID.*SHA-256/iu,
	);
	assert.match(
		control.summary,
		/controller admission.*genuine immutable video Blob.*exact admitted size.*SHA-256.*4 MiB.*before activation.*currentness.*after required-source activation.*before.*engine/iu,
	);
	assert.match(
		control.summary,
		/project-video-render-v1.*transient full-length projection.*frame zero.*replaces.*video tracks and clips.*preserves.*audio.*labels.*Project Bin.*sources.*canonical document.*history.*unchanged/iu,
	);
	assert.match(
		control.summary,
		/exactly one video source.*exact kind.*project and source sample rates.*positive.*frame count.*width.*height.*frame rate.*missing or duplicated.*wrong kind.*reserved synthetic track or clip IDs reject/iu,
	);
	assert.match(
		control.summary,
		/video-clip-render-v1.*restricted to videoEffects.*exact target clip ID.*enabled maintained effect.*fallback source.*different from the canonical source.*hasAudio false.*frame count.*target duration.*sample rate.*width.*height.*frame rate.*canonical source/iu,
	);
	assert.match(
		control.summary,
		/replaces only that target.*track membership.*timeline placement.*duration.*group.*A\/V link.*layer and transition context.*unaffected clips.*canonical document.*history.*unchanged.*source-local start.*trims.*zero.*speed.*one.*video effects.*empty/iu,
	);
	assert.match(
		control.summary,
		/manifest-only.*required video source.*activated.*before.*transient engine.*preview.*projected clip.*exact source identity/iu,
	);
	assert.match(control.summary, /deeply frozen.*metadata.*localized source\/component UI.*exact feature ID.*requirement ID.*without.*source identity.*digest/iu);
	assert.match(
		control.summary,
		/org\.example\.future-video-pipeline.*unknown-feature.*explicit managed handoff.*whole-project fallback.*retained original.*separate video-clip-render-v1 managed handoff.*fresh recipient.*exact target clip ID.*digest-bound fallback body.*canonical shadow.*relationship admission.*playback.*transfer verifies each descriptor and body digest.*not the fallback declaration/iu,
	);
	assert.match(
		control.summary,
		/more than one qualifying video fallback.*multiple clip fallbacks.*preview and playback.*other mixed relationships.*unqualified.*other relationship roles.*future schemas.*earlier Soundscaper schemas.*linked-only or unmanaged.*unqualified.*generic fallback authoring.*third-party feature-code activation.*unqualified.*freeze.*proxy.*relink.*embedded fallback audio.*other export parity.*source-level evidence.*source\/component binding.*both frozen video roles.*packaged runtime or UI activation, transport playback, and final-delivery workflows.*unqualified.*browser behavior.*codec qualification.*unqualified.*range or reference-scale.*unqualified.*durable byte lease.*cross-process.*whole-handoff atomicity.*exact one-audio.one-video final delivery.*separate control/iu,
	);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	const normalizedThreatModel = threatModel.replace(/\s+/gu, ' ');
	assert.match(normalizedThreatModel, /1\.0 project-identity boundary.*schemaFamily:'soundscaper'.*schemaVersion:1/isu);
	assert.match(normalizedThreatModel, /other known family.*later version.*opaque read-only custody.*not semantic validation/isu);
	assert.match(normalizedThreatModel, /version-bearing S21–S30, F18–F32.*historical implementation provenance/isu);
	assert.ok(
		threatModel.indexOf('Video rendered-fallback preview and playback')
			> threatModel.indexOf('historical implementation provenance'),
		'the predecessor-schema playback narrative is retained only as provenance',
	);
});
