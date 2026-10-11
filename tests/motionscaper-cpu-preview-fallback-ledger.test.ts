/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderProductVideoCpuPreview } from '../src/common/editor/ui/workspace/product-video-cpu-preview.ts';
import { resolveVideoPreviewRenderIssue } from '../src/common/editor/ui/workspace/video-preview-fallback.ts';
import { createExactPreviewRenderCoordinator } from '../src/common/editor/controller/clip-video/exact-preview-render-coordinator.ts';
import type { ProductVideoVisualPreviewFrame, ProductVideoVisualPreviewSession } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';

type Options = Parameters<typeof renderProductVideoCpuPreview>[0];
const empty: ProductVideoVisualPreviewFrame = {
	layers: [], adjustments: [], activeFreezeNodeIds: [], availablePresetIds: [],
	ledger: { requestedNodeIds: [], consumedNodeIds: [], omittedNodeIds: [] },
};
const pixelate = { id: 'media-pixelate', type: 'pixelate', enabled: true };
function media() {
	return [{ trackId: 'media', trackIndex: 0, blendMode: 'multiply', entries: [{
		clipId: 'clip-media', video: { readyState: 4, seeking: false }, effects: [pixelate],
		renderDescription: { canonical: true },
	}] }];
}
function session(frame = empty): ProductVideoVisualPreviewSession {
	return { resolve: () => frame, resolveTransitionWeight: () => null, dispose() {} };
}
function capture(owned: ProductVideoVisualPreviewSession | null, mediaLayers: Options['mediaLayers'] = media()) {
	const reports: unknown[] = []; const states: string[] = []; const errors: string[] = [];
	const canvas = { width: 32, height: 32, getContext() { throw new Error('Refused pictures must not be drawn'); } } as unknown as HTMLCanvasElement;
	const options: Options = {
		session: owned, canvas, timelineSample: 123, mediaLayers,
		coordinator: createExactPreviewRenderCoordinator(() => {}), isCurrent: () => true,
		updateFrame(_frame, error) { if (error) errors.push(error); },
		updateIssue(report) { reports.push(report); }, updateOpenFx() {},
		updateState(state) { states.push(state); }, onPublished() { throw new Error('Refused pictures must not publish'); },
	};
	return { options, reports, states, errors, canvas };
}
function assertMediaOmission(reports: readonly unknown[]): void {
	assert.equal(reports.length, 1);
	assert.deepEqual(resolveVideoPreviewRenderIssue(reports[0]), {
		requestedEffectCount: 1, omittedEffectIds: [], requestedCompositionCount: 1,
		omittedCompositionClipIds: ['clip-media'],
	});
	assert.partialDeepStrictEqual(reports[0], {
		status: 'fallback', effects: { requested: ['media-pixelate'], fallbackRendered: ['media-pixelate'] },
		composition: { requested: [{ clipId: 'clip-media', blendMode: 'multiply' }], omitted: ['clip-media'] },
	});
}
async function idle(): Promise<void> { await new Promise<void>(resolve => { setImmediate(resolve); }); }

test('baseline CPU refusal retains ordinary media composition and supported effect fallback intent', () => {
	const value = capture(session()); renderProductVideoCpuPreview(value.options);
	assertMediaOmission(value.reports); assert.deepEqual(value.states, ['fallback']);
});

test('missing or failing visual sessions still report current ordinary media intent', () => {
	for (const owned of [null, { ...session(), resolve() { throw new Error('Visual resolver unavailable'); } }]) {
		const value = capture(owned); renderProductVideoCpuPreview(value.options);
		assertMediaOmission(value.reports); assert.deepEqual(value.states, ['fallback']);
		if (owned === null) assert.equal(value.canvas.width, 0);
		else assert.deepEqual(value.errors, ['Visual resolver unavailable']);
	}
});

test('a missing canvas reports current media instead of claiming CPU presentation', () => {
	const value = capture(session()); renderProductVideoCpuPreview({ ...value.options, canvas: null });
	assertMediaOmission(value.reports); assert.deepEqual(value.states, ['fallback']);
});

