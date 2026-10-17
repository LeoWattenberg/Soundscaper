/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelFrameV1 } from '../../../imaging/pixel-frame-contract-v1.ts';
import type { PhotoLibraryDevelopProxyRuntimeCurrentV1 } from '../../../photo-library-develop-proxy-port-current-v1.ts';
import type { PhotoDevelopPresentationSnapshotV2 } from '../photo-library-develop-presentation-v2.ts';
import type { PhotoDevelopPresentationViewKernelV1, PhotoDevelopPresentationPortsKernelV1 } from './photo-library-develop-presentation-kernel-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../../../photo-library-develop-full-resolution-port-v1.ts';
import { createPixelFrameHistogramV1 } from '../../../imaging/pixel-frame-histogram-v1.ts';
import { withLinearPixelFrameDisplayV1 } from '../../../imaging/pixel-frame-linear-display-v1.ts';
import { withPhotoDevelopDisplayFrameV1 } from '../../../imaging/photo-develop-display-frame-v1.ts';
import { presentPhotoDevelopProofAfterCurrentV1 } from './photo-library-develop-proof-presentation-current-v1.ts';

type Rendered = Pick<PhotoDevelopPresentationSnapshotV2, 'before' | 'after' | 'extent'>;
const CHECK = AbortSignal.prototype.throwIfAborted;

/** Native-depth Current presentation. Both byte conversions are disposable
 * display work; only the untouched word/float Original reaches development. */
export async function presentPhotoDevelopLinearV1(view: Readonly<PhotoDevelopPresentationViewKernelV1>, frame: PixelFrameV1,
	runtime: Readonly<PhotoLibraryDevelopProxyRuntimeCurrentV1>, signal: AbortSignal,
	paint: NonNullable<PhotoDevelopPresentationPortsKernelV1['paint']>, current: () => boolean): Promise<Rendered | null> {
	const original = await capturePhotoDevelopLinearBeforeV1(view, frame, signal, paint, current);
	return presentPhotoDevelopLinearAfterV1(view, frame, runtime, signal, paint, current, original);
}

/** Only scalar observations survive this scope, allowing canonical RAW words
 * and their displays to retire before a derived source is opened. */
export async function capturePhotoDevelopLinearBeforeV1(view: Readonly<PhotoDevelopPresentationViewKernelV1>, frame: PixelFrameV1,
	signal: AbortSignal, paint: NonNullable<PhotoDevelopPresentationPortsKernelV1['paint']>, current: () => boolean) {
	const check = () => { Reflect.apply(CHECK, signal, []); }, resolution = view.resolution ?? 'proxy';
	const full = PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1;
	return withLinearPixelFrameDisplayV1({ frame, signal }, async encoded => {
		const histogram = await createPixelFrameHistogramV1(encoded, { limits: full.source, signal }); check();
		const extent = await withPhotoDevelopDisplayFrameV1({ frame: encoded, signal }, display => {
			check(); if (current()) paint(view.before, display.frame, { limits: full.source, signal });
			return Object.freeze({ width: display.frame.descriptor.width, height: display.frame.descriptor.height });
		}, resolution);
		return { histogram, extent };
	}, resolution);
}

export async function presentPhotoDevelopLinearAfterV1(view: Readonly<PhotoDevelopPresentationViewKernelV1>, frame: PixelFrameV1,
	runtime: Readonly<PhotoLibraryDevelopProxyRuntimeCurrentV1>, signal: AbortSignal,
	paint: NonNullable<PhotoDevelopPresentationPortsKernelV1['paint']>, current: () => boolean,
	original: Awaited<ReturnType<typeof capturePhotoDevelopLinearBeforeV1>>): Promise<Rendered | null> {
	const check = () => { Reflect.apply(CHECK, signal, []); }, resolution = view.resolution ?? 'proxy';
	const full = PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1;
	check(); let completed: Rendered | null = null;
	await runtime[resolution === 'full' ? 'withFullResolution' : 'withProxy']({ frame, develop: view.develop, signal, ...(view.maskOverlay ? { maskOverlay: view.maskOverlay } : {}) }, async output => {
		check(); if (!current()) return;
		if (view.maskOverlay && (!output.maskOverlay || output.maskOverlay.maskId !== view.maskOverlay.maskId || output.maskOverlay.effectId !== view.maskOverlay.effectId)) {
			throw new RangeError('Native mask coverage does not match the selected adjustment.');
		}
		if (view.softProof) {
			completed = await presentPhotoDevelopProofAfterCurrentV1(view, output, signal, paint, current, original); return;
		}
		await withLinearPixelFrameDisplayV1({ frame: output.frame, signal }, encoded => withPhotoDevelopDisplayFrameV1({ frame: encoded, signal,
			...(view.maskOverlay ? { maskOverlay: output.maskOverlay, maskOverlayMode: view.maskOverlayMode } : {}) }, display => {
			check(); if (!current()) return;
			paint(view.after, display.frame, { limits: full.render, signal }); check();
			if (display.overlay && view.overlay) paint(view.overlay, display.overlay, { limits: full.render, signal });
			completed = Object.freeze({ before: original.histogram, after: output.histogram,
				extent: Object.freeze({ before: original.extent, after: Object.freeze({ width: display.frame.descriptor.width, height: display.frame.descriptor.height }) }) });
		}, resolution), 'full');
	});
	check(); return completed;
}
