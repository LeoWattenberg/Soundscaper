/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createParallelStackEffectMailbox,
	publishParallelStackEffectUpdate,
	readParallelStackEffectUpdate,
} from '../src/common/editor/engine/parallel-stack-effect-mailbox.ts';
import { postEffectMessage } from '../src/common/editor/engine/effect-rack.ts';
import { compileParallelStackEffect } from '../src/common/editor/engine/parallel-stack-effects.ts';
import { PARALLEL_STACK_MEMORY_LIMIT } from '../src/common/editor/engine/parallel-stack-plan-validation.ts';
import { compileParallelStackPlan } from '../src/common/editor/engine/parallel-stack-plan.ts';
import { registerParallelStackLiveControls } from '../src/common/editor/engine/parallel-stack-live-controls.ts';
import type { ProjectGraph } from '../src/common/editor/engine/project-graph.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

function effectProject(type: string, params: Readonly<Record<string, unknown>>): EngineProject {
	return {
		schemaFamily: 'soundscaper', schemaVersion: 1, sampleRate: 48_000, masterChannels: 2,
		tracks: [{ id: 'track-1', type: 'audio', channelCount: 2, effectsActive: true,
			effects: [{ id: 'effect-1', type, enabled: true, params }] }],
		master: { id: 'master', effects: [] },
		mixer: { schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				{ id: 'track-master', kind: 'assignment', source: { kind: 'track', id: 'track-1' },
					destination: { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
				{ id: 'master-main', kind: 'assignment', source: { kind: 'master' },
					destination: { kind: 'output', id: 'main' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
			],
		},
	} as unknown as EngineProject;
}

function registeredEffect(type: string, params: Readonly<Record<string, unknown>>, memoryBytes?: number) {
	const plan = compileParallelStackPlan(effectProject(type, params), { sampleRate: 48_000, workerCount: 2 });
	const mailbox = createParallelStackEffectMailbox(plan.tasks.reduce((count, task) => count + task.effects.length, 0));
	const graph = {
		abortController: new AbortController(),
		effectNodes: new Map(),
		effectMessageSequences: new Map<string, number>(),
	} as unknown as ProjectGraph;
	registerParallelStackLiveControls(graph, memoryBytes === undefined ? plan : { ...plan, memoryBytes }, mailbox);
	const owner = plan.tasks.findIndex((task) => task.key === 'track:track-1');
	assert.ok(owner >= 0);
	const index = plan.tasks.slice(0, owner).reduce((count, task) => count + task.effects.length, 0);
	return { graph, mailbox, index };
}

test('parallel effect mailbox publishes the latest complete parameter frame once', () => {
	const mailbox = createParallelStackEffectMailbox(1);
	assert.equal(publishParallelStackEffectUpdate(mailbox, 0, { params: { frequency: 100 } }), true);
	assert.equal(publishParallelStackEffectUpdate(mailbox, 0, { params: { frequency: 200 } }), true);
	assert.equal(publishParallelStackEffectUpdate(mailbox, 0, {
		params: { frequency: 300 }, transitionFrames: 64,
	}), true);

	const latest = readParallelStackEffectUpdate(mailbox, 0, 0);
	assert.ok(latest);
	assert.deepEqual(latest.params, { frequency: 300 });
	assert.equal(latest.transitionFrames, 64);
	assert.ok(Number.isSafeInteger(latest.version) && latest.version > 0);
	assert.equal(readParallelStackEffectUpdate(mailbox, 0, latest.version), null);

	assert.equal(publishParallelStackEffectUpdate(mailbox, 0, { params: { frequency: 400 } }), true);
	const next = readParallelStackEffectUpdate(mailbox, 0, latest.version);
	assert.ok(next);
	assert.ok(next.version > latest.version);
	assert.deepEqual(next.params, { frequency: 400 });
	assert.equal(next.transitionFrames, undefined);
});

test('parallel effect mailbox never exposes an in-progress seqlock publication', () => {
	const mailbox = createParallelStackEffectMailbox(1);
	assert.equal(publishParallelStackEffectUpdate(mailbox, 0, { params: { mix: 0.25 } }), true);
	const original = readParallelStackEffectUpdate(mailbox, 0, 0);
	assert.ok(original);

	// The first control word is the first effect slot's even publication version.
	const control = mailbox.control instanceof Int32Array
		? mailbox.control : new Int32Array(mailbox.control);
	const stable = Atomics.load(control, 0);
	assert.equal(stable % 2, 0);
	Atomics.store(control, 0, stable + 1);
	try {
		assert.equal(readParallelStackEffectUpdate(mailbox, 0, 0), null);
	} finally {
		Atomics.store(control, 0, stable);
	}
	assert.deepEqual(readParallelStackEffectUpdate(mailbox, 0, 0), original);
});

test('parallel effect mailbox keeps independent effects isolated', () => {
	const mailbox = createParallelStackEffectMailbox(2);
	assert.equal(publishParallelStackEffectUpdate(mailbox, 0, { params: { gain: 0.25 } }), true);
	const first = readParallelStackEffectUpdate(mailbox, 0, 0);
	assert.ok(first);
	assert.equal(readParallelStackEffectUpdate(mailbox, 1, 0), null);

	assert.equal(publishParallelStackEffectUpdate(mailbox, 1, { params: { gain: 0.75 } }), true);
	const second = readParallelStackEffectUpdate(mailbox, 1, 0);
	assert.ok(second);
	assert.deepEqual(second.params, { gain: 0.75 });
	assert.equal(readParallelStackEffectUpdate(mailbox, 0, first.version), null);
	assert.deepEqual(readParallelStackEffectUpdate(mailbox, 0, 0), first);
});

test('an oversized parallel effect update leaves the last accepted frame intact', () => {
	const mailbox = createParallelStackEffectMailbox(1);
	assert.equal(publishParallelStackEffectUpdate(mailbox, 0, { params: { mix: 0.25 } }), true);
	const accepted = readParallelStackEffectUpdate(mailbox, 0, 0);
	assert.ok(accepted);

	assert.equal(publishParallelStackEffectUpdate(mailbox, 0, {
		params: { oversized: 'x'.repeat(4 * 1024 * 1024) },
	}), false);
	assert.deepEqual(readParallelStackEffectUpdate(mailbox, 0, 0), accepted);
	assert.equal(readParallelStackEffectUpdate(mailbox, 0, accepted.version), null);
});

test('a rollback publishes the original parameters after a live preview', () => {
	const mailbox = createParallelStackEffectMailbox(1);
	const original = { frequency: 1_000, q: 0.7 };
	assert.equal(publishParallelStackEffectUpdate(mailbox, 0, { params: original }), true);
	const baseline = readParallelStackEffectUpdate(mailbox, 0, 0);
	assert.ok(baseline);

	assert.equal(publishParallelStackEffectUpdate(mailbox, 0, { params: { frequency: 4_000, q: 2 } }), true);
	const preview = readParallelStackEffectUpdate(mailbox, 0, baseline.version);
	assert.ok(preview);
	assert.deepEqual(preview.params, { frequency: 4_000, q: 2 });

	assert.equal(publishParallelStackEffectUpdate(mailbox, 0, {
		params: original, transitionFrames: 0,
	}), true);
	const restored = readParallelStackEffectUpdate(mailbox, 0, preview.version);
	assert.ok(restored);
	assert.ok(restored.version > preview.version);
	assert.deepEqual(restored.params, original);
	assert.equal(restored.transitionFrames, 0);
});

test('the parallel graph sends revisioned controls to its owning worker and restores on cancel', () => {
	const original = { bitDepth: 8, downsampling: 3.5, dither: 'none', interpolation: 'linear', mix: 100 };
	const { graph, mailbox, index } = registeredEffect('bitcrusher', original);
	const first = { ...original, bitDepth: 4 };
	const second = { ...original, bitDepth: 6 };
	assert.equal(postEffectMessage(graph, 'track', 'track-1', 'effect-1', {
		type: 'configure', params: first,
	}), 1);
	const firstUpdate = readParallelStackEffectUpdate(mailbox, index, 0);
	assert.ok(firstUpdate);
	assert.deepEqual(firstUpdate.params, first);

	assert.equal(postEffectMessage(graph, 'track', 'track-1', 'effect-1', {
		type: 'configure', params: second,
	}), 2);
	const secondUpdate = readParallelStackEffectUpdate(mailbox, index, firstUpdate.version);
	assert.ok(secondUpdate);
	assert.deepEqual(secondUpdate.params, second);
	assert.ok(secondUpdate.version > firstUpdate.version);

	assert.equal(postEffectMessage(graph, 'track', 'track-1', 'effect-1', { type: 'audition' }), false);
	assert.equal(readParallelStackEffectUpdate(mailbox, index, secondUpdate.version), null);
	assert.equal(postEffectMessage(graph, 'track', 'track-1', 'effect-1', {
		type: 'configure', params: original,
	}), 3, 'cancel/rollback must publish after the most recent preview');
	const restored = readParallelStackEffectUpdate(mailbox, index, secondUpdate.version);
	assert.ok(restored);
	assert.deepEqual(restored.params, original);
	assert.ok(restored.version > secondUpdate.version);

	graph.abortController.abort();
	assert.equal(postEffectMessage(graph, 'track', 'track-1', 'effect-1', {
		type: 'configure', params: first,
	}), false, 'a retired graph must reject late control gestures');
	assert.equal(readParallelStackEffectUpdate(mailbox, index, restored.version), null);
});

test('a latency-changing parallel control refuses preview without consuming a revision', () => {
	const original = { threshold: -40, attack: .01, lookahead: .01, hold: .05,
		release: .1, rangeDb: -24, gateFrequency: 0, stereoLink: 'linked' };
	const { graph, mailbox, index } = registeredEffect('noise-gate', original);
	assert.equal(postEffectMessage(graph, 'track', 'track-1', 'effect-1', {
		type: 'configure', params: { ...original, threshold: -36 },
	}), 1);
	const accepted = readParallelStackEffectUpdate(mailbox, index, 0);
	assert.ok(accepted);

	assert.equal(postEffectMessage(graph, 'track', 'track-1', 'effect-1', {
		type: 'configure', params: { ...original, lookahead: .02 },
	}), false);
	assert.equal(readParallelStackEffectUpdate(mailbox, index, accepted.version), null);
	assert.equal(postEffectMessage(graph, 'track', 'track-1', 'effect-1', {
		type: 'configure', params: original,
	}), 2);
});

test('a live delay resize must fit its transient old and new histories in the memory budget', () => {
	const original = { time: 0.1, echoGain: -6, echoes: 1, pitchShift: 0, mix: 1, delayType: 'regular' };
	const expanded = { ...original, time: 2, echoes: 5 };
	const initialBytes = compileParallelStackEffect({ id: 'effect-1', type: 'multi-tap-delay', params: original }, 48_000, 2).stateBytes;
	const expandedBytes = compileParallelStackEffect({ id: 'effect-1', type: 'multi-tap-delay', params: expanded }, 48_000, 2).stateBytes;
	assert.ok(expandedBytes > initialBytes);
	// A net-growth check would admit this update, but both delay rings coexist
	// until the worker installs the larger history.
	const memoryBytes = PARALLEL_STACK_MEMORY_LIMIT - expandedBytes + 1;
	assert.ok(memoryBytes + expandedBytes - initialBytes <= PARALLEL_STACK_MEMORY_LIMIT);
	const { graph, mailbox, index } = registeredEffect('multi-tap-delay', original, memoryBytes);
	assert.equal(postEffectMessage(graph, 'track', 'track-1', 'effect-1', {
		type: 'configure', params: expanded,
	}), false);
	assert.equal(readParallelStackEffectUpdate(mailbox, index, 0), null);
});
