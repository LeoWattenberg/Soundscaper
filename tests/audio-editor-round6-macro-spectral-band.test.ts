/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { createEffectMacroStep } from '../src/common/editor/effect-macro-steps.ts';
import { createEffectMacroService, type EffectMacroServiceRuntime, type MaterializedMacroEffect }
	from '../src/common/editor/controller/effects/internal/macro/effect-macro-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';

const sampleRate = 48_000;
const frequencyRange = { minimumFrequency: 900, maximumFrequency: 1100 };
type Channels = readonly Float32Array[];
interface Buffer { readonly channels: Channels }
interface RenderTrack { readonly id: string; readonly effects: readonly MaterializedMacroEffect[] }
interface RenderProject { readonly tracks: readonly RenderTrack[] }

for (const effects of [
	[{ type: 'audacity-amplify', params: { gainDb: -12, allowClipping: true } }],
	[{ type: 'audacity-amplify', params: { gainDb: -6, allowClipping: true } }, { type: 'audacity-amplify', params: { gainDb: -6, allowClipping: true } }],
	[{ type: 'audacity-invert', params: {} }],
	[{ type: 'audacity-invert', params: {} }, { type: 'audacity-invert', params: {} }],
	[{ type: 'audacity-amplify', params: { gainDb: -12, allowClipping: true } }, { type: 'audacity-invert', params: {} }],
]) {
	test(`macro spectral targeting preserves the unselected tone through ${effects.map(effect => effect.type).join(' → ')}`, async () => {
		const input = tones();
		const original = input.slice();
		const fixture = createFixture(input);
		assert.equal(await fixture.service.runEffectMacro({ effects }), true);
		assert.deepEqual(input, original);
		const output = fixture.results[0]?.[0];
		assert.ok(output);
		const residual = output.map((sample, frame) => sample - original[frame]!);
		assert.ok(amplitude(residual, 6000) < .001, 'the unselected 6 kHz signal stays unchanged');
		if (effects[0]?.type === 'audacity-amplify') {
			assert.ok(amplitude(output, 1000) < .06, 'the selected 1 kHz signal is attenuated');
		}
		assert.equal(fixture.results.length, 1);
		assert.equal(fixture.batchedCalls.length, 0, 'spectral context cannot cross the context-free batch port');
		if (effects.length > 1 && effects.every(effect => effect.type === 'audacity-invert')) {
			assert.equal(fixture.stagedInputs.length, 2, 'each realtime effect has its own spectral composition');
			const secondInput = fixture.stagedInputs[1]![0]!;
			assert.ok(amplitude(secondInput.map((sample, frame) => sample - input[frame]!), 6000) < .001);
		}
	});
}

test('a length-changing macro refuses its spectral selection before publishing audio', async () => {
	const fixture = createFixture(tones());
	await assert.rejects(fixture.service.runEffectMacro({ effects: [{ type: 'audacity-repeat', params: { count: 1 } }] }), /spectral|frequency/iu);
	assert.equal(fixture.results.length, 0);
});

function createFixture(input: Float32Array) {
	const track = { id: 'audio', name: 'Recording', type: 'audio' as const, clipIds: ['clip'],
		effects: [], gain: 1, pan: 0, mute: false, solo: false, spectrogram: { windowSize: 2048 } };
	const project = { id: 'project', tracks: [track], master: {}, mixer: {},
		selection: { startFrame: 0, endFrame: sampleRate, trackIds: ['audio'], frequencyRange } };
	const target = { track, startFrame: 0, endFrame: sampleRate, durationFrames: sampleRate,
		channelCount: 1, hasAudio: true };
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration(); projectGeneration.activate(project.id);
	const results: Channels[] = [];
	const stagedInputs: Channels[] = [];
	const batchedCalls: unknown[] = [];
	const runtime: EffectMacroServiceRuntime<Buffer> = {
		lifetime, projectGeneration,
		copy: { audioTrackNotFound: 'Track unavailable', audacityApplied: 'Applied', audacityProcessing: 'Processing',
			audacitySelectionHint: 'Select audio', autoDuckControlTrack: 'Select a control', effectInvalidAudio: 'Invalid audio',
			effectRackEmpty: 'Add an effect', noiseProfileMissing: 'Capture a profile', macrosPalette: 'Macros', untitledMacro: 'Macro' },
		memoryLimitBytes: 128 * 1024 ** 2,
		getProject: () => project, audacityEffectTarget: () => target,
		editingBlocked: () => false,
		materializeRackEffect: effect => createEffectMacroStep(effect.type, effect) as MaterializedMacroEffect,
		projectSampleRate: () => sampleRate, projectFrameCount: () => sampleRate,
		effectRackLatencyFrames: () => 0, isAudacityRackEffectType: () => true,
		estimateAudacityEffectPeakBytes: () => 0, audacityEffectMemoryError: () => new Error('Too much audio'),
		setProcessing() {}, setStatus() {}, publishDocumentSnapshot() {}, handleError() {},
		preflightStorage: async () => undefined, cloneProject: value => structuredClone(value),
		renderDryTrackRange: async (_trackId, start, end) => [input.slice(start, end)],
		runSelectionEffectWorker: async request => ({ channels: await applyAudioSelectionEffectAsync(request.effectType,
			[...request.channels], request.sampleRate, request.params, request.context) as Float32Array[] }),
		runSelectionEffectChain: async request => {
			batchedCalls.push(request);
			let channels = request.channels;
			for (const step of request.steps) channels = await applyAudioSelectionEffectAsync(step.effectType,
				[...channels], request.sampleRate, step.params) as Float32Array[];
			return { channels };
		},
		createAudioBuffer: async channels => ({ channels }), audioBufferChannels: buffer => buffer.channels,
		matchAudacitySelectionChannels: channels => [...channels],
		renderSnapshot: snapshot => renderEffects(snapshot, [input]),
		renderStagedSnapshot: (snapshot, range, sourceBuffers) => {
			const sources = [...sourceBuffers.values()] as Buffer[];
			stagedInputs.push(sources[0]!.channels.map(channel => channel.slice()));
			return renderEffects(snapshot, sources[0]!.channels, String(range.trackId));
		},
		persistAudacityEffectResult: async (_target, _type, channels) => { results.push(channels); },
	};
	return { service: createEffectMacroService(runtime), results, stagedInputs, batchedCalls };
}

async function renderEffects(snapshot: unknown, input: Channels, trackId?: string): Promise<Buffer> {
	const project = snapshot as RenderProject;
	const track = project.tracks.find(track => !trackId || track.id === trackId);
	let channels = input;
	for (const effect of track?.effects ?? []) {
		channels = await applyAudioSelectionEffectAsync(effect.type, [...channels], sampleRate, effect.params) as Float32Array[];
	}
	return { channels };
}

function tones(): Float32Array {
	return Float32Array.from({ length: sampleRate }, (_, frame) => .2 * (
		Math.sin(2 * Math.PI * 1000 * frame / sampleRate) + Math.sin(2 * Math.PI * 6000 * frame / sampleRate)));
}

function amplitude(samples: Float32Array, frequency: number): number {
	let real = 0;
	let imaginary = 0;
	for (let frame = 9600; frame < 38_400; frame++) {
		const phase = 2 * Math.PI * frequency * frame / sampleRate;
		real += samples[frame]! * Math.cos(phase); imaginary += samples[frame]! * Math.sin(phase);
	}
	return 2 * Math.hypot(real, imaginary) / 28_800;
}
