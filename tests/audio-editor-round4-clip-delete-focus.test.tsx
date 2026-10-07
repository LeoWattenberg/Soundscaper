/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef } from 'react';
import { useTrackRowFocusNavigation } from '../src/common/editor/ui/timeline/useTrackRowFocusNavigation.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function Track({ ids }: { readonly ids: readonly string[] }) {
	const root = useRef<HTMLDivElement>(null);
	const navigation = useTrackRowFocusNavigation({
		trackWindowRef: root, renderedClips: ids, trackIndex: 0, trackCount: 1,
		isFlatNavigation: false, trackBaseTabIndex: 0, hasTrackRuler: false,
		onFocusTimelineRuler: () => false, onFocusTrackContainer: () => false,
		onFocusTrackPanelControl: () => false, onFocusTrackClip: () => false,
		onFocusTrackRuler: () => false, onFocusSelectionToolbar: () => false,
		onSelectClip: () => {}, onExtendTrackSelection: () => {}, routeClipKey: null,
	});
	return <div ref={root} data-window="" onFocusCapture={navigation.handleClipFocusCapture}>
		<div className="track" tabIndex={0}>
			{ids.map(id => <div key={id} data-clip-id={id} role="group" tabIndex={0} />)}
		</div>
	</div>;
}

for (const scenario of ['survivor', 'empty', 'new-focus'] as const) {
	test(`clip deletion preserves keyboard continuation: ${scenario}`, async context => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const priorObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
		Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class {
			observe() {} disconnect() {}
		} });
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		context.after(async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorObserver) Object.defineProperty(globalThis, 'MutationObserver', priorObserver);
			else Reflect.deleteProperty(globalThis, 'MutationObserver');
			dom.restore();
		});
		await act(async () => root.render(<Track ids={['first', 'second']} />));
		const removed = dom.one('[data-clip-id="second"]');
		Object.defineProperty(removed, 'matches', { value: (selector: string) => selector === '[data-clip-id][role="group"]' });
		removed.focus();
		reactProps(dom.one('[data-window]')).onFocusCapture?.({ target: removed });
		const field = dom.container.ownerDocument.createElement('input');
		dom.container.appendChild(field);
		if (scenario === 'new-focus') field.focus();
		await act(async () => root.render(<Track ids={scenario === 'empty' ? [] : ['first']} />));
		const expected = scenario === 'new-focus' ? field : scenario === 'empty' ? dom.one('.track') : dom.one('[data-clip-id="first"]');
		assert.equal(dom.container.ownerDocument.activeElement, expected);
	});
}
