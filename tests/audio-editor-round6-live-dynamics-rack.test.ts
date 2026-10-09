/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createEffect } from '../src/common/editor/effects.js';
import { effectGraphKey } from '../src/common/editor/engine/effect-rack.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import { nativeRackEffectCommit, supportsLiveRackEffectGesture } from '../src/common/editor/ui/inspector/live-rack-effect-gesture.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { MockAudioWorkletNode, createRackProject } from './helpers/audio-editor-runtime-harness.js';

for (const type of ['audacity-compressor', 'audacity-limiter']) {
	test(`${type} ordinary controls admit a live release edit and preserve bypass admission`, async () => {
		const effect = createEffect(type);
		assert.equal(supportsLiveRackEffectGesture(effect, {}), true);
		assert.equal(supportsLiveRackEffectGesture({ ...effect, enabled: false }, {}), false);
		assert.equal(supportsLiveRackEffectGesture({ ...effect, bypassed: true }, {}), false);
		assert.equal(supportsLiveRackEffectGesture(effect, { effectsActive: false }), false);
		const calls: unknown[] = [];
		const next = { releaseMs: 101 };
		const commit = nativeRackEffectCommit(effect, next,
			() => { calls.push('begin'); }, params => { calls.push(params); });
		assert.ok(commit);
		await commit();
		assert.deepEqual(calls, ['begin', { ...effect.params, ...next }]);
	});

	test(`${type} sends same-geometry dynamics to the held worklet and leaves changed lookahead geometry to rebuild`, async () => {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
		Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, writable: true, value: MockAudioWorkletNode });
		const context = new MockAudioContext();
		const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as AudioContext, meterInterval: 1000 });
		const runtime = engine as unknown as Pick<EngineRuntimeHost, 'project' | 'graph'>;
		const effect = createEffect(type, { id: 'dynamics-1' });
		const project = createRackProject({ tracks: [{ id: 'track-1', effects: [effect] }] });
		try {
			engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(2, 4800, 48000) as unknown as AudioBuffer]]));
			await engine.play();
			const node = context.workletNodes.find(candidate => !candidate.readinessProbe);
			assert.ok(node);
			const previousGraph = runtime.graph;
			const next = { releaseMs: 101 };
			assert.equal(engine.configureRackEffect('track', 'track-1', 'dynamics-1', next, { revision: 4 }), 4);
			assert.equal(runtime.graph, previousGraph);
			assert.deepEqual(node.messages, [{ type: 'params', params: { ...effect.params, ...next }, revision: 4, sequence: 4 }]);
			const previousProject = runtime.project;
			assert.equal(engine.configureRackEffect('track', 'track-1', 'dynamics-1', { lookaheadMs: 40 }, { revision: 99 }), false);
			assert.equal(runtime.project, previousProject);
			assert.equal(runtime.graph?.effectMessageSequences.get(effectGraphKey('track', 'track-1', 'dynamics-1')), 4);
			assert.equal(node.messages.length, 1);
			assert.equal(engine.configureRackEffect('track', 'track-1', 'dynamics-1', next, { revision: 4 }), false);
			assert.equal(runtime.project, previousProject);
		} finally {
			await engine.dispose();
			if (descriptor) Object.defineProperty(globalThis, 'AudioWorkletNode', descriptor);
			else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
		}
	});
}
