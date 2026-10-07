/* SPDX-License-Identifier: AGPL-3.0-only */

import { withPhotoOriginalFrameV1 } from '../../src/lightscaper/preview/photo-original-frame-v1.ts';
import { planPhotoPreviewV1 } from '../../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1 } from '../../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { openFramescaperBrowserNativeImageV1 } from '../../src/common/editor/timeline-image-browser-native-port.ts';
import type { PixelFrameV1 } from '../../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { jpegWithExifOrientationV1, permuteExifRgbaV1, photoOrientationGridV1 } from './lightscaper-photo-orientation-oracle.ts';
import { compareOrientationPixelsV1, encodePhotoOrientationGridJpegFixtureV1 } from './lightscaper-photo-orientation-native-fixture.ts';

export { compareOrientationPixelsV1 };

export async function qualifyPhotoOriginalRegenerationNativeV1() {
	const seed = await encodePhotoOrientationGridJpegFixtureV1();
	let baseline: Uint8Array | null = null, maximumSeedSampleDifference = 0;
	const rows: Readonly<Record<string, unknown>>[] = [];
	for (let orientation = 1; orientation <= 8; orientation++) {
		const input = jpegWithExifOrientationV1(seed.jpeg, orientation), originalSha256 = await digest(input), source = binding(input, orientation, originalSha256);
		const body = new File([input.slice()], `Retained-${orientation}.jpg`, { type: 'image/jpeg', lastModified: 0 });
		let closed = 0, consumedAfterClose = false, held: PixelFrameV1 | null = null, sourceOrientation = 0;
		const prepared = await withPhotoOriginalFrameV1({ binding: source, body }, async (frame, provenance) => {
			consumedAfterClose = closed === 1; held = frame; sourceOrientation = provenance.orientation;
			if (orientation === 1) {
				baseline = new Uint8Array(frame.pixels); const grid = photoOrientationGridV1();
				for (let y = 4; y < 24; y += 8) for (let x = 4; x < 32; x += 8) for (let channel = 0; channel < 3; channel++) {
					const index = (y * 32 + x) * 4 + channel;
					maximumSeedSampleDifference = Math.max(maximumSeedSampleDifference, Math.abs(baseline[index]! - grid.rgba[index]!));
				}
			}
			const plan = planPhotoPreviewV1({ binding: source, source: frame.descriptor, tier: 'thumbnail' });
			return preparePhotoPreviewV1({ plan, binding: source, frame });
		}, { openImage: async request => { const native = await openFramescaperBrowserNativeImageV1(request); return { ...native, close() { closed++; native.close(); } }; } });
		if (!baseline) throw new Error('Regeneration did not produce its orientation-one baseline.');
		const oracle = permuteExifRgbaV1(baseline, 32, 24, orientation), output = new Uint8Array(await prepared.body.arrayBuffer());
		rows.push(Object.freeze({ orientation, sourceOrientation, width: prepared.descriptor.width, height: prepared.descriptor.height,
			expectedWidth: oracle.width, expectedHeight: oracle.height, ...compareOrientationPixelsV1(output, oracle.rgba),
			closed, consumedAfterClose, frameWiped: (held as PixelFrameV1 | null)?.pixels.every(value => value === 0) === true,
			originalShaMatches: await digest(new Uint8Array(await body.arrayBuffer())) === originalSha256 && prepared.binding.contentSha256 === originalSha256,
			inputUnchanged: equal(input, jpegWithExifOrientationV1(seed.jpeg, orientation)), outputShaMatches: await digest(output) === prepared.outputSha256,
			bodyLength: output.length, opaque: [...output].filter((_value, channel) => channel % 4 === 3).every(alpha => alpha === 255),
			bodyOriginalFree: output.length === 32 * 24 * 4 && prepared.byteLength === output.length }));
	}
	return Object.freeze({ rows, encodedByteLength: seed.jpeg.length, maximumSeedSampleDifference });
}

export async function qualifyPhotoOriginalRegenerationRefusalNativeV1() {
	const seed = await encodePhotoOrientationGridJpegFixtureV1(), input = jpegWithExifOrientationV1(seed.jpeg, 6, 65535), before = await digest(input);
	let opened = 0, consumed = 0, colorError: string | null = null, digestError: string | null = null;
	const openImage = async (request: Parameters<typeof openFramescaperBrowserNativeImageV1>[0]) => { opened++; return openFramescaperBrowserNativeImageV1(request); };
	try { await withPhotoOriginalFrameV1({ binding: binding(input, 6, before), body: new Blob([input.slice()]) }, async () => { consumed++; }, { openImage }); }
	catch (error) { colorError = String(error); }
	try { await withPhotoOriginalFrameV1({ binding: { ...binding(input, 6, before), contentSha256: 'b'.repeat(64) }, body: new Blob([input.slice()]) }, async () => { consumed++; }, { openImage }); }
	catch (error) { digestError = String(error); }
	return Object.freeze({ opened, consumed, colorError, digestError, inputUnchanged: before === await digest(input) });
}

export async function qualifyPhotoOriginalRegenerationCancellationNativeV1() {
	const seed = await encodePhotoOrientationGridJpegFixtureV1(), input = jpegWithExifOrientationV1(seed.jpeg, 8), originalSha256 = await digest(input);
	const controller = new AbortController(), reason = new Error('cancel late native open');
	let opened = 0, closed = 0, consumed = 0, rejectedReason = false;
	try {
		await withPhotoOriginalFrameV1({ binding: binding(input, 8, originalSha256), body: new Blob([input.slice()]), signal: controller.signal }, async () => { consumed++; }, {
			openImage: async request => { const native = await openFramescaperBrowserNativeImageV1(request); opened++; controller.abort(reason); return { ...native, close() { closed++; native.close(); } }; },
		});
	} catch (error) { rejectedReason = error === reason; }
	return Object.freeze({ opened, closed, consumed, rejectedReason, inputUnchanged: originalSha256 === await digest(input) });
}

function binding(input: Uint8Array, orientation: number, contentSha256: string) {
	return { catalogId: 'regeneration-catalog', photoId: `photo-${orientation}`, originalId: `original-${orientation}`, storageKey: `retained-${orientation}`,
		contentSha256, byteLength: input.length, width: orientation > 4 ? 24 : 32, height: orientation > 4 ? 32 : 24 };
}
async function digest(bytes: Uint8Array): Promise<string> {
	const output = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()));
	return [...output].map(value => value.toString(16).padStart(2, '0')).join('');
}
function equal(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
