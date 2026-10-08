/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import SoundscaperRoutingGraphView from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphView.tsx';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

async function withGraph(run: (dom: ReturnType<typeof installReactTestDom>) => Promise<void>) {
	const project = createSoundscaperProject({ tracks: [createAudioTrack({ id: 'voice', name: 'Voice' })] });
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SoundscaperRoutingGraphView project={project}
			graph={project.mixer} disabled={false} copy={SOUNDSCAPER_ROUTING_GRAPH_COPY}
			dismissLabel="Close" onCommit={() => undefined} />));
		await run(dom);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
	test(`routing graph releases ${modifier} navigation, deletion and port commands`, async () => {
		await withGraph(async dom => {
			let prevented = false;
			for (const [selector, keys] of [
				['[data-routing-node="track:voice"]', ['ArrowRight', 'Delete']],
				['[data-routing-edge]', ['Delete']],
				['[data-routing-source="track:voice"]', ['Enter', ' ']],
			] as const) {
				const mounted = dom.one(selector);
				const target = mounted.hasAttribute('data-routing-node') ? mounted.querySelector('button')! : mounted;
				for (const key of keys) await act(async () => reactProps(target).onKeyDown?.({ key,
					currentTarget: target, [modifier]: true, preventDefault() { prevented = true; } }));
			}
			assert.equal(prevented, false);
			assert.equal(dom.find('[data-routing-inspector]'), null);
			assert.match(dom.one('[role="status"]').textContent, /Routing graph ready/u);
		});
	});
}

test('routing graph keeps plain navigation, port connection and Escape cancellation', async () => {
	await withGraph(async dom => {
		const node = dom.one('[data-routing-node="track:voice"]').querySelector('button')!;
		await act(async () => reactProps(node).onKeyDown?.({ key: 'ArrowRight', preventDefault() {} }));
		assert.equal(dom.one('[data-routing-node="master"]').querySelector('button')!.getAttribute('tabindex'), '0');
		const source = dom.one('[data-routing-source="track:voice"]');
		await act(async () => reactProps(source).onKeyDown?.({ key: 'Enter', preventDefault() {} }));
		assert.match(dom.one('[role="status"]').textContent, /Choose a destination/u);
		for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
			let prevented = false;
			await act(async () => reactProps(dom.one('[data-soundscaper-routing-graph]')).onKeyDown?.({
				key: 'Escape', [modifier]: true, preventDefault() { prevented = true; },
			}));
			assert.equal(prevented, false);
			assert.match(dom.one('[role="status"]').textContent, /Choose a destination/u);
		}
		await act(async () => reactProps(dom.one('[data-soundscaper-routing-graph]')).onKeyDown?.({ key: 'Escape', preventDefault() {} }));
		assert.match(dom.one('[role="status"]').textContent, /Connection cancelled/u);
	});
});
