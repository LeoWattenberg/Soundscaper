/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('role-defined whole-project and first-party clip-local video fallback export stays narrow', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const projectDocuments = matrix.risks.find(
		({ id }) => id === 'external-project-document-validation',
	);
	const control = projectDocuments?.currentControls.find(
		({ id }) => id === 'video-rendered-fallback-export',
	);
	assert.ok(control);
	assert.equal(projectDocuments?.currentControls.some(
		({ id }) => id === 'first-party-video-rendered-fallback-export',
	), false);

	for (const path of [
		'src/common/editor/project-feature-capabilities.ts',
		'src/common/editor/project-feature-video-rendered-fallback.ts',
		'src/common/editor/project-feature-video-clip-render-v1.ts',
		'src/common/editor/project-fallback-integrity.ts',
		'src/common/editor/project-fallback-integrity-audio.ts',
		'src/common/editor/project-fallback-integrity-video.ts',
		'src/common/editor/project-fallback-integrity-snapshot.ts',
		'src/common/editor/controller/playback-project-service.ts',
		'src/common/editor/controller/audio-rendered-fallback-export.ts',
		'src/common/editor/controller/video-rendered-fallback-export.ts',
		'src/common/editor/controller/video-export-service.ts',
		'src/common/editor/controller/project-visual-service.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx',
		'src/common/editor/video-export.js',
		'src/common/editor/video-ffmpeg.js',
		'src/common/editor/app.js',
		'tests/audio-editor-project-feature-video-rendered-fallback.test.ts',
		'tests/audio-editor-video-rendered-fallback-delivery-projection.test.ts',
		'tests/audio-editor-video-rendered-fallback-export.test.ts',
		'tests/audio-editor-video-clip-fallback-export-regression.test.ts',
		'tests/audio-editor-project-fallback-integrity.test.ts',
		'tests/audio-editor-project-fallback-integrity-selection.test.ts',
		'tests/audio-editor-project-fallback-integrity-mixed-selection.test.ts',
		'tests/audio-editor-project-fallback-integrity-relationships.test.ts',
		'tests/audio-editor-mixed-rendered-fallback-video-export.test.ts',
		'tests/audio-editor-project-visual-service.test.ts',
		'tests/audio-editor-project-feature-compatibility-notice.test.ts',
		'tests/desktop-project-library-video-rendered-fallback-handoff.test.ts',
		'tests/production-security-video-rendered-fallback-export.test.js',
	]) {
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), path);
		assert.ok(control.evidence.some((item) => item.path === path), path);
	}

	assert.match(
		control.summary,
		/exact schema 11.*project-video-render-v1.*canonical namespaced feature ID.*unavailable or unknown.*closed role.*feature ID.*opaque.*does not discover, load, or execute.*feature code.*video-clip-render-v1.*exact registered videoEffects.*unavailable.*narrow final video delivery.*canonical manifest.*requirement ID.*feature ID.*relationship role.*target clip ID.*video kind.*source ID.*SHA-256/iu,
	);
	assert.match(
		control.summary,
		/operation-time selector.*role.*target clip ID.*source ID.*SHA-256.*requirement and feature IDs.*snapshot currentness.*drift/iu,
	);
	assert.match(
		control.summary,
		/exactly one.*audio fallback of either closed audio role.*one.*video fallback.*single.*integrity admission.*cumulative.*before.*body reads.*private chunk provider.*exact.*Blob/iu,
	);
	assert.match(
		control.summary,
		/canonical native Blob.*size-checks and hashes.*same object.*without a second fallback-store read.*sole video input.*project-video-render-v1.*selected target input.*video-clip-render-v1.*ordinary unaffected video.*composition/iu,
	);
	assert.match(
		control.summary,
		/clip-local ordinary video export.*target placement.*track membership.*layer.*transition.*active audio fallback.*private.*chunk.*otherwise.*canonical audio.*embedded fallback audio.*ignored/iu,
	);
	assert.match(
		control.summary,
		/direct MP4\/WebM route.*legacy final-Blob route.*does not add codec qualification.*currentness.*before verification.*after admission.*after FFmpeg.*publication.*recoverable stale publication.*cleaned up/iu,
	);
	assert.match(
		control.summary,
		/selector mismatch.*stale activation digest.*missing or wrong body.*digest mismatch.*before planning and output/iu,
	);
	assert.match(control.summary, /canonical project.*history.*save.*unchanged/iu);
	assert.match(
		control.summary,
		/clip-local fresh-recipient witness.*target identity.*fallback bytes.*relationship admission.*point-in-time bytes.*no durable storage-record lease.*cross-process/iu,
	);
	assert.match(
		control.summary,
		/exact one-audio.one-video composition.*qualified.*multiple clip.*duplicate same-kind.*other mixed fallback relationships.*other relationship roles.*generic authoring.*third-party feature-code activation.*standalone audio.*simultaneous.*reject.*freeze.*proxy.*linked or unmanaged delivery.*broad export parity.*packaged runtime.*browser behavior.*codec qualification.*range transport.*reference-scale.*whole-handoff atomicity.*unqualified/iu,
	);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	const sectionStart = threatModel.indexOf('Final video rendered-fallback delivery');
	const sectionEnd = threatModel.indexOf('\nDescriptor validation alone', sectionStart);
	assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
	const documentation = threatModel.slice(sectionStart, sectionEnd).replace(/\s+/gu, ' ');
	assert.match(
		documentation,
		/final video rendered-fallback delivery.*exact schema 11.*`project-video-render-v1`.*canonical namespaced feature ID.*unavailable or unknown.*closed role.*feature ID.*opaque.*does not discover, load, or execute.*feature code.*`video-clip-render-v1`.*exact registered `videoEffects`.*unavailable.*declared and effective `rendered-fallback`.*relationship role.*target clip ID.*video kind.*source ID.*SHA-256/iu,
	);
	assert.match(
		documentation,
		/whole-project fallback.*frame zero.*video-clip-render-v1.*only its exact target.*track membership.*timeline placement.*duration.*A\/V link.*transition.*active audio whole-mix.*private.*chunk.*otherwise.*canonical audio.*canonical project.*history.*save state.*unchanged/iu,
	);
	assert.match(
		documentation,
		/joint selector-mode verifier.*audio.*video selectors.*requirement ID.*feature ID.*relationship role.*target clip ID.*kind.*source ID.*SHA-256.*cumulative.*before.*body reads.*nonselected fallback.*not read/iu,
	);
	assert.match(
		documentation,
		/canonical native `Blob`.*size-checks and hashes.*same object.*no second fallback-store read.*sole video input.*whole-project role.*selected target input.*clip-local role.*ordinary unaffected video.*composition/iu,
	);
	assert.match(
		documentation,
		/export-task signal.*audio render.*FFmpeg.*prior-output cleanup.*download publication.*recoverable cleanup/iu,
	);
	assert.match(
		documentation,
		/clip-local managed handoff.*target clip ID.*digest-bound fallback body.*fresh recipient.*canonical shadow.*ordinary video export.*portable `\.scape` copy collision.*managed handoff.*remaps only the fallback source ID/iu,
	);
	assert.match(
		documentation,
		/exact one-audio.one-video final-video composition.*qualified.*multiple clip fallbacks.*duplicate same-kind.*other mixed fallback relationships.*other relationship roles.*generic fallback authoring.*third-party feature-code activation.*linked or unmanaged delivery.*packaged runtime.*browser behavior.*codec qualification.*reference-scale evidence.*whole-handoff atomicity.*unqualified/iu,
	);
});
