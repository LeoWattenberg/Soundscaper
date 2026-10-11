/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import SourceMonitorPanel from '../src/common/editor/ui/workspace/SourceMonitorPanel.jsx';
import { bindProductVideoVisualPreviewRuntime, createProductVideoVisualPreviewRuntime } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

Reflect.set(globalThis, 'React', React);
type Frame = Readonly<{ width: number; height: number; pixels: Uint8Array<ArrayBuffer> }>;
const frame: Frame = { width: 1, height: 1, pixels: Uint8Array.of(255, 0, 0, 128) };

for (const change of ['source', 'reopen', 'project'] as const) for (const cleanup of [false, true]) {
	test(`M10 generated ${change} publication is isolated ${cleanup ? 'after' : 'before'} React cleanup`, async () => {
		const dom = installReactTestDom();
		const previousAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT') as unknown;
		const previousImageData = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
		Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
		Reflect.set(globalThis, 'ImageData', class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} });
		const { createRoot } = await import('react-dom/client');
		const root = createRoot(dom.container as unknown as Element);
		let project = { revision: 0 }, sourceId = 'first', openRevision = 1, positionFrame = 17;
		let snapshot = { project, readOnly: false };
		const published: number[] = [], pending: { signal?: AbortSignal; resolve(value: Frame): void }[] = [];
		const sourceMonitor = {
			view: () => ({ sourceId, openRevision, positionFrame, sourceFrameCount: 120, frameRate: { num: 30, den: 1 }, mediaSeconds: positionFrame / 30 }),
			seek(value: number) { published.push(value); positionFrame = value; },
		};
		const controller = { getSnapshot: () => snapshot, actions: { video: { sourceMonitor, getSourceVisualData: () => ({ available: true }) } } };
		bindProductVideoVisualPreviewRuntime(controller, createProductVideoVisualPreviewRuntime(async () => null, undefined, undefined, {
			ownsSource: () => true,
			createFrame: ({ signal }) => new Promise<Frame>(resolve => pending.push({ signal, resolve })),
		}));
		const render = () => root.render(<SourceMonitorPanel controller={controller} snapshot={snapshot} copy={{}} run={(operation: () => unknown) => operation()} blocked={false} />);
		try {
			await act(async () => { render(); });
			Reflect.set(dom.one('canvas'), 'getContext', () => ({ putImageData() {} }));
			assert.equal(pending.length, 1);
			// The controller changes synchronously; React has not committed the replacement yet.
			if (change === 'source') sourceId = 'second';
			if (change === 'reopen') openRevision++;
			if (change === 'project') { project = { revision: 1 }; snapshot = { project, readOnly: false }; }
			positionFrame = 0;
			if (cleanup) {
				await act(async () => { render(); });
				assert.equal(pending[0]!.signal?.aborted, true, 'replacement still cancels the retired raster request');
				assert.equal(pending.length, 1, 'replacement awaits the cancelled render before acquiring its own frame');
			}
			await act(async () => { pending.shift()!.resolve(frame); });
			assert.deepEqual(published, [], 'the retired source must not seek the newly opened source');
			assert.equal(positionFrame, 0);
			if (!cleanup) await act(async () => { render(); });
			assert.equal(pending.length, 1, 'the current source still renders its exact initial ordinal');
			await act(async () => { pending.shift()!.resolve(frame); });
			assert.deepEqual(published, [0], 'current source callbacks remain authoritative');
		} finally {
			await act(async () => { root.unmount(); for (const item of pending.splice(0)) item.resolve(frame); });
			dom.restore(); Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
			if (previousImageData) Object.defineProperty(globalThis, 'ImageData', previousImageData); else Reflect.deleteProperty(globalThis, 'ImageData');
		}
	});
}
