/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import RoutingGraphWires from '../src/common/editor/ui/workspace/RoutingGraphWires.tsx';
import { useRoutingHoverFrame } from '../src/common/editor/ui/workspace/useRoutingHoverFrame.ts';
import { installResponsivenessTestDom as installReactTestDom } from './helpers/responsiveness-round4-ui-dom.ts';

test('static routing wires do not rebuild during unrelated connection-preview renders', async () => {
	const dom = installReactTestDom(); let reads = 0;
	const edges = [{ key: 'wire', id: 'edge', kind: 'assignment' as const, sourceKey: 'a', destinationKey: 'b', enabled: true, parallelOffset: 0, get path() { reads++; return 'M 0 0 L 1 1'; } }];
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		for (let revision = 0; revision < 30; revision++) await act(async () => root.render(<svg data-revision={revision}><RoutingGraphWires edges={edges} /></svg>));
		assert.equal(reads, 1);
		assert.equal(dom.one('path').getAttribute('d'), 'M 0 0 L 1 1');
		await act(async () => root.render(<svg><RoutingGraphWires edges={[{ ...edges[0]!, path: 'M 2 2 L 3 3' }]} /></svg>));
		assert.equal(dom.one('path').getAttribute('d'), 'M 2 2 L 3 3');
	} finally { await act(async () => root.unmount()); dom.restore(); }
});
test('routing hover reads bounds once per frame and cancels stale pending geometry', async () => {
	const dom = installReactTestDom(); const frames = new Map<number, FrameRequestCallback>(); let sequence = 0, reads = 0;
	const globals = globalThis as typeof globalThis & { requestAnimationFrame: typeof requestAnimationFrame; cancelAnimationFrame: typeof cancelAnimationFrame };
	const oldRaf = globals.requestAnimationFrame, oldCancel = globals.cancelAnimationFrame;
	globals.requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence; };
	globals.cancelAnimationFrame = frame => { frames.delete(frame); };
	let hover: ReturnType<typeof useRoutingHoverFrame>;
	const points: Readonly<{ x: number; y: number }>[] = [];
	const publish = (point: Readonly<{ x: number; y: number }>) => { points.push(point); };
	function Harness({ enabled, zoom }: { enabled: boolean; zoom: number }) { hover = useRoutingHoverFrame(enabled, zoom, publish); return <div />; }
	const target = { scrollLeft: 10, scrollTop: 20, getBoundingClientRect() { reads++; return { left: 100, top: 200 }; } } as HTMLElement;
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness enabled zoom={2} />));
		for (let move = 0; move < 100; move++) hover!.schedule({ target, x: 200 + move, y: 300 + move });
		assert.equal(reads, 0); assert.equal(frames.size, 1);
		await act(async () => { const queued = [...frames.values()]; frames.clear(); for (const callback of queued) callback(0); });
		assert.equal(reads, 1); assert.deepEqual(points, [{ x: 104.5, y: 109.5 }]);
		hover!.schedule({ target, x: 500, y: 500 });
		await act(async () => root.render(<Harness enabled={false} zoom={2} />));
		assert.equal(frames.size, 0); assert.equal(points.length, 1);
		hover!.schedule({ target, x: 500, y: 500 }); assert.equal(frames.size, 0);
	} finally { await act(async () => root.unmount()); globals.requestAnimationFrame = oldRaf; globals.cancelAnimationFrame = oldCancel; dom.restore(); }
});
