/* SPDX-License-Identifier: AGPL-3.0-only */

import { preparePhotoImportGestureV1, type PhotoImportPreparedV1 } from '../../src/lightscaper/import/photo-import-preparation-v1.ts';
import { openFramescaperBrowserNativeImageV1 } from '../../src/common/editor/timeline-image-browser-native-port.ts';
import { openFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../../src/common/editor/timeline-image-model.ts';
import { jpegWithExifOrientationV1, permuteExifRgbaV1, photoOrientationGridV1, unprofiledCanvasJpegFixtureV1 } from './lightscaper-photo-orientation-oracle.ts';

const CATALOG = { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'orientation-catalog', name: 'Orientation qualification',
	revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] };

/** Real JPEG pixels use the existing native route and shared packed-frame reader. */
export async function qualifyPhotoExifOrientationNativeV1() {
	const encoded = await encodeGrid(), inputs = Array.from({ length: 8 }, (_unused, index) => jpegWithExifOrientationV1(encoded.jpeg, index + 1));
	const nativeRuntimes: string[] = [];
	const stream = preparePhotoImportGestureV1(request(inputs), { openImage: async input => {
		const native = await openFramescaperBrowserNativeImageV1(input); nativeRuntimes.push(native.metadata.runtimeVersion); return native;
	} });
	let baseline: Uint8Array | null = null, maximumSeedSampleDifference = 0;
	const rows: Readonly<Record<string, unknown>>[] = [];
	for await (const outcome of stream) {
		const orientation = outcome.index + 1, expected = inputs[outcome.index]!;
		if (outcome.outcome === 'failed') { rows.push(Object.freeze({ orientation, status: 'failed', message: String(outcome.error) })); continue; }
		const reader = await artifactReader(outcome), pixels = await reader.readFrame(0);
		if (orientation === 1) {
			baseline = pixels; const grid = photoOrientationGridV1();
			for (let y = 4; y < grid.height; y += 8) for (let x = 4; x < grid.width; x += 8) for (let channel = 0; channel < 3; channel++) {
				const index = (y * grid.width + x) * 4 + channel;
				maximumSeedSampleDifference = Math.max(maximumSeedSampleDifference, Math.abs(pixels[index]! - grid.rgba[index]!));
			}
		}
		if (!baseline) throw new Error('The orientation-one baseline was not decoded.');
		const oracle = permuteExifRgbaV1(baseline, 32, 24, orientation), actual = new Uint8Array(await outcome.original.arrayBuffer());
		const packedOriginal = await reader.readOriginal(), expectedSha256 = await digest(expected);
		const { maximumPixelDifference, unequalChannels } = compareOrientationPixelsV1(pixels, oracle.rgba);
		rows.push(Object.freeze({ orientation, status: 'prepared', width: outcome.photo.original.width, height: outcome.photo.original.height,
			expectedWidth: oracle.width, expectedHeight: oracle.height, unequalChannels, maximumPixelDifference,
			metadataOrientation: outcome.photo.metadata.orientation, extractedOrientation: outcome.photo.extractedMetadata?.exif?.orientation,
			originalBytesEqual: equal(actual, expected), packedOriginalEqual: equal(packedOriginal, expected), inputUnchanged: equal(expected, jpegWithExifOrientationV1(encoded.jpeg, orientation)),
			shaMatches: outcome.photo.original.contentSha256 === expectedSha256 && outcome.decodeArtifact.originalSha256 === expectedSha256 && await digest(actual) === expectedSha256,
			lengthMatches: outcome.photo.original.byteLength === expected.length && outcome.decodeArtifact.originalByteLength === expected.length,
			pixelByteLength: pixels.length, opaque: [...pixels].filter((_value, channel) => channel % 4 === 3).every(alpha => alpha === 255) }));
	}
	return Object.freeze({ rows, maximumSeedSampleDifference, encodedByteLength: encoded.jpeg.length, removedEncoderIccSegments: encoded.removedIccSegments, nativeRuntimes: [...new Set(nativeRuntimes)] });
}

