/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createEffect } from '../src/common/editor/effects.js';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import { MockAudioWorkletNode, createRackProject } from './helpers/audio-editor-runtime-harness.js';

for (const [type, change, topology] of [
	['audacity-bass-treble', { volumeDb: -1 }, null],
	['audacity-phaser', { outputGainDb: -5 }, { stages: 4 }],
	['audacity-wahwah', { outputGainDb: -5 }, null],
	['audacity-distortion', { parameter1: 51 }, { dcBlock: true }],
	['audacity-classic-filters', { cutoffHz: 1100 }, { order: 4 }],
] as const) {
	test(`${type} commits compatible fields into its existing worklet and rebuilds topology edits`, async () => {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
		Object.defineProperty(globalThis, 'AudioWorkletNode', { configurable: true, writable: true, value: MockAudioWorkletNode });
		const context = new MockAudioContext();
		const engine = createAudioEditorEngine({ audioContextFactory: () => context as unknown as AudioContext, meterInterval: 1000 });
		const runtime = engine as unknown as Pick<EngineRuntimeHost, 'project' | 'graph'>;
		const effect = createEffect(type, { id: 'continuous-1' });
		const project = createRackProject({ tracks: [{ id: 'track-1', effects: [effect] }] });
		try {
			engine.loadProject(project, new Map([['source-1', new MockAudioBuffer(2, 4800, 48000) as unknown as AudioBuffer]]));
			await engine.play();
			const node = context.workletNodes.find(candidate => !candidate.readinessProbe);
			assert.ok(node);
			const graph = runtime.graph;
			assert.equal(engine.configureRackEffect('track', 'track-1', 'continuous-1', change, { revision: 4 }), 4);
			assert.equal(runtime.graph, graph);
			assert.deepEqual(node.messages, [{ type: 'params', params: { ...effect.params, ...change }, revision: 4, sequence: 4 }]);
			if (topology) {
				const previous = runtime.project;
				assert.equal(engine.configureRackEffect('track', 'track-1', 'continuous-1', topology, { revision: 5 }), false);
				assert.equal(runtime.project, previous);
				assert.equal(node.messages.length, 1);
			}
		} finally {
			await engine.dispose();
			if (descriptor) Object.defineProperty(globalThis, 'AudioWorkletNode', descriptor);
			else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
		}
	});
}
