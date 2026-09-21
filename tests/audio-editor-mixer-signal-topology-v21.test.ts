/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMixerSignalTopologyV21 } from '../src/common/editor/mixer-signal-topology-v21.ts';
import type { MixerEdgeV21 } from '../src/common/editor/mixer-graph-v21.ts';

const source = (id: string) => ({ kind: 'track' as const, id });
const node = (id: string) => ({ kind: 'mixer-node' as const, id });

function edge(
	id: string,
	from: MixerEdgeV21['source'],
	destination: MixerEdgeV21['destination'],
	overrides: Partial<MixerEdgeV21> = {},
): MixerEdgeV21 {
	return {
		id,
		kind: destination.kind === 'effect-sidechain' ? 'sidechain' : 'assignment',
		source: from,
		destination,
		position: 'post-fader',
		level: 1,
		enabled: true,
		channelMap: [0, 1],
		...overrides,
	};
}

test('signal topology excludes disabled, sidechain, and all-silent edges and terminates on cycles', () => {
	const graph = {
		edges: [
			edge('a-b', source('a'), node('b')),
			edge('b-a', node('b'), node('a')),
			edge('silent-solo', source('silent'), node('solo'), { channelMap: [-1, -1] }),
			edge('disabled-solo', source('disabled'), node('solo'), { enabled: false }),
			edge('sidechain-solo', source('control'), {
				kind: 'effect-sidechain', strip: node('solo'), effectId: 'gate',
			}),
		],
	};
	const topology = createMixerSignalTopologyV21(graph, { includeOutputs: false });
	assert.equal(topology.reaches('track:a', 'mixer-node:a'), true);
	assert.equal(topology.reaches('mixer-node:a', 'track:a'), false);
	assert.equal(topology.reaches('track:silent', 'mixer-node:solo'), false);
	assert.equal(topology.reaches('track:disabled', 'mixer-node:solo'), false);
	assert.equal(topology.reaches('track:control', 'mixer-node:solo'), false);
	assert.equal(topology.reaches('track:missing', 'mixer-node:solo'), false);
});

test('output edges exist only in programme topology and never in solo topology', () => {
	const graph = {
		edges: [edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' })],
	};
	assert.equal(createMixerSignalTopologyV21(graph, { includeOutputs: true })
		.reaches('master', 'output:main'), true);
	assert.equal(createMixerSignalTopologyV21(graph, { includeOutputs: false })
		.reaches('master', 'output:main'), false);
});
