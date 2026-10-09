/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createEffect } from '../src/common/editor/effects.js';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';
import { effectGraphKey } from '../src/common/editor/engine/effect-rack.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import { nativeRackEffectCommit, supportsLiveRackEffectGesture } from '../src/common/editor/ui/inspector/live-rack-effect-gesture.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { MockAudioWorkletNode, createRackProject } from './helpers/audio-editor-runtime-harness.js';

interface EchoProcessor {
	readonly tailFrames: number;
	process(input: Float32Array[], output: Float32Array[]): boolean;
	updateParams(params: Readonly<Record<string, unknown>>): void;
	reset(): void;
}

function echo(channelCount: number) {
	const processor = createAudacityLiveProcessor('audacity-echo', 1_000,
		{ delaySeconds: .01, decay: .8 }) as EchoProcessor;
	const input = Array.from({ length: channelCount }, (_, index) => {
		const signal = new Float32Array(13);
		signal[0] = (index + 1) / 4;
		return signal;
	});
	const first = input.map(() => new Float32Array(13));
	processor.process(input, first);
	for (let channel = 0; channel < channelCount; channel++) {
		assert.equal(first[channel]?.[10], Math.fround(((channel + 1) / 4) * .8));
	}
	return processor;
}

for (const channels of [1, 2]) {
	test(`Echo Decay retains the already audible ${channels}-channel ring and its current position`, () => {
		const processor = echo(channels);
		processor.updateParams({ decay: .7 });
		const output = Array.from({ length: channels }, () => new Float32Array(12));
		processor.process(output.map(() => new Float32Array(12)), output);
		for (let channel = 0; channel < channels; channel++) {
			const expected = new Float32Array(12);
			expected[7] = Math.fround(((channel + 1) / 4) * .8) * .7;
			assert.deepEqual(output[channel], expected);
		}
		assert.equal(processor.tailFrames, 200);
	});
}

test('Echo explicit reset and a changed delay geometry retain their clearing contract', () => {
	for (const change of ['reset', 'delay'] as const) {
		const processor = echo(1);
		if (change === 'reset') processor.reset();
		else processor.updateParams({ delaySeconds: .02 });
		const output = [new Float32Array(40)];
		processor.process([new Float32Array(40)], output);
		assert.deepEqual(output, [new Float32Array(40)]);
	}
});

test('the ordinary Echo parameter surface admits a running processor but preserves bypass controls', () => {
	const effect = createEffect('audacity-echo');
	assert.equal(supportsLiveRackEffectGesture(effect, {}), true);
	assert.equal(supportsLiveRackEffectGesture({ ...effect, enabled: false }, {}), false);
	assert.equal(supportsLiveRackEffectGesture({ ...effect, bypassed: true }, {}), false);
	assert.equal(supportsLiveRackEffectGesture(effect, { effectsActive: false }), false);
});

test('an ordinary committed Echo field uses one gesture with all current parameters', async () => {
	const calls: unknown[] = [];
	const effect = createEffect('audacity-echo', { params: { delaySeconds: 1, decay: .8 } });
	const commit = nativeRackEffectCommit(effect, { decay: .7 }, () => { calls.push('begin'); },
		params => { calls.push(params); });
	assert.ok(commit);
	await commit();
	assert.deepEqual(calls, ['begin', { delaySeconds: 1, decay: .7 }]);
});

test('the real rack engine adopts Echo Decay with the existing worklet message and keeps geometry rebuilds', async () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, writable: true, value: MockAudioWorkletNode });
	const context = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as AudioContext, meterInterval: 1000 });
	const runtime = engine as unknown as Pick<EngineRuntimeHost, 'project' | 'graph'>;
	const project = createRackProject({ tracks: [{ id: 'track-1', effects: [
		{ ...createEffect('audacity-echo', { params: { delaySeconds: 1, decay: .8 } }), id: 'echo-1' },
	] }] });
	try {
		engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(2, 4800, 48000) as unknown as AudioBuffer]]));
		await engine.play();
		const node = context.workletNodes.find(candidate => !candidate.readinessProbe);
		assert.ok(node);
		const previousGraph = runtime.graph;
		assert.equal(engine.configureRackEffect('track', 'track-1', 'echo-1', { decay: .7 }, { revision: 4 }), 4);
		assert.equal(runtime.graph, previousGraph);
		assert.deepEqual(node.messages, [{ type: 'params', params: { delaySeconds: 1, decay: .7 }, revision: 4, sequence: 4 }]);
		assert.equal(runtime.project?.tracks?.[0]?.effects?.[0]?.params?.decay, .7);
		const key = effectGraphKey('track', 'track-1', 'echo-1');
		const previousProject = runtime.project;
		assert.equal(engine.configureRackEffect('track', 'track-1', 'echo-1', { delaySeconds: 2 }, { revision: 99 }), false);
		assert.equal(runtime.project, previousProject);
		assert.equal(runtime.graph?.effectMessageSequences.get(key), 4);
		assert.equal(node.messages.length, 1);
		assert.equal(engine.configureRackEffect('track', 'track-1', 'echo-1', { decay: .3 }, { revision: 4 }), false);
		assert.equal(runtime.project, previousProject);
		assert.throws(() => engine.configureRackEffect('track', 'track-1', 'echo-1', { decay: 1 }, { revision: 5 }), RangeError);
		assert.equal(node.messages.length, 1);
	} finally {
		await engine.dispose();
		if (descriptor) Object.defineProperty(globalThis, 'AudioWorkletNode', descriptor);
		else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
	}
});