test('mixed media, visual and active adjustment omissions retain unique authored identities and bypass state', () => {
	const layers = media(); layers[0]!.entries[0]!.effects = [];
	const frame: ProductVideoVisualPreviewFrame = { ...empty, layers: [
		{ trackId: 'media', trackIndex: 0, entries: [{ clipId: 'clip-media', effects: [pixelate], renderDescription: { stale: true } }] },
		{ trackId: 'visual', trackIndex: 1, blendMode: 'screen', entries: [{ clipId: 'clip-visual', renderDescription: { canonical: true }, effects: [
			{ id: 'visual-effect', type: 'not-supported' }, { id: 'disabled-effect', type: 'pixelate', enabled: false },
			{ id: 'adjustment-effect', type: 'pixelate' },
		] }] },
	], adjustments: [
		{ nodeId: 'active', targetTrackIds: ['media', 'visual'], effects: [{ id: 'adjustment-effect', type: 'pixelate' }], opacity: 0.5, blendMode: 'multiply', maskIds: ['mask'] },
		{ nodeId: 'inactive', targetTrackIds: ['absent'], effects: [{ id: 'inactive-effect', type: 'pixelate' }], opacity: 1, blendMode: 'normal', maskIds: [] },
	], ledger: { requestedNodeIds: ['active'], consumedNodeIds: [], omittedNodeIds: ['active'] } };
	const value = capture(session(frame), layers); renderProductVideoCpuPreview(value.options);
	assert.equal(value.reports.length, 1);
	assert.deepEqual(resolveVideoPreviewRenderIssue(value.reports[0]), {
		requestedEffectCount: 2, omittedEffectIds: ['visual-effect'], requestedCompositionCount: 2,
		omittedCompositionClipIds: ['clip-media', 'clip-visual'],
	});
	assert.partialDeepStrictEqual(value.reports[0], {
		effects: { requested: ['visual-effect', 'adjustment-effect'] },
		composition: { requested: [{ clipId: 'clip-media', blendMode: 'multiply' }, { clipId: 'clip-visual', blendMode: 'screen' }] },
	});
	assert.deepEqual(layers[0]!.entries[0]!.effects, []);
});

test('adjustment-only effects targeting ordinary media survive an unsupported CPU path', () => {
	const value = capture(session({ ...empty, adjustments: [{ nodeId: 'adjustment', targetTrackIds: ['media'],
		effects: [{ id: 'adjustment-effect', type: 'not-supported' }], opacity: 1, blendMode: 'normal', maskIds: [],
	}] }));
	renderProductVideoCpuPreview(value.options);
	assert.deepEqual(resolveVideoPreviewRenderIssue(value.reports[0]), {
		requestedEffectCount: 2, omittedEffectIds: ['adjustment-effect'], requestedCompositionCount: 1,
		omittedCompositionClipIds: ['clip-media'],
	});
});

test('asynchronous refusal snapshots the requested frame before mutable media pool reuse', async () => {
	for (const rejects of [false, true]) {
		let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
		const layers = media();
		const value = capture({ ...session(), requiresAsyncFrames: true, async renderExact() {
			await gate; if (rejects) throw new Error('Exact renderer unavailable');
			return { frame: empty, layers: [], renderedEffectIds: [] };
		} }, layers);
		renderProductVideoCpuPreview(value.options);
		layers[0]!.entries[0]!.clipId = 'next-frame'; layers[0]!.entries[0]!.effects = [];
		release(); await idle(); assertMediaOmission(value.reports); assert.deepEqual(value.states, ['fallback']);
		assert.deepEqual(value.errors, rejects ? ['Exact renderer unavailable'] : []);
	}
});

test('superseded CPU rejection cannot overwrite the current fallback ledger', async () => {
	let reject!: (error: Error) => void; const gate = new Promise<never>((_resolve, fail) => { reject = fail; });
	const value = capture({ ...session(), requiresAsyncFrames: true, renderExact: () => gate });
	let current = true;
	renderProductVideoCpuPreview({ ...value.options, isCurrent: () => current }); current = false;
	reject(new Error('Old request failed')); await idle();
	assert.deepEqual(value.reports, []); assert.deepEqual(value.states, []); assert.deepEqual(value.errors, []);
});
