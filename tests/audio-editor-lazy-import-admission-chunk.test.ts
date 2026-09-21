/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

test('foreground import admission stays in a focused lazy owner independent of codec execution', () => {
	for (const module of ['controller/import/freesound-import-service.ts', 'controller/import/internal/import-task-cancellation.ts', 'controller/import/internal/project-import-admission.ts', 'controller/import/internal/standalone-audio-import-decoder.ts', 'encoded-audio-marker-scan.ts', 'streamed-audio-import-file.ts']) {
		assert.equal(chunkGroupForModulePath(`/workspace/src/common/editor/${module}`), 'editor-import-admission', module);
	}
	const group = chunkGroups.find(({ name }) => name === 'editor-import-admission');
	assert.ok(group);
	assert.ok(group.test instanceof RegExp);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(group.test.test('/workspace/src/common/editor/controller/import/internal/project-import-service.ts'), false);
	assert.equal(group.test.test('/workspace/src/common/editor/controller/import/internal/project-import-options.ts'), false);
	assert.equal(group.test.test('/workspace/src/common/editor/browser-reviewed-streamed-audio-decoders.ts'), false);
});

test('worker and utility codec sessions share the optional validation parser owner', () => {
	for (const module of ['browser-dedicated-audio-codec', 'browser-dedicated-audio-output-validation', 'dedicated-audio-encode-session']) {
		assert.equal(chunkGroupForModulePath(`/workspace/src/common/editor/${module}.ts`), 'editor-optional-execution', module);
	}
});

test('stored source activation keeps its lazy waveform work outside the controller owner', () => {
	assert.equal(chunkGroupForModulePath('/workspace/src/common/editor/controller/source/internal/stored-source-activation.ts'), 'editor-source-activation');
	const group = chunkGroups.find(({ name }) => name === 'editor-source-activation');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.ok(group.test instanceof RegExp);
	assert.equal(group.test.test('/workspace/src/common/editor/controller/source/source-lifecycle-service.ts'), false);
});

test('file-backed export provenance shares the optional admission owner', () => {
	for (const module of ['file-backed-audio-export', 'audio-export-output']) {
		assert.equal(chunkGroupForModulePath(`/workspace/src/common/editor/${module}.ts`), 'editor-optional-export', module);
	}
});

test('foreground and archive import callers share one deferred module request', async () => {
	const { loadImportAdmissionExecution } = await import('../src/common/editor/controller/import/internal/import-admission-loader.ts');
	const foreground = loadImportAdmissionExecution();
	const archive = loadImportAdmissionExecution();
	assert.equal(foreground, archive);
	const execution = await foreground;
	assert.equal(execution.isStreamedAudioImportFile(new File([], 'recording.mp3')), true);
	assert.equal(await execution.scanEncodedAudioMarkers(null), null);
	assert.equal(loadImportAdmissionExecution(), foreground);
});
