/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { createEffectMacroService, type EffectMacroServiceRuntime }
	from '../src/common/editor/controller/effects/internal/macro/effect-macro-service.ts';
import type { SelectionEffectResult } from '../src/common/editor/controller/effects/internal/effect-result-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';

const truncate = { type: 'audacity-truncate-silence', params: {
	independent: false, minimumSilence: .5, truncateTo: 0,
} };
for (const effects of [
	[truncate],
	[{ type: 'audacity-amplify', params: { gainDb: -6, allowClipping: true } }, truncate,
		{ type: 'audacity-fade-out', params: {} }],
	[truncate, truncate],
]) test(`linked macro tracks stay synchronized through ${effects.map(effect => effect.type).join(' → ')}`, async () => {
	const fixture = createFixture();
	await fixture.service.runEffectMacro({ effects });
	assert.equal(fixture.batches.length, 1);
	assert.deepEqual(fixture.batches[0]!.map(result => result.channels.map(channel => channel.length)), [[1400], [1400]]);
	assert.equal(fixture.batches[0]![0]!.channels[0]![350], 0, 'first microphone retains its unmatched pause');
	assert.ok(Math.abs(fixture.batches[0]![1]!.channels[0]![350]!) > .1, 'second microphone remains audible at the same instant');
	assert.deepEqual(fixture.input, fixture.original);
	assert.ok(fixture.jointRequests.length > 0, 'linked detector receives both dialogue tracks together');
});

test('linked macro grouping retains stereo channel ownership', async () => {
	const fixture = createFixture({ stereo: true });
	await fixture.service.runEffectMacro({ effects: [truncate] });
	assert.deepEqual(fixture.batches[0]!.map(result => result.channels.map(channel => channel.length)), [[1400, 1400], [1400]]);
	assert.equal(fixture.jointRequests[0], 3);
});

test('independent-track macro requests retain their separate pauses', async () => {
	const fixture = createFixture();
	await fixture.service.runEffectMacro({ effects: [{ ...truncate, params: { ...truncate.params, independent: true } }] });
	assert.deepEqual(fixture.batches[0]!.map(result => result.channels[0]!.length), [1000, 1000]);
	assert.equal(fixture.jointRequests.length, 0);
});

test('unaligned clip targets retain independent macro processing', async () => {
	const fixture = createFixture({ offset: 100 });
	await fixture.service.runEffectMacro({ effects: [truncate] });
	assert.deepEqual(fixture.batches[0]!.map(result => result.channels[0]!.length), [1000, 1000]);
	assert.equal(fixture.jointRequests.length, 0);
});

function createFixture(options: Readonly<{ stereo?: boolean; offset?: number }> = {}) {
	const input = [.3, .7].map(pause => {
		const channel = new Float32Array(2000).fill(.35);
		channel.fill(0, pause * 1000, (pause + 1) * 1000);
		return [channel];
	});
	if (options.stereo) input[0]!.push(input[0]![0]!.slice());
	const original = input.map(channels => channels.map(channel => channel.slice()));
	const tracks = input.map((_channels, index) => ({ id: `audio-${index}`, name: 'Dialogue', type: 'audio' as const,
		clipIds: [`clip-${index}`], effects: [], gain: 1, pan: 0, mute: false, solo: false }));
	const project = { id: 'project', tracks, master: {}, mixer: {} };
	const targets = tracks.map((track, index) => ({ track, startFrame: index ? options.offset ?? 0 : 0,
		endFrame: 2000 + (index ? options.offset ?? 0 : 0), durationFrames: 2000,
		channelCount: input[index]!.length, hasAudio: true, clipIds: track.clipIds }));
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration(); projectGeneration.activate(project.id);
	const batches: Array<readonly SelectionEffectResult[]> = [];
	const jointRequests: number[] = [];
	const runtime: EffectMacroServiceRuntime = {
		lifetime, projectGeneration, memoryLimitBytes: 128 * 1024 ** 2,
		copy: { audioTrackNotFound: 'Missing track', audacityApplied: 'Applied', audacityProcessing: 'Processing',
			audacitySelectionHint: 'Select audio', autoDuckControlTrack: 'Select control', effectInvalidAudio: 'Invalid audio',
			effectRackEmpty: 'Add effect', noiseProfileMissing: 'Capture profile', macrosPalette: 'Macros', untitledMacro: 'Macro' },
		getProject: () => project, audacityEffectTarget: () => targets[0]!, audacityEffectTargets: () => targets,
		editingBlocked: () => false, materializeRackEffect: () => assert.fail('These are offline effects'),
		projectSampleRate: () => 1000, projectFrameCount: () => 2100,
		effectRackLatencyFrames: () => 0, isAudacityRackEffectType: () => false,
		estimateAudacityEffectPeakBytes: () => 0, audacityEffectMemoryError: () => new Error('Too large'),
		setProcessing() {}, setStatus() {}, publishDocumentSnapshot() {}, handleError() {},
		preflightStorage: async () => undefined, cloneProject: value => structuredClone(value),
		renderDryTrackRange: async (trackId, start, end) => {
			const index = tracks.findIndex(track => track.id === trackId);
			return input[index]!.map(channel => channel.slice(start - targets[index]!.startFrame, end - targets[index]!.startFrame));
		},
		runSelectionEffectWorker: async request => {
			if (request.channels.length > (options.stereo ? 2 : 1)) jointRequests.push(request.channels.length);
			return { channels: await applyAudioSelectionEffectAsync(request.effectType, [...request.channels],
				request.sampleRate, request.params, request.context) as Float32Array[] };
		},
		createAudioBuffer: async () => assert.fail('No realtime rack'), renderSnapshot: async () => assert.fail('No realtime rack'),
		renderStagedSnapshot: async () => assert.fail('No realtime rack'), audioBufferChannels: () => assert.fail('No realtime rack'),
		matchAudacitySelectionChannels: channels => [...channels],
		persistAudacityEffectResult: async () => assert.fail('All tracks belong to one result batch'),
		persistAudacityEffectResults: async results => { batches.push(results); },
	};
	return { service: createEffectMacroService(runtime), batches, input, original, jointRequests };
}
