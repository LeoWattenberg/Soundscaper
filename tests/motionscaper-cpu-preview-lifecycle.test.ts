/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderProductVideoCpuPreview } from '../src/common/editor/ui/workspace/product-video-cpu-preview.ts';
import { createExactPreviewRenderCoordinator } from '../src/common/editor/controller/clip-video/exact-preview-render-coordinator.ts';
import type { ProductVideoVisualPreviewFrame, ProductVideoVisualPreviewSession } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
const frame: ProductVideoVisualPreviewFrame = { layers: [], adjustments: [], activeFreezeNodeIds: [], availablePresetIds: [], ledger: { requestedNodeIds: [], consumedNodeIds: [], omittedNodeIds: [] } };
function setup(session: ProductVideoVisualPreviewSession | null) {
	const states: string[] = []; let redraws = 0;
	const canvas = { width: 32, height: 32, getContext() { throw new Error('An unavailable or stale picture must not reach display'); } } as unknown as HTMLCanvasElement;
	const options = { session, canvas, timelineSample: 0, mediaLayers: [], coordinator: createExactPreviewRenderCoordinator(() => { redraws++; }),
		isCurrent: () => true, updateFrame() {}, updateIssue() {}, updateOpenFx() {}, updateState: (state: string) => { states.push(state); }, onPublished() { throw new Error('Partial or stale publication'); } };
	return { options, states, canvas, redraws: () => redraws };
}
function session(render: NonNullable<ProductVideoVisualPreviewSession['renderExact']>): ProductVideoVisualPreviewSession {
	return { requiresAsyncFrames: true, resolve: () => frame, resolveTransitionWeight: () => null, renderExact: render, dispose() {} };
}
async function idle(): Promise<void> { await new Promise<void>(resolve => { setImmediate(resolve); }); }
test('project replacement clears a previous CPU picture while a new owned session is unavailable', () => {
	const value = setup(null); renderProductVideoCpuPreview(value.options); assert.equal(value.canvas.width, 0); assert.deepEqual(value.states, ['fallback']);
});
test('an unflattened image/composition result cannot claim complete CPU presentation', async () => {
	const value = setup(session(async () => ({ frame, layers: [], renderedEffectIds: [] })));
	renderProductVideoCpuPreview(value.options); await idle(); assert.deepEqual(value.states, ['fallback']);
});
test('CPU finishing waits for decoded media readiness and discards a picture whose owner changed in flight', async () => {
	let renders = 0; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let current = true;
	const value = setup(session(async () => { renders++; await gate; return { frame, layers: [], renderedEffectIds: [], cpuFrame: { width: 1, height: 1, pixels: new Uint8Array(4), encoding: 'srgb', alphaMode: 'straight' } }; }));
	renderProductVideoCpuPreview({ ...value.options, mediaLayers: [{ entries: [{ video: { readyState: 4, seeking: true } }] }] }); assert.equal(renders, 0);
	renderProductVideoCpuPreview({ ...value.options, isCurrent: () => current }); assert.equal(renders, 1);
	current = false; release(); await idle(); assert.deepEqual(value.states, []); assert.equal(value.redraws(), 1);
});
