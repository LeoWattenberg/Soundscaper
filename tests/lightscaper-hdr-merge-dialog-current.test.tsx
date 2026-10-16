/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ImageHdrMergeDialogCurrentV1 from '../src/common/editor/ui/dialogs/ImageHdrMergeDialogCurrentV1.tsx';
import { imageHdrMergeCopy } from '../src/common/i18n/image-hdr-merge-copy.ts';
import type { ImageHdrMergeAuthoringOptionsCurrentV1, ImageHdrMergeAuthoringPortCurrentV1 } from '../src/common/editor/image-hdr-merge-authoring-port-current-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

function canvasBoundary() {
	const keys = ['HTMLCanvasElement', 'CanvasRenderingContext2D', 'ImageData'] as const;
	const saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key)), widths = new WeakMap<object, number>(), heights = new WeakMap<object, number>();
	const painted: number[][] = [];
	class Context { getContextAttributes() { return { alpha: true, colorSpace: 'srgb' }; } putImageData(image: { data: Uint8ClampedArray }) { painted.push([...image.data]); } }
	class Canvas {
		get width() { return widths.get(this) ?? 0; } set width(value: number) { widths.set(this, value); }
		get height() { return heights.get(this) ?? 0; } set height(value: number) { heights.set(this, value); }
		getContext() { return new Context(); }
	}
	class Image { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	for (const [index, value] of [Canvas, Context, Image].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return { painted, size: (target: object) => [widths.get(target) ?? 0, heights.get(target) ?? 0],
		restore() { keys.forEach((key, index) => { const prior = saved[index]; if (prior) Object.defineProperty(globalThis, key, prior); else Reflect.deleteProperty(globalThis, key); }); } };
}

async function fixture(locale: 'en' | 'de' = 'en', publicationNotices: readonly string[] = []) {
	const canvas = canvasBoundary(), receipt = Object.freeze({ id: 'native-result' }), copy = imageHdrMergeCopy(locale);
	const entered = deferred<void>(), release = deferred<void>(), retirements = new Set<() => Promise<void>>(), acknowledgements: unknown[] = [];
	let closes = 0, current = true, previews = 0, merges = 0, held = false, failAfterPaint = false, failAfterMerge = false;
	const signals: AbortSignal[] = [], planes: Uint8Array[] = [];
	const previewRequests: Readonly<ImageHdrMergeAuthoringOptionsCurrentV1>[] = [], mergeRequests: Readonly<ImageHdrMergeAuthoringOptionsCurrentV1>[] = [];
	// Only the scoped product capability is modeled. Actual radiance, storage,
	// Original custody and managed publication have separate native-owner tests.
	const port: ImageHdrMergeAuthoringPortCurrentV1<typeof receipt> = {
		schemaVersion: 1,
		async readSelection() { return { schemaVersion: 1, sources: [
			{ key: 'one@1', label: 'First.dng', width: 2, height: 1, exposureSeconds: null, aperture: null, iso: null },
			{ key: 'two@3', label: 'Second.dng', width: 2, height: 1, exposureSeconds: null, aperture: null, iso: null },
		], suggestedExposureMultipliers: null }; },
		async withPreview(options, consume, runtime) {
			previewRequests.push(options);
			previews++; assert.equal(this, port); assert.ok(runtime?.signal); signals.push(runtime.signal);
			const pixels = new Uint8Array([255, 128, 0, 255, 16, 32, 64, 255]); planes.push(pixels);
			const priorPaints = canvas.painted.length;
			try {
				const result = consume({ frame: { descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels },
					descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' },
					diagnostics: { motionPixels: 0, inconsistentPixels: 0, referenceClippedPixels: 1, unresolvedPixels: 0, fallbackChannels: 0 } });
				assert.equal(canvas.painted.length, priorPaints + 1, 'The borrowed preview must be painted synchronously before its callback returns.');
				const returned = await result; entered.resolve(); if (held) await release.promise;
				if (failAfterPaint) throw new Error('Current source failed after painting.');
				return returned;
			} finally { pixels.fill(0); }
		},
		async merge(options, runtime) { mergeRequests.push(options); merges++; runtime?.onAcknowledged?.(receipt);
			if (failAfterMerge) throw new Error('Saved result refresh failed.');
			return { acknowledgement: receipt, diagnostics: { motionPixels: 0, inconsistentPixels: 0, referenceClippedPixels: 1, unresolvedPixels: 0, fallbackChannels: 0 } }; },
	};
	const mounted = await mountPhotoImportUi(() => <ImageHdrMergeDialogCurrentV1 port={port} locale={locale} isCurrent={() => current}
		publicationNotices={publicationNotices}
		onAcknowledged={value => { acknowledgements.push(value); }} onClose={() => { closes++; }}
		registerRetirement={retire => { retirements.add(retire); return () => { retirements.delete(retire); }; }} />);
	const button = (name: string) => { const node = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(node, name); return node; };
	const click = async (name: string) => { await act(async () => { reactProps(button(name)).onClick?.({}); await settle(); }); };
	const input = async (selector: string, value: string) => {
		await act(async () => { reactProps(mounted.dom.one(selector)).onChange?.({ currentTarget: { value } }); await settle(); });
	};
	const ready = async () => { await waitFor(async () => { await act(async () => { await settle(); }); return !button(copy.preview).hasAttribute('disabled'); }, 'captured HDR selection'); };
	let unmounted = false;
	const unmount = async () => { if (!unmounted) { unmounted = true; await mounted.dispose(); } };
	return { ...mounted, canvas, copy, receipt, entered, release, planes, signals, retirements, acknowledgements, previewRequests, mergeRequests, ready, button, click, input,
		previews: () => previews, merges: () => merges, closes: () => closes, hold() { held = true; }, failPreview() { failAfterPaint = true; }, failMergeFollowup() { failAfterMerge = true; }, stale() { current = false; },
		unmount,
		async dispose() { release.resolve(); try { const joins = [...retirements]; await unmount(); await Promise.allSettled(joins.map(retire => retire())); } finally { canvas.restore(); } },
	};
}

for (const locale of ['en', 'de'] as const) test(`${locale}: HDR dialog exposes explicit source/EV controls, Preview and creation without publishing on open`, async () => {
	const f = await fixture(locale);
	try {
		await f.ready(); assert.ok(f.dom.one('[data-image-hdr-merge-dialog]')); assert.equal(f.previews(), 0); assert.equal(f.merges(), 0);
		assert.equal(f.dom.container.querySelectorAll('[data-image-hdr-exposure-index]').length, 2);
		assert.ok(f.dom.one('[data-image-hdr-reference]')); assert.ok(f.dom.one('[data-image-hdr-file-name]'));
		assert.equal(f.acknowledgements.length, 0); await f.click(f.copy.preview);
		await waitFor(async () => { await act(async () => { await settle(); }); return f.dom.one('[data-image-hdr-preview]').getAttribute('data-state') === 'ready'; }, 'joined scoped HDR Preview');
		assert.deepEqual(f.canvas.painted, [[255, 128, 0, 255, 16, 32, 64, 255]]); assert.ok(f.planes.every(plane => plane.every(value => value === 0)));
		assert.equal(f.merges(), 0); assert.ok(f.dom.container.textContent.includes(f.copy.previewCaption));
		await f.click(f.copy.merge); assert.equal(f.merges(), 1); assert.deepEqual(f.acknowledgements, [f.receipt]);
	} finally { await f.dispose(); }
});

test('HDR filename editing retains incomplete text and sends only the completed name to Preview and Merge', async () => {
	const f = await fixture(), selector = '[data-image-hdr-file-name]';
	try {
		await f.ready();
		for (const draft of ['', 'Merged']) {
			await f.input(selector, draft);
			assert.equal(f.dom.one(selector).value, draft, 'The filename draft must remain visible after its input event.');
			assert.equal(f.button(f.copy.preview).hasAttribute('disabled'), true);
			assert.equal(f.button(f.copy.merge).hasAttribute('disabled'), true);
			await f.click(f.copy.preview); await f.click(f.copy.merge);
			assert.equal(f.previews(), 0); assert.equal(f.merges(), 0);
		}
		await f.input(selector, 'Merged.lshdr'); await f.ready();
		assert.equal(f.dom.one(selector).value, 'Merged.lshdr');
		const expected = { schemaVersion: 1, referenceIndex: 0, exposureMultipliers: [1, 1], alignment: 'none',
			deghost: { mode: 'off', threshold: .1 }, fileName: 'Merged.lshdr' } satisfies ImageHdrMergeAuthoringOptionsCurrentV1;
		await f.click(f.copy.preview);
		await waitFor(async () => { await act(async () => { await settle(); }); return f.dom.one('[data-image-hdr-preview]').getAttribute('data-state') === 'ready'; }, 'completed filename Preview');
		assert.deepEqual(f.previewRequests, [expected]);
		await f.click(f.copy.merge); assert.deepEqual(f.mergeRequests, [expected]);
		assert.deepEqual(f.acknowledgements, [f.receipt]);
	} finally { await f.dispose(); }
});

test('HDR exposure editing retains intermediate negative and decimal text before sending the completed multiplier', async () => {
	const f = await fixture(), selector = '[data-image-hdr-exposure-index="1"]';
	try {
		await f.ready();
		for (const draft of ['', '-', '-.']) {
			await f.input(selector, draft);
			assert.equal(f.dom.one(selector).value, draft, 'The exposure draft must remain visible after its input event.');
			assert.equal(f.button(f.copy.preview).hasAttribute('disabled'), true);
			assert.equal(f.button(f.copy.merge).hasAttribute('disabled'), true);
			await f.click(f.copy.preview); await f.click(f.copy.merge);
			assert.equal(f.previews(), 0); assert.equal(f.merges(), 0);
		}
		await f.input(selector, '-.5'); await f.ready();
		assert.equal(f.dom.one(selector).value, '-.5');
		const expected = { schemaVersion: 1, referenceIndex: 0, exposureMultipliers: [1, 2 ** -.5], alignment: 'none',
			deghost: { mode: 'off', threshold: .1 }, fileName: 'HDR merge.lshdr' } satisfies ImageHdrMergeAuthoringOptionsCurrentV1;
		await f.click(f.copy.preview);
		await waitFor(async () => { await act(async () => { await settle(); }); return f.dom.one('[data-image-hdr-preview]').getAttribute('data-state') === 'ready'; }, 'completed negative decimal Preview');
		assert.deepEqual(f.previewRequests, [expected]);
		await f.click(f.copy.merge); assert.deepEqual(f.mergeRequests, [expected]);
		assert.deepEqual(f.acknowledgements, [f.receipt]);
	} finally { await f.dispose(); }
});

test('repairing the filename cannot enable publication while an exposure draft is incomplete', async () => {
	const f = await fixture();
	try {
		await f.ready(); await f.input('[data-image-hdr-file-name]', 'Merged');
		await f.input('[data-image-hdr-exposure-index="1"]', '-');
		await f.input('[data-image-hdr-file-name]', 'Merged.lshdr');
		assert.equal(f.button(f.copy.preview).hasAttribute('disabled'), true);
		assert.equal(f.button(f.copy.merge).hasAttribute('disabled'), true);
		await f.click(f.copy.merge); assert.equal(f.merges(), 0);
		await f.input('[data-image-hdr-exposure-index="1"]', '-.5'); await f.ready();
		await f.click(f.copy.merge);
		assert.equal(f.mergeRequests[0]?.fileName, 'Merged.lshdr');
		assert.deepEqual(f.mergeRequests[0]?.exposureMultipliers, [1, 2 ** -.5]);
	} finally { await f.dispose(); }
});

test('changing the reference rebases completed exposure text and the exact published ratios together', async () => {
	const f = await fixture();
	try {
		await f.ready(); await f.input('[data-image-hdr-exposure-index="1"]', '-.5'); await f.ready();
		await f.input('[data-image-hdr-reference]', '1'); await f.ready();
		assert.equal(f.dom.one('[data-image-hdr-exposure-index="1"]').value, '0');
		assert.ok(Math.abs(Number(f.dom.one('[data-image-hdr-exposure-index="0"]').value) - .5) < 1e-12);
		await f.click(f.copy.merge);
		assert.equal(f.mergeRequests[0]?.referenceIndex, 1);
		assert.deepEqual(f.mergeRequests[0]?.exposureMultipliers, [1 / (2 ** -.5), 1]);
	} finally { await f.dispose(); }
});

test('HDR dialog Close aborts the held Preview and dismisses only after physical retirement, even when the source became stale', async () => {
	const f = await fixture();
	try {
		await f.ready(); f.hold(); await f.click(f.copy.preview); await f.entered.promise;
		assert.equal(f.dom.one('[data-image-hdr-preview]').getAttribute('data-state'), 'working'); f.stale();
		await f.click(f.copy.close); assert.equal(f.closes(), 0); assert.equal(f.signals[0]?.aborted, true);
		const retire = [...f.retirements][0]; assert.ok(retire); const joined = retire();
		assert.equal(await remainsPending(joined), true); assert.ok(f.planes[0]?.some(value => value !== 0));
		await act(async () => { f.release.resolve(); await joined; await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return f.closes() === 1; }, 'joined HDR dialog Close');
		assert.ok(f.planes.every(plane => plane.every(value => value === 0))); assert.equal(f.merges(), 0);
		assert.deepEqual(f.canvas.size(f.dom.one('canvas')), [0, 0]);
	} finally { await f.dispose(); }
});

test('a post-callback source failure clears painted HDR pixels and never leaves a successful Preview state', async () => {
	const f = await fixture();
	try {
		await f.ready(); f.failPreview(); await f.click(f.copy.preview);
		await waitFor(async () => { await act(async () => { await settle(); }); return f.dom.find('[role="alert"]') !== null; }, 'joined source failure');
		assert.equal(f.canvas.painted.length, 1); assert.equal(f.dom.one('[data-image-hdr-preview]').getAttribute('data-state'), 'failed');
		assert.deepEqual(f.canvas.size(f.dom.one('canvas')), [0, 0]); assert.equal(f.merges(), 0); assert.equal(f.acknowledgements.length, 0);
	} finally { await f.dispose(); }
});

test('unmount retains the exact painted canvas until a held Preview joins and releases its native backing', async () => {
	const f = await fixture();
	try {
		await f.ready(); f.hold(); await f.click(f.copy.preview); await f.entered.promise;
		const canvas = f.dom.one('canvas'), retire = [...f.retirements][0]; assert.ok(retire);
		assert.deepEqual(f.canvas.size(canvas), [2, 1]);
		await f.unmount(); const joined = retire();
		assert.equal(await remainsPending(joined), true); assert.ok(f.planes[0]?.some(value => value !== 0));
		f.release.resolve(); await joined;
		assert.ok(f.planes[0]?.every(value => value === 0)); assert.deepEqual(f.canvas.size(canvas), [0, 0]);
	} finally { await f.dispose(); }
});

test('a saved HDR result presents its publication notice alongside the genuine acknowledgement', async () => {
	const notice = 'HDR was saved. Reopen the project to see the result.', f = await fixture('en', [notice]);
	try {
		await f.ready(); assert.equal(f.dom.container.textContent.includes(notice), false);
		await f.click(f.copy.merge); assert.deepEqual(f.acknowledgements, [f.receipt]);
		assert.equal(f.dom.container.textContent.includes(notice), true);
	} finally { await f.dispose(); }
});

test('a failure after native HDR acknowledgement states that the Original was saved', async () => {
	const f = await fixture();
	try {
		await f.ready(); f.failMergeFollowup(); await f.click(f.copy.merge);
		await waitFor(() => f.dom.find('[role="alert"]') !== null, 'saved result follow-up failure');
		assert.deepEqual(f.acknowledgements, [f.receipt]);
		assert.equal(f.dom.one('[role="alert"]').textContent, 'The HDR Original was saved, but a later operation failed. Close this dialog and reload the application.');
	} finally { await f.dispose(); }
});
