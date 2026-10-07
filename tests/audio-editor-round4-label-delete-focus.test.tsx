/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { LabelTrackRow } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const scenario of ['survivor', 'empty', 'deliberate'] as const) test(`timeline label removal keeps its keyboard subject: ${scenario}`, async context => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const oldReact = globals.React; const oldAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const frames: FrameRequestCallback[] = [];
	context.mock.method(globalThis, 'requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => { await act(async () => root.unmount()); globals.React = oldReact; globals.IS_REACT_ACT_ENVIRONMENT = oldAct; dom.restore(); });
	let labels = (scenario === 'empty' ? ['second'] : ['first', 'second']).map((id, index) => ({ id, title: id, startFrame: index * 12_000, endFrame: index * 12_000 }));
	const removals: unknown[] = [];
	const controller = { getSnapshot: () => ({ project: { schemaFamily: 'soundscaper' } }), actions: {
		labels: { remove: (trackId: string, labelId: string) => {
			removals.push([trackId, labelId]); labels = labels.filter(label => label.id !== labelId); render();
		}, update: () => null, add: () => null }, edit: {},
		timeline: { selectTrack: () => null, setExactSelection: () => null }, track: { update: () => null },
	} };
	const render = () => root.render(<>
		<LabelTrackRow controller={controller} track={{ id: 'labels', name: 'Labels', labels }} visualHeight={100}
			trackIndex={0} panelWidth={250} timelineWidth={600} verticalRulerWidth={0} pixelsPerSecond={100}
			sampleRate={48_000} renderOriginX={0} renderViewportStartFrame={0} viewportDurationFrames={144_000}
			timeSelection={null} rangeSelected={false} selected={true} blocked={false} copy={ENGLISH_COPY}
			run={(operation: () => unknown) => operation()} onMenu={() => undefined} />
		<button type="button" data-other-control="">Other</button>
	</>);
	await act(async () => render());
	const removed = dom.one('[data-label-id="second"]');
	removed.focus();
	await act(async () => reactProps(removed).onKeyDown?.({ key: 'Delete', preventDefault() {} }));
	assert.deepEqual(removals, [['labels', 'second']]);
	assert.equal(dom.find('[data-label-id="second"]'), null);
	const other = dom.one('[data-other-control]');
	if (scenario === 'deliberate') other.focus();
	for (const callback of frames) callback(0);
	const expected = scenario === 'deliberate' ? other : scenario === 'empty'
		? dom.one('.audio-editor-label-track-actions').querySelector('button') : dom.one('[data-label-id="first"]');
	assert.equal(dom.container.ownerDocument.activeElement, expected);
});
