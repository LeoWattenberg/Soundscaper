/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import type { MixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import SoundscaperRoutingGraphInspector from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphInspector.tsx';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { addSoundscaperRoutingItem } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-candidates.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const kind of ['cue', 'output', 'vca'] as const) {
	test(`routing ${kind} publication preserves focused field identity and authoritative Undo`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const project = createSoundscaperProject({ id: 'routing' });
		const candidate = addSoundscaperRoutingItem(project, project.mixer, kind);
		const collection = kind === 'cue' ? 'cues' : kind === 'output' ? 'outputs' : 'vcas';
		const render = async (graph: MixerGraphV21): Promise<void> => {
			await act(async () => { root.render(<SoundscaperRoutingGraphInspector
				project={project} graph={graph} selection={candidate.selection}
				copy={SOUNDSCAPER_ROUTING_GRAPH_COPY} disabled={false} confirmingDelete={false}
				onCandidate={() => undefined} onConfirmingDelete={() => undefined} onError={() => undefined} />); });
		};
		try {
			await render(candidate.graph);
			const name = dom.one('input');
			name.focus(); name.value = 'Dialogue cue';
			const renamed = { ...candidate.graph, [collection]: candidate.graph[collection].map(item => (
				item.id === candidate.selection.id ? { ...item, name: 'Dialogue cue' } : item
			)) };
			await render(renamed);
			assert.equal(dom.one('input'), name, 'saving retains the actual editing target');
			assert.equal(name.ownerDocument.activeElement, name);
			name.value = 'Unsubmitted';
			await render({ ...renamed });
			assert.equal(name.value, 'Unsubmitted', 'an unchanged saved value preserves its draft');
			if (kind === 'vca') {
				const mute = dom.container.querySelectorAll('input').find(input => input.name === 'mute');
				const member = dom.container.querySelectorAll('input').find(input => input.name === 'member');
				assert.ok(mute && member);
				await render({ ...renamed, vcas: renamed.vcas.map(vca => ({
					...vca, gain: 0.75, mute: true, members: [{ kind: 'master' as const }],
				})) });
				assert.equal(name.value, 'Unsubmitted', 'publishing other fields preserves the name draft');
				assert.equal(mute.checked, true);
				assert.equal(member.checked, true);
			}
			await render(candidate.graph);
			assert.equal(dom.one('input'), name);
			assert.equal(name.value, candidate.graph[collection].find(item => item.id === candidate.selection.id)?.name);
		} finally {
			await act(async () => { root.unmount(); });
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		}
	});
}
