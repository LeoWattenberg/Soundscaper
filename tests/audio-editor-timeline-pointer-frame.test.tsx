/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useRef } from 'react';
import { useTimelinePointerFrame } from '../src/common/editor/ui/timeline/useTimelinePointerFrame.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

void test('pointer frames publish once, flush the final movement and discard cancelled ownership', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
	globalThis.cancelAnimationFrame = id => { frames.delete(id); };
	const values: number[] = [];
	let finish: ((cancel?: boolean) => void) | null = null;
	function Harness() {
		const session = useRef({ kind: 'move' });
		const touches = useRef(new Map<number, unknown>());
		const flush = useRef<((cancel?: boolean) => void) | null>(null);
		const move = useTimelinePointerFrame((event: React.PointerEvent) => values.push(event.clientX), session, touches, flush);
		finish = cancel => flush.current?.(cancel);
		return <div data-pointer-frame onPointerMove={move} />;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness />));
		const move = reactProps(dom.one('[data-pointer-frame]')).onPointerMove!;
		await act(async () => { for (const clientX of [1, 2, 3]) move({ pointerId: 1, clientX, preventDefault() {} }); });
		assert.equal(frames.size, 1);
		assert.deepEqual(values, []);
		await act(async () => { const entry = [...frames.entries()][0]!; frames.delete(entry[0]); entry[1](0); });
		assert.deepEqual(values, [3]);
		await act(async () => { move({ pointerId: 1, clientX: 4, preventDefault() {} }); (finish as ((cancel?: boolean) => void) | null)?.(); });
		assert.deepEqual(values, [3, 4]);
		assert.equal(frames.size, 0);
		await act(async () => { move({ pointerId: 1, clientX: 5, preventDefault() {} }); (finish as ((cancel?: boolean) => void) | null)?.(true); });
		assert.deepEqual(values, [3, 4]);
		assert.equal(frames.size, 0);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
