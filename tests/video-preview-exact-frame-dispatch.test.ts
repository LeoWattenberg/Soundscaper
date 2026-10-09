/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchExactProductVideoPreview } from '../src/common/editor/ui/workspace/video-preview-exact-frame-dispatch.ts';
import { createExactPreviewRenderCoordinator } from '../src/common/editor/controller/clip-video/exact-preview-render-coordinator.ts';
import type { ProductVideoVisualPreviewSession } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('the current UI exact request carries the native private signal and joins held cancellation without publishing', async () => {
	const held = deferred<void>(), entered = deferred<void>(); let signal: AbortSignal | undefined, published = 0;
	const session = { async renderExact(request: { signal: AbortSignal; timelineSample: number }) {
		assert.equal(this, session); assert.equal(request.timelineSample, 13); signal = request.signal;
		entered.resolve(); await held.promise; signal.throwIfAborted(); throw new Error('Canceled work must not finish.');
	} } as unknown as ProductVideoVisualPreviewSession;
	const coordinator = createExactPreviewRenderCoordinator(() => undefined, { mode: 'continuous' });
	const work = dispatchExactProductVideoPreview({ coordinator, session, timelineSample: 13, mediaLayers: [], isCurrent: () => true,
		publish: () => { published++; }, onError: () => assert.fail('No stale error') });
	await entered.promise; const joining = coordinator.supersede();
	try {
		assert.equal(signal?.aborted, true); assert.equal(await remainsPending(joining), true); held.resolve(); await work; await joining;
		assert.equal(published, 0);
	} finally { held.resolve(); await work; await coordinator.retire(); }
});

test('the actual render method receiver is pinned without reading its mutable bind metadata', async () => {
	let reads = 0, published = 0;
	const result = Object.freeze({ frame: null, layers: [], renderedEffectIds: [] });
	const session = { renderExact() { assert.equal(this, session); return Promise.resolve(result); } };
	Object.defineProperty(session.renderExact, 'bind', { get() { reads++; throw Error('bind'); } });
	const coordinator = createExactPreviewRenderCoordinator(() => undefined);
	await dispatchExactProductVideoPreview({ coordinator, session: session as unknown as ProductVideoVisualPreviewSession,
		timelineSample: 0, mediaLayers: [], isCurrent: () => true, publish: value => { assert.equal(value, result); published++; }, onError: () => assert.fail('No error') });
	assert.equal(reads, 0); assert.equal(published, 1); await coordinator.retire();
});
