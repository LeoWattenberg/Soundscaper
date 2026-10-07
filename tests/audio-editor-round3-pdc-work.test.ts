/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { compileProjectPathPdcPlanV21 } from '../src/common/editor/engine/project-path-pdc-plan-v21.ts';
import { createDefaultMixerGraphV21, type MixerEdgeV21, type MixerStripV21 } from '../src/common/editor/mixer-graph-v21.ts';

function project(count: number) {
	const tracks = Array.from({ length: count }, (_, index) => ({
		id: `track-${String(index)}`, type: 'audio', effects: [],
	}));
	const groups: MixerStripV21[] = tracks.map(({ id }) => ({
		id: `group-${id}`, name: id, color: '', gain: 1, pan: 0, mute: false,
		solo: false, collapsed: false, effectsActive: true, effects: [], channelCount: 2,
	}));
	const mixer = createDefaultMixerGraphV21(tracks);
	const edges: MixerEdgeV21[] = tracks.flatMap(({ id }) => [
		{ id: `${id}-group`, kind: 'assignment', source: { kind: 'track', id },
			destination: { kind: 'mixer-node', id: `group-${id}` }, position: 'post-fader',
			level: 1, enabled: true, channelMap: [] },
		{ id: `${id}-master`, kind: 'assignment', source: { kind: 'mixer-node', id: `group-${id}` },
			destination: { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: [] },
	]);
	edges.push(mixer.edges.at(-1)!);
	return { sampleRate: 48_000, masterChannels: 2, tracks, mixer: { ...mixer, groups, edges } };
}

function replaceArrayMethod(context: TestContext, name: 'sort' | 'filter', value: unknown): void {
	const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, name)!;
	Object.defineProperty(Array.prototype, name, { ...descriptor, value });
	context.after(() => { Object.defineProperty(Array.prototype, name, descriptor); });
}

test('production path PDC orders a wide frontier without sorting it after every insertion', (context) => {
	const value = project(300);
	replaceArrayMethod(context, 'sort', () => { throw new Error('Repeatedly sorted PDC frontier'); });
	const plan = compileProjectPathPdcPlanV21(value);
	assert.equal(plan.nodeInputLatencyFrames.size, 601);
	assert.equal(plan.edgeCompensationFrames.size, 601);
	assert.equal(plan.latencyFrames, 0);
});

test('production path PDC groups output routes without whole-edge filter projections', (context) => {
	const value = project(40);
	const original = Array.prototype.filter;
	replaceArrayMethod(context, 'filter', function (
		this: unknown[], predicate: (item: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown,
	): unknown[] {
		if (this.some(item => typeof item === 'object' && item !== null && Object.hasOwn(item, 'destination'))) {
			throw new Error('Scanned and copied every edge for one output');
		}
		return Reflect.apply(original, this, [predicate, thisArg]) as unknown[];
	});
	const plan = compileProjectPathPdcPlanV21(value);
	assert.deepEqual([...plan.outputLatencyFrames], [['main', 0]]);
	assert.equal(plan.edgeCompensationFrames.get('assignment:master:output:main'), 0);
});
