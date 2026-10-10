/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createSourceEditorEffects } from '../src/common/editor/controller/effects/internal/source-editor-effects.ts';
import type { EffectSelectionProject } from '../src/common/editor/controller/effects/effect-selection-service.ts';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { assertAudacityEffectOutput } from '../src/common/editor/audacity-effects/contracts.js';
import { createBuffer, createHarness, requireBatch, target } from './helpers/effect-result-service-fixture.ts';

for (const channelCount of [1, 2, 6, 32]) {
	test(`source processing preserves all ${channelCount} native channels and untouched samples`, async () => {
		const input = Array.from({ length: channelCount }, (_, index) => Float32Array.of(
			0.1 + index / 100, 0.2 + index / 100, 0.3 + index / 100, 0.4 + index / 100));
		const source = createAudioSource({ id: 'recording', name: 'Recording', channelCount,
			frameCount: 4, sampleRate: 48_000, originalSampleRate: 48_000 });
		const clip = createAudioClip({ id: 'phrase', sourceId: source.id,
			sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4, timelineStartFrame: 100 });
		const project = createSoundscaperProject({ id: 'source-effect-project', sources: [source],
			clips: [clip], tracks: [createAudioTrack({ id: 'audio', clipIds: [clip.id] })] });
		const runtimeProject = projectForRuntimeConsumers(project);
		const sourceEditor = createSourceEditorEffects({
			getProject: () => runtimeProject as unknown as EffectSelectionProject,
			loadSourceBuffer: async () => createBuffer(input), publishDocumentSnapshot() {},
		});
		sourceEditor.setSourceSelection({ clipId: clip.id, startFrame: 1, endFrame: 3 });
		const selected = sourceEditor.target();
		assert.ok(selected);
		const dry = await sourceEditor.renderRange(selected.track.id, selected.startFrame, selected.endFrame);
		assert.ok(dry);
		const channels = await applyAudioSelectionEffectAsync('audacity-invert', dry, 48_000);
		const harness = createHarness({ runtime: {
			getProject: () => runtimeProject, expandSourceResult: sourceEditor.expandResult,
			assertAudacityEffectOutput,
		} });
		await harness.service.persistAudacityEffectResults([{ target: selected, channels }], 'audacity-invert');
		const command = requireBatch(harness.events.commits[0]!.command);
		const processed = command.commands[0]!;
		assert.equal(processed.type, 'source/process-audio');
		if (processed.type !== 'source/process-audio') return;
		assert.equal(processed.source.channelCount, channelCount);
		assert.ok(typeof processed.source.id === 'string');
		const saved = harness.sourceBuffers.get(processed.source.id) as ReturnType<typeof createBuffer>;
		for (let channel = 0; channel < channelCount; channel++) {
			assert.deepEqual(saved.getChannelData(channel), Float32Array.of(
				input[channel]![0]!, -input[channel]![1]!, -input[channel]![2]!, input[channel]![3]!));
		}
		const after = applySoundscaperProjectCommand(project, command);
		assert.equal(after.clips[0]!.sourceId, processed.source.id);
		assert.equal(after.clips[0]!.timelineStartFrame, 100);
		assert.equal(after.sources.find(item => item.id === processed.source.id)!.channelCount, channelCount);
		assert.deepEqual(after.selection, project.selection);
	});
}

test('source and timeline processing keep the bounded native layout', async () => {
	for (const [channelCount, sourceId] of [[33, 'recording'], [33, undefined]] as const) {
		const harness = createHarness();
		const selected = { ...target('audio', { channelCount }), ...(sourceId ? { sourceId } : {}) };
		await assert.rejects(harness.service.persistAudacityEffectResults([{
			target: selected, channels: Array.from({ length: channelCount }, () => Float32Array.of(0.2)),
		}], 'audacity-invert'), /Invalid audio/u);
		assert.equal(harness.events.sourcesOpened.length, 0);
		assert.equal(harness.events.commits.length, 0);
	}
});
