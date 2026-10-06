/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useLayoutEffect, useRef, type RefObject } from 'react';
import { useRetainedCanvasFrame } from '../src/common/editor/ui/timeline/useRetainedCanvasFrame.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

void test('a child acquires its canvas root after host attachment and retains the latest scheduled draw', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	const previousRequest = window.requestAnimationFrame;
	const previousCancel = window.cancelAnimationFrame;
	window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
	window.cancelAnimationFrame = frame => { frames.delete(frame); };
	const draws: number[] = [];
	function Child({ rootRef, value }: { rootRef: RefObject<HTMLDivElement | null>; value: number }) {
		const draw = useRetainedCanvasFrame(rootRef);
		useLayoutEffect(() => { draw(() => draws.push(value)); }, [draw, value]);
		return null;
	}
	function Harness({ value }: { value: number }) {
		const rootRef = useRef<HTMLDivElement>(null);
		return <div ref={rootRef}><Child rootRef={rootRef} value={value} /></div>;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness value={0} />));
		assert.deepEqual(draws, [], 'child layout runs before its parent host ref attaches');
		await act(async () => root.render(<Harness value={1} />));
		assert.deepEqual(draws, [1], 'the first available root paints immediately');
		await act(async () => root.render(<Harness value={2} />));
		await act(async () => root.render(<Harness value={3} />));
		assert.equal(frames.size, 1);
		await act(async () => { const [frame, callback] = [...frames.entries()][0]!; frames.delete(frame); callback(0); });
		assert.deepEqual(draws, [1, 3]);
		await act(async () => root.render(<Harness value={4} />));
		assert.equal(frames.size, 1);
		await act(async () => root.unmount());
		assert.equal(frames.size, 0, 'unmount cancels the owned pending frame');
	} finally {
		await act(async () => root.unmount());
		window.requestAnimationFrame = previousRequest;
		window.cancelAnimationFrame = previousCancel;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
