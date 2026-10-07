/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { readPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { snapshotCanonicalRgba8V1 } from '../../common/editor/imaging/pixel-frame-canonical-rgba8-v1.ts';
import type { FramescaperBrowserNativeImageDecodeSessionV1, OpenFramescaperBrowserNativeImageV1 } from '../../common/editor/timeline-image-native-decode-v1.ts';
import type { PhotoSourceAdmissionV1 } from './photo-source-admission-v1.ts';

/** Product photo admission wraps the existing shared native decoder, without owning a raster implementation. */
export function createPhotoNativeImagePortV1(admission: PhotoSourceAdmissionV1, orientation: number,
	openImage: OpenFramescaperBrowserNativeImageV1, signal: AbortSignal): OpenFramescaperBrowserNativeImageV1 {
	if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) throw new RangeError('Photo native orientation is unsupported.');
	const swapped = [5, 6, 7, 8].includes(orientation);
	const width = swapped ? admission.height : admission.width, height = swapped ? admission.width : admission.height;
	return async request => {
		const session = await openImage(request);
		const cleanup = Object.getOwnPropertyDescriptor(session, 'close');
		if (!cleanup || !Object.hasOwn(cleanup, 'value') || typeof cleanup.value !== 'function') throw new TypeError('Photo decoder requires an own data cleanup port.');
		const release = cleanup.value as FramescaperBrowserNativeImageDecodeSessionV1['close'];
		let closed = false;
		const close = (): void => { if (closed) return; closed = true; release.call(session); };
		try {
			signal.throwIfAborted();
			const ports = readClosedDomainRecord(session, 'photo decoder session', ['metadata', 'decodeFrame', 'close']);
			const decode = readClosedDomainField(ports, 'decodeFrame', 'photo decoder session');
			if (typeof decode !== 'function') throw new TypeError('Photo decoder requires an own data extraction port.');
			const decodeFrame = decode as FramescaperBrowserNativeImageDecodeSessionV1['decodeFrame'];
			const metadata = readClosedDomainRecord(readClosedDomainField(ports, 'metadata', 'photo decoder session'), 'photo decoder metadata', ['width', 'height', 'frameCount', 'topology', 'runtimeVersion']);
			const field = (key: string) => readClosedDomainField(metadata, key, 'photo decoder metadata');
			if (field('topology') !== 'single' || field('frameCount') !== 1) throw new RangeError('A photo requires exactly one static frame.');
			if (field('width') !== width || field('height') !== height) throw new RangeError('Oriented photo dimensions disagree with its source header.');
			const runtimeVersion = field('runtimeVersion');
			if (typeof runtimeVersion !== 'string' || runtimeVersion.length < 1 || runtimeVersion.length > 128) throw new TypeError('Photo decoder requires a bounded runtime version.');
			return Object.freeze({ metadata: Object.freeze({ width, height, frameCount: 1, topology: 'single' as const, runtimeVersion }),
				async decodeFrame(frameIndex: number, frameSignal?: AbortSignal) {
					if (closed) throw new Error('Photo decoder session is closed.');
					if (frameIndex !== 0) throw new RangeError('A static photo has one frame.');
					(frameSignal ?? signal).throwIfAborted();
					const result = readClosedDomainRecord(await decodeFrame.call(session, frameIndex, frameSignal), 'photo decoded frame', ['rgba', 'durationMicroseconds']);
					(frameSignal ?? signal).throwIfAborted();
					const rgba = readClosedDomainField(result, 'rgba', 'photo decoded frame');
					readPixelFrameV1({ descriptor: { schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: rgba }, {
						maximumSidePixels: IMAGE_IMPORT_LIMITS.maximumSidePixels, maximumPixels: IMAGE_IMPORT_LIMITS.maximumSdrPixelsPerFrame, maximumBytes: IMAGE_IMPORT_LIMITS.maximumSdrPixelsPerFrame * 4 });
					if (!(rgba instanceof Uint8Array)) throw new TypeError('Native photo pixels require Uint8Array.');
					const duration = readClosedDomainField(result, 'durationMicroseconds', 'photo decoded frame');
					if (duration !== null && typeof duration !== 'number') throw new TypeError('Native photo frame duration is invalid.');
					return Object.freeze({ rgba: snapshotCanonicalRgba8V1(rgba, width, height), durationMicroseconds: duration });
				}, close });
		} catch (error) { close(); throw error; }
	};
}
