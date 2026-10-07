/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ClipLoopOverlays } from '../src/common/editor/ui/timeline/ClipLoopOverlays.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('loop length owns plain arrows while modified and unrelated keys reach the editor', async context => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	});
	const changes: unknown[] = [];
	const rootRef = { current: dom.container as unknown as HTMLDivElement };
	await act(async () => root.render(<><div data-clip-id="recording" />
		<ClipLoopOverlays rootRef={rootRef} clips={[{ id: 'recording', kind: 'audio', anchor: 'samples',
			timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000 }]}
			selectedIds={new Set(['recording'])} startFrame={0} endFrame={96_000}
			pixelsPerSecond={120} sampleRate={48_000} blocked={false} copy={{}}
			onChange={(_id, change) => changes.push(change)} /></>));
	const control = dom.one('.clip-display__handle--loop-right');
	for (const [key, modifier] of [['b', 'ctrlKey'], ['ArrowRight', 'metaKey'], ['ArrowLeft', 'altKey'], ['Tab', '']] as const) {
		let stopped = 0;
		let prevented = 0;
		await act(async () => reactProps(control).onKeyDown({ key, ctrlKey: false, metaKey: false, altKey: false,
			shiftKey: false, ...(modifier ? { [modifier]: true } : {}),
			stopPropagation() { stopped += 1; }, preventDefault() { prevented += 1; } }));
		assert.equal(stopped, 0, `${modifier} ${key} belongs to the editor or focus navigation`);
		assert.equal(prevented, 0);
		assert.deepEqual(changes, []);
	}
	for (const shiftKey of [false, true]) {
		let stopped = 0;
		let prevented = 0;
		await act(async () => reactProps(control).onKeyDown({ key: 'ArrowRight', ctrlKey: false, metaKey: false,
			altKey: false, shiftKey, stopPropagation() { stopped += 1; }, preventDefault() { prevented += 1; } }));
		assert.equal(stopped, 1);
		assert.equal(prevented, 1);
	}
	assert.deepEqual(changes, [{ loop: { periodFrames: 48_000, durationFrames: 96_000 } },
		{ loop: { periodFrames: 48_000, durationFrames: 48_480 } }]);
});
