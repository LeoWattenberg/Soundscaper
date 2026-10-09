/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import SoundscaperRoutingGraphView, { type SoundscaperRoutingGraphCommit } from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphView.tsx';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const [down, up] of [[0, 0], [2, 2], [1, 1], [0, 2], [0, 1]]) {
	test(`routing connection pointer ${down}/${up} requires primary admission`, async () => {
		const dom = installReactTestDom();
		const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
		environment.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const project = { schemaVersion: 21, masterChannels: 2, master: { effects: [] },
			tracks: [{ id: 'voice', type: 'audio', name: 'Voice', channelCount: 2, effects: [] }],
			trackFolders: [], sequences: [] };
		const graph = createDefaultMixerGraphV21(project.tracks);
		const commits: SoundscaperRoutingGraphCommit[] = [];
		try {
			await act(async () => root.render(<SoundscaperRoutingGraphView project={project} graph={graph}
				disabled={false} copy={SOUNDSCAPER_ROUTING_GRAPH_COPY} dismissLabel="Close"
				onCommit={commit => { commits.push(commit); }} />));
			const source = dom.one('[data-routing-source="track:voice"]');
			const destination = dom.one('[data-routing-destination="master"]');
			await act(async () => reactProps(source).onPointerDown({ button: down, preventDefault() {} }));
			await act(async () => reactProps(destination).onPointerUp({ button: up, preventDefault() {} }));
			assert.equal(commits.length, down === 0 && up === 0 ? 1 : 0);
			if (commits.length) {
				assert.equal(commits[0]?.kind, 'edge-create');
				assert.partialDeepStrictEqual(commits[0]?.graph.edges.at(-1), {
					source: { kind: 'track', id: 'voice' }, destination: { kind: 'master' },
				});
			}
		} finally {
			await act(async () => root.unmount());
			environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
