/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHarness } from './audio-editor-effect-audio-service-fixture.ts';
import { createSourceEditorEffects } from '../src/common/editor/controller/effects/internal/source-editor-effects.ts';
import type { EffectAudioProject } from '../src/common/editor/controller/effects/internal/effect-audio-service.ts';
import type { EffectSelectionProject } from '../src/common/editor/controller/effects/effect-selection-service.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { applySpectralGain } from '../src/common/editor/spectral-edit.js';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

for (const sourceRate of [24_000, 48_000]) test(`spectral source deletion keeps its ${sourceRate} Hz frequency clock`, async () => {
	const input = Float32Array.from({ length: sourceRate }, (_, frame) =>
		0.35 * Math.sin(2 * Math.PI * 1000 * frame / sourceRate)
		+ 0.1 * Math.sin(2 * Math.PI * 6000 * frame / sourceRate));
	const source = createAudioSource({ id: 'tone', frameCount: sourceRate, channelCount: 1,
		sampleRate: sourceRate, originalSampleRate: sourceRate, sampleFormat: 'float32', chunkFrames: 65_536 });
	const clip = createAudioClip({ id: 'phrase', sourceId: source.id, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: sourceRate, durationFrames: 48_000 });
	const project = createSoundscaperProject({ id: 'spectral-source-project', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'audio', clipIds: [clip.id] })],
		selection: { startFrame: 0, endFrame: 48_000, trackIds: ['audio'], clipIds: [],
			frequencyRange: { minimumFrequency: 900, maximumFrequency: 1100 } } });
	const buffer = { sampleRate: sourceRate, length: sourceRate, numberOfChannels: 1,
		getChannelData: () => input };
	const sourceEditor = createSourceEditorEffects({
		getProject: () => projectForRuntimeConsumers(project) as unknown as EffectSelectionProject,
		loadSourceBuffer: async () => buffer, publishDocumentSnapshot() {},
	});
	sourceEditor.setSourceSelection({ clipId: clip.id, startFrame: 0, endFrame: sourceRate });
	const target = sourceEditor.target();
	assert.ok(target);
	let output: Float32Array[] = [];
	const harness = createHarness({ project: project as unknown as EffectAudioProject, target,
		renderSourceRange: sourceEditor.renderRange,
		runSpectralEditWorker: async (channels, options) => {
			output = applySpectralGain(channels, options) as Float32Array[];
			return output;
		} });
	assert.equal(await harness.service.applySpectralSelection(-Infinity), true);
	const processed = output[0];
	assert.ok(processed);
	assert.equal(processed.length, sourceRate);
	assert.ok(toneAmplitude(processed, 1000, sourceRate) < 0.01, 'the selected 1000 Hz tone is deleted');
	assert.ok(toneAmplitude(processed, 6000, sourceRate) > 0.095, 'the unselected 6000 Hz tone survives');
	assert.equal(harness.persisted.length, 1);
});

function toneAmplitude(samples: Float32Array, frequency: number, sampleRate: number): number {
	const start = Math.round(sampleRate * 0.2);
	const end = Math.round(sampleRate * 0.8);
	let cosine = 0;
	let sine = 0;
	for (let frame = start; frame < end; frame++) {
		const angle = 2 * Math.PI * frequency * frame / sampleRate;
		cosine += samples[frame]! * Math.cos(angle);
		sine += samples[frame]! * Math.sin(angle);
	}
	return 2 * Math.hypot(cosine, sine) / (end - start);
}
