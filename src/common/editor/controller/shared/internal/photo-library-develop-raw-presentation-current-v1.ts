/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopProxyRuntimeCurrentV1 } from '../../../photo-library-develop-proxy-port-current-v1.ts';
import type { PhotoDevelopPresentationViewKernelV1, PhotoDevelopPresentationPortsKernelV1 } from './photo-library-develop-presentation-kernel-v1.ts';
import { capturePhotoDevelopLinearBeforeV1, presentPhotoDevelopLinearAfterV1 } from './photo-library-develop-linear-presentation-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../photo-library-develop-linear-port-v1.ts';
import { readPixelFrameV1 } from '../../../imaging/pixel-frame-contract-v1.ts';
import { checkRepairSignalV1 } from '../../../imaging/pixel-frame-repair-lifetime-v1.ts';

/** Canonical Before and selected derived After have sequential source leases.
 * Neither culling previews nor a second exposure multiplication participates.
 * The runtime independently proves the matching native profile before it
 * samples a proxy or starts any repair, geometry, mask or adjustment stage. */
export async function presentPhotoDevelopRawCurrentV1(view: Readonly<PhotoDevelopPresentationViewKernelV1>,
	runtime: Readonly<PhotoLibraryDevelopProxyRuntimeCurrentV1>, ports: PhotoDevelopPresentationPortsKernelV1,
	signal: AbortSignal, current: () => boolean) {
	const develop = view.develop;
	if (develop.processVersion !== 4 || develop.rawDevelopment.mode === 'canonical') throw new TypeError('Derived presentation requires a selected RAW profile.');
	if (!ports.withOriginalFrame || !ports.withDerivedFrame || !ports.paint) throw new Error('Derived RAW development is unavailable.');
	const profile = develop.rawDevelopment.mode === 'headroom' ? 'linear-headroom-v1' : 'highlight-recovery-v1';
	const request = { schemaVersion: 1 as const, photoId: view.photoId, expectedRevision: view.revision! };
	const original = await ports.withOriginalFrame(request, async source => {
		checkRepairSignalV1(signal);
		if (source.photoId !== view.photoId || source.revision !== view.revision) throw new Error('Canonical RAW Original changed its identity or revision.');
		const frame = readPixelFrameV1(source.frame, PHOTO_DEVELOP_LINEAR_LIMITS_V1.source);
		if (frame.descriptor.sampleFormat !== 'unorm16' || frame.descriptor.primaries !== 'srgb' || frame.descriptor.transfer !== 'linear') {
			throw new RangeError('Derived RAW presentation requires a canonical native RAW Original.');
		}
		const before = await capturePhotoDevelopLinearBeforeV1(view, frame, signal, ports.paint!, current);
		return { before, width: frame.descriptor.width, height: frame.descriptor.height };
	}, { signal });
	checkRepairSignalV1(signal);
	return ports.withDerivedFrame({ ...request, profile }, source => {
		checkRepairSignalV1(signal);
		if (source.photoId !== view.photoId || source.revision !== view.revision || source.profile !== profile) {
			throw new Error('Derived RAW source changed its identity, revision or requested profile.');
		}
		const frame = readPixelFrameV1(source.frame, PHOTO_DEVELOP_LINEAR_LIMITS_V1.source);
		if (frame.descriptor.width !== original.width || frame.descriptor.height !== original.height) throw new RangeError('Derived RAW source changed its oriented extent.');
		return presentPhotoDevelopLinearAfterV1(view, frame, runtime, signal, ports.paint!, current, original.before);
	}, { signal });
}
