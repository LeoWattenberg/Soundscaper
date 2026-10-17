/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopPreviewCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopPreviewCurrentV1.tsx';
import { PhotoLibraryDevelopPresentationCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';
import { maskedDevelop, rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';

test('actual Current preview captures temporary proof for After and obtains a fresh canvas on profile changes', async () => {
	const canvas = currentAppCanvasBoundary(), retained: unknown[] = [], method = PhotoLibraryDevelopPresentationCurrentV1.prototype.setView;
	PhotoLibraryDevelopPresentationCurrentV1.prototype.setView = function (this: PhotoLibraryDevelopPresentationCurrentV1, request) { retained.push(request); return Reflect.apply(method, this, [request]); };
	let softProof: { profile: 'srgb' | 'display-p3'; bitDepth: 8 | 16 } | undefined;
	const develop = normalizeImageDevelopStateV1OrV2(maskedDevelop([createVideoEffect('tone-ladder-v1', { id: 'tone' })]));
	const maskOverlay = Object.freeze({ maskId: 'mask', effectId: 'tone' });
	const readPreview = async () => ({ outcome: 'missing' as const }), runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const loadProxy = async () => runtime, beforePresent = Promise.resolve(), retirements = new Set<() => Promise<void>>();
	const registerRetirement = (retire: () => Promise<void>) => { retirements.add(retire); return () => { retirements.delete(retire); }; };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewCurrentV1 {...{ softProof }} photoId="photo" revision={7} develop={develop}
		readPreview={readPreview} loadProxy={loadProxy} beforePresent={beforePresent} registerRetirement={registerRetirement}
		messages={photoDevelopCopy('en')} locale="en" maskOverlay={maskOverlay} />);
	try {
		await act(async () => { await settle(); });
		const before = mounted.dom.one('[data-photo-develop-before]'), initial = mounted.dom.one('[data-photo-develop-after]');
		const originalOverlay = mounted.dom.one('[data-photo-develop-mask-overlay]');
		softProof = { profile: 'display-p3', bitDepth: 16 }; await mounted.render(); await act(async () => { await settle(); });
		assert.deepEqual(Reflect.get(retained.at(-1) as object, 'softProof'), softProof, 'The actual Current presentation receives the captured temporary policy.');
		const p3 = mounted.dom.one('[data-photo-develop-after]'); assert.notEqual(p3, initial, 'A P3 context requires a fresh native canvas.');
		const p3Overlay = mounted.dom.one('[data-photo-develop-mask-overlay]'); assert.notEqual(p3Overlay, originalOverlay, 'An existing sRGB overlay context cannot become a P3 target.');
		assert.equal(mounted.dom.one('[data-photo-develop-before]'), before, 'Canonical Before retains its sRGB target.');
		softProof = { profile: 'display-p3', bitDepth: 8 }; await mounted.render(); await act(async () => { await settle(); });
		assert.equal(mounted.dom.one('[data-photo-develop-after]'), p3, 'Depth changes reuse the same profile context.');
		assert.equal(mounted.dom.one('[data-photo-develop-mask-overlay]'), p3Overlay);
		assert.deepEqual(Reflect.get(retained.at(-1) as object, 'softProof'), softProof);
		softProof = undefined; await mounted.render(); await act(async () => { await settle(); });
		assert.notEqual(mounted.dom.one('[data-photo-develop-after]'), p3); assert.equal(mounted.dom.one('[data-photo-develop-before]'), before);
		assert.notEqual(mounted.dom.one('[data-photo-develop-mask-overlay]'), p3Overlay);
		assert.equal(Object.hasOwn(retained.at(-1) as object, 'softProof'), false, 'Off preserves the exact existing request shape.');
	} finally { const joins = [...retirements]; await mounted.dispose(); await Promise.allSettled(joins.map(retire => retire()));
		PhotoLibraryDevelopPresentationCurrentV1.prototype.setView = method; canvas.restore(); }
});

test('proof replacement aborts and joins the held native Original before acquiring its successor', async () => {
	const canvas = currentAppCanvasBoundary(), entered = deferred<void>(), release = deferred<void>(), signals: AbortSignal[] = [], planes: Uint8Array[] = [];
	let reads = 0, softProof: { profile: 'srgb'; bitDepth: 16 } | undefined;
	const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async (_request, consume, options) => {
		assert.ok(options?.signal); signals.push(options.signal); reads++;
		const frame = rgbaFrame([64, 96, 128, 255]); planes.push(frame.pixels);
		try { if (reads === 1) { entered.resolve(); await release.promise; } options.signal.throwIfAborted();
			return await consume({ photoId: 'photo', revision: 7, frame });
		} finally { frame.pixels.fill(0); }
	};
	const develop = defaultImageDevelopStateV2(), runtime = createPhotoDevelopRenderRuntimeCurrentV1(), loadProxy = async () => runtime;
	const readPreview = async () => ({ outcome: 'missing' as const }), beforePresent = Promise.resolve(), retirements = new Set<() => Promise<void>>();
	const registerRetirement = (retire: () => Promise<void>) => { retirements.add(retire); return () => { retirements.delete(retire); }; };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewCurrentV1 {...{ softProof }} photoId="photo" revision={7} develop={develop}
		withOriginalFrame={withOriginalFrame} readPreview={readPreview} loadProxy={loadProxy} beforePresent={beforePresent} registerRetirement={registerRetirement} messages={photoDevelopCopy('en')} locale="en" />);
	try {
		await entered.promise; softProof = { profile: 'srgb', bitDepth: 16 }; await mounted.render(); await act(async () => { await settle(); });
		assert.equal(signals[0]!.aborted, true); assert.equal(reads, 1, 'A new proof waits for complete old borrower retirement.');
		await act(async () => { release.resolve(); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return reads === 2; }, 'native successor proof read');
		assert.ok(planes.every(plane => plane.every(value => value === 0)));
	} finally { release.resolve(); const joins = [...retirements]; await mounted.dispose(); await Promise.allSettled(joins.map(retire => retire())); canvas.restore(); }
});
