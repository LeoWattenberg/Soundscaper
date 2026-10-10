/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import SoundscaperRoutingGraphView from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphView.tsx';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { layoutSoundscaperRoutingGraph } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-layout.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const assignment = (id: string, source: MixerGraphV21['edges'][number]['source'], destination: MixerGraphV21['edges'][number]['destination']) => ({
	id, kind: 'assignment' as const, source, destination, position: 'post-fader' as const,
	level: 1, enabled: true, channelMap: [0, 1],
});
const graph: MixerGraphV21 = {
	schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
	outputs: [{ id: 'main', name: 'Main output', role: 'main', channelCount: 2 }],
	edges: [assignment('track-master', { kind: 'track', id: 'voice' }, { kind: 'master' }),
		assignment('master-main', { kind: 'master' }, { kind: 'output', id: 'main' })],
};
const project = { schemaVersion: 21, masterChannels: 2, master: { effects: [] },
	tracks: [{ id: 'voice', type: 'audio', name: 'Voice', effects: [] }],
	trackFolders: [], sequences: [], mixer: graph };

test('rendered routing connection handles leave normal intermediate bus cards reachable', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (value: MixerGraphV21) => {
		await act(async () => root.render(<SoundscaperRoutingGraphView project={{ ...project, mixer: value }}
			graph={value} disabled={false} copy={SOUNDSCAPER_ROUTING_GRAPH_COPY} dismissLabel="Close" onCommit={() => undefined} />));
	};
	try {
		await render(graph);
		assertHandlesClear(graph);
		const withBus: MixerGraphV21 = { ...graph,
			groups: [{ id: 'group', name: 'Group bus 1', color: '', gain: 1, pan: 0, mute: false,
				solo: false, collapsed: false, effectsActive: true, effects: [], channelCount: 2 }],
			edges: [...graph.edges, assignment('group-master', { kind: 'mixer-node', id: 'group' }, { kind: 'master' })],
		};
		await render(withBus);
		assertHandlesClear(withBus);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}

	function assertHandlesClear(value: MixerGraphV21) {
		const layout = layoutSoundscaperRoutingGraph(project, value);
		for (const edge of value.edges) {
			const handle = dom.one(`[data-routing-edge="${edge.id}"]`);
			const style = reactProps(handle).style as { readonly left: string; readonly top: string };
			const left = Number.parseFloat(style.left);
			const top = Number.parseFloat(style.top);
			for (const node of layout.nodes) assert.equal(
				left < node.x + node.width && left + 24 > node.x
					&& top < node.y + node.height && top + 24 > node.y,
				false, `${edge.id} must leave ${node.label}'s pointer target clear`,
			);
		}
	}
});


test('routing handle placement remains with its optional graph consumer', () => {
	const modulePath = 'src/common/editor/ui/workspace/routing-edge-handle-position.ts';
	for (const path of [modulePath, modulePath.replaceAll('/', '\\'), '/checkout/' + modulePath]) {
		assert.equal(chunkGroupForModulePath(path), 'editor-optional-surfaces');
	}
	assert.equal(chunkGroupForModulePath(modulePath.replace('.ts', '-extra.ts')), 'editor-shell');
});