export async function qualifyPhotoExifColorRefusalNativeV1() {
	const original = jpegWithExifOrientationV1((await encodeGrid()).jpeg, 6, 65535), before = await digest(original);
	let opened = 0;
	const stream = preparePhotoImportGestureV1(request([original]), { openImage: async input => { opened++; return openFramescaperBrowserNativeImageV1(input); } });
	const first = await stream.next(); await stream.return(undefined);
	return { outcome: first.value?.outcome, message: first.value?.outcome === 'failed' ? String(first.value.error) : null,
		opened, inputUnchanged: before === await digest(original) };
}

function request(inputs: readonly Uint8Array[]) {
	return { files: inputs.map((input, index) => new File([input.slice()], `Orientation-${index + 1}.jpg`, { type: 'image/jpeg', lastModified: 0 })),
		catalog: CATALOG, createdAt: '2026-10-07T00:00:00.000Z',
		ownership: inputs.map((_input, index) => ({ photoId: `photo-${index}`, originalId: `original-${index}`,
			originalStorageKey: `storage-${index}`, masterVersionId: `master-${index}` })) };
}

export async function encodePhotoOrientationGridJpegFixtureV1(): Promise<Readonly<{ jpeg: Uint8Array; removedIccSegments: number }>> {
	const grid = photoOrientationGridV1(), canvas = document.createElement('canvas'); canvas.width = grid.width; canvas.height = grid.height;
	const context = canvas.getContext('2d', { colorSpace: 'srgb' }); if (!context) throw new Error('Orientation fixture needs a real 2D canvas.');
	context.putImageData(new ImageData(Uint8ClampedArray.from(grid.rgba), grid.width, grid.height), 0, 0);
	const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => { if (value) resolve(value); else reject(new Error('Browser JPEG encoder returned no original.')); }, 'image/jpeg', 0.95));
	if (blob.type !== 'image/jpeg' || blob.size > 64 * 1024) throw new RangeError('Native JPEG fixture exceeded its MIME/64KiB budget.');
	return unprofiledCanvasJpegFixtureV1(new Uint8Array(await blob.arrayBuffer()));
}

const encodeGrid = encodePhotoOrientationGridJpegFixtureV1;

/** Report pixel differences, including missing/extra bytes; dimensions cannot grant qualification. */
export function compareOrientationPixelsV1(actual: Uint8Array, expected: Uint8Array) {
	let maximumPixelDifference = 0, unequalChannels = 0;
	for (let channel = 0; channel < Math.max(actual.length, expected.length); channel++) {
		const difference = Math.abs((actual[channel] ?? -256) - (expected[channel] ?? -256));
		maximumPixelDifference = Math.max(maximumPixelDifference, difference); if (difference !== 0) unequalChannels++;
	}
	return Object.freeze({ maximumPixelDifference, unequalChannels });
}

async function artifactReader(outcome: PhotoImportPreparedV1) {
	const artifact = outcome.decodeArtifact;
	return openFramescaperImageFramePackV1({ source: { schemaVersion: 1, kind: 'image', id: 'orientation-artifact', name: outcome.fileName,
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, storageKey: 'orientation-artifact', contentSha256: artifact.contentSha256, assetByteLength: artifact.assetByteLength,
		original: { fileName: outcome.fileName, mimeType: 'image/jpeg', recognizedFormat: 'jpeg', byteLength: artifact.originalByteLength, sha256: artifact.originalSha256 },
		canonical: { width: artifact.width, height: artifact.height, frameCount: 1, hasAlpha: artifact.hasAlpha,
			durationTicks: artifact.durationTicks, timingMode: artifact.timingMode }, conversionReceiptSha256: artifact.conversionReceiptSha256 },
		read: async (offset, length) => new Uint8Array(await artifact.body.slice(offset, offset + length).arrayBuffer()) });
}
async function digest(bytes: Uint8Array): Promise<string> {
	const output = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()));
	return [...output].map(value => value.toString(16).padStart(2, '0')).join('');
}
function equal(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
