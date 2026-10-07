/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

function exportPolarity(inverted: boolean) {
	const source = createAudioSource({ id: 'recording', name: 'Take.wav', sampleRate: 48_000,
		frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'take', sourceId: source.id, durationFrames: 48_000,
		sourceDurationFrames: 48_000, inverted });
	const project = createSoundscaperProject({ id: 'polarity-project', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] })] });
	const original = structuredClone(project);
	const result = createDawprojectExport({ project: projectForRuntimeConsumers(project as never) as unknown as Readonly<Record<string, unknown>> });
	assert.deepEqual(project, original);
	return result;
}

test('DAWproject discloses the omitted authored polarity at its exact clip scope', () => {
	const result = exportPolarity(true);
	const item = result.report.items.find(({ code }) => code === 'dawproject.clip-features-omitted');
	assert.ok(item, 'Inverted original PCM cannot be called an unchanged delivery.');
	assert.equal(item.disposition, 'omitted');
	assert.equal(item.severity, 'warning');
	assert.deepEqual(item.scope, { kind: 'clip', id: 'take' });
	assert.deepEqual(item.data.features, ['inverted']);
	assert.equal(result.report.counts.omitted, 1);
});

test('ordinary source polarity creates no unsupported-feature warning', () => {
	const result = exportPolarity(false);
	assert.equal(result.report.items.some(({ code }) => code === 'dawproject.clip-features-omitted'), false);
	assert.equal(result.report.counts.omitted, 0);
});
