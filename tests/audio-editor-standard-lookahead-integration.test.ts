/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { effectGraphKey, effectLatencyFrames, effectRackLatencyFrames } from '../src/common/editor/engine/effect-rack.ts';
import { compileProjectPdcPlan } from '../src/common/editor/engine/project-pdc-plan.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createEffect, normalizeAudioSelectionEffectParams, normalizeEffect } from '../src/common/editor/effects.js';
import { createNoiseGateProcessor } from '../src/common/editor/first-party-effects/standard/noise-gate-dsp.ts';
import { standardDelayLatencyFrames } from '../src/common/editor/first-party-effects/standard/delay-definition.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { MockAudioWorkletNode, createRackProject } from './helpers/audio-editor-runtime-harness.js';

test('old gate settings derive a missing preview from their saved attack and retain explicit zero', () => {
	const params = { attack: .04, hold: .2, release: .3, stereoLink: 'independent', rangeDb: -48 };
	for (const normalized of [createEffect('noise-gate', { params }).params,
		normalizeEffect({ id: 'gate-1', type: 'noise-gate', params }).params,
		normalizeAudioSelectionEffectParams('noise-gate', params)]) {
		const values = normalized as Readonly<Record<string, unknown>>;
		assert.equal(values.lookahead, .04);
		for (const [name, value] of Object.entries(params)) assert.equal(values[name], value);
	}
	assert.equal(createEffect('noise-gate', { params: { ...params, lookahead: 0 } }).params.lookahead, 0);
});

test('gate worklet delay matches rack and track/bus/master PDC at fractional sample durations', () => {
	for (const [sampleRate, lookahead] of [[44100, .003], [48000, .017], [96000, .01]]) {
		const params = { rangeDb: 0, lookahead };
		const effect = { id: 'gate-1', type: 'noise-gate', params };
		const latency = effectLatencyFrames(effect, sampleRate);
		assert.equal(latency, Math.ceil(lookahead * sampleRate));
		const input = new Float32Array(latency + 2);
		input[0] = .5;
		const output = new Float32Array(input.length);
		const processor = createNoiseGateProcessor({ sampleRate, channelCount: 1, params });
		processor.processBlock([input], [output], input.length);
		assert.equal(processor.latencyFrames, latency);
		assert.equal(output.findIndex(sample => sample !== 0), latency);
		assert.equal(effectRackLatencyFrames([effect, { ...effect, enabled: false }, { ...effect, bypassed: true }], sampleRate), latency);
		const project: EngineProject = { sampleRate, tracks: [
			{ id: 'gated-track', effects: [effect] }, { id: 'dry-track', effects: [] },
		], mixer: { groups: [{ id: 'group-1', effects: [effect] }] }, master: { effects: [effect] } };
		const plan = compileProjectPdcPlan(project);
		assert.equal(plan.trackLatencyFrames.get('gated-track'), latency);
		assert.equal(plan.trackLatencyFrames.get('dry-track'), 0);
		assert.equal(plan.busLatencyFrames.get('group-1'), latency);
		assert.equal(plan.masterLatencyFrames, latency);
		assert.equal(plan.latencyFrames, latency * 3);
	}
});

test('pitched delays declare the same StaffPad latency as their processor contract', () => {
	for (const pitchShift of [-2, 0, 2]) {
		const params = { pitchShift, echoes: 3, mix: 1 };
		assert.equal(effectLatencyFrames({ type: 'multi-tap-delay', params }, 48000), standardDelayLatencyFrames(params, 48000));
	}
});

test('live gate preview edits request graph rebuild without posting or consuming a revision', async () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
	Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, writable: true, value: MockAudioWorkletNode });
	const context = new MockAudioContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as AudioContext, meterInterval: 1000 });
	const runtime = engine as unknown as Pick<EngineRuntimeHost, 'project' | 'graph'>;
	const project = createRackProject({ tracks: [{ id: 'track-1', effects: [
		{ id: 'gate-1', type: 'noise-gate', params: createEffect('noise-gate').params },
	] }] });
	try {
		engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(2, 4800, 48000) as unknown as AudioBuffer]]));
		await engine.play();
		const key = effectGraphKey('track', 'track-1', 'gate-1');
		const node = context.workletNodes[0];
		assert.ok(node);
		assert.equal(engine.configureRackEffect('track', 'track-1', 'gate-1', { threshold: -30 }, { revision: 4 }), 4);
		const previousProject = runtime.project;
		const previousMessages = node.messages.slice();
		assert.equal(engine.configureRackEffect('track', 'track-1', 'gate-1', { lookahead: .02 }, { revision: 99 }), false);
		assert.equal(runtime.project, previousProject);
		assert.deepEqual(node.messages, previousMessages);
		assert.equal(runtime.graph?.effectMessageSequences.get(key), 4);
		assert.equal(engine.configureRackEffect('track', 'track-1', 'gate-1', { attack: .02 }, { revision: 5 }), 5,
			'attack can update live when an explicit preview keeps latency constant');
		assert.equal(runtime.graph?.latencyFrames, 480);
	} finally {
		await engine.dispose();
		if (descriptor) Object.defineProperty(globalThis, 'AudioWorkletNode', descriptor);
		else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
	}
});
