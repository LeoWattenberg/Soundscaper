/* SPDX-License-Identifier: AGPL-3.0-only */

import { classifyImageFormatSignature, type ReviewedImageFormat } from './image-format-signature.ts';
import { admitImageCanonicalBody, admitImageDecodeWorkload } from './image-import-admission.ts';
import { routeImageDecoder } from './image-decoder-routing.ts';
import {
	createFramescaperImageFramePackV1,
	type FramescaperImageFramePackPublicationV1,
} from './timeline-image-frame-pack-v1.ts';
import type { FramescaperImageTimingModeV1 } from './timeline-image-model.ts';

const FALLBACK_DURATION_MICROSECONDS = 5_000_000;
const NATIVE_MIME_TYPES = Object.freeze(new Map<ReviewedImageFormat, string>([
	['jpeg', 'image/jpeg'], ['png', 'image/png'], ['gif', 'image/gif'],
	['webp', 'image/webp'], ['bmp', 'image/bmp'],
]));

export interface FramescaperBrowserNativeImageMetadataV1 {
	readonly width: number;
	readonly height: number;
	readonly frameCount: number;
	readonly topology: 'single' | 'animated';
	readonly runtimeVersion: string;
}

export interface FramescaperBrowserNativeImageDecodedFrameV1 {
	readonly rgba: Uint8Array;
	readonly durationMicroseconds: number | null;
}

export interface FramescaperBrowserNativeImageDecodeSessionV1 {
	readonly metadata: FramescaperBrowserNativeImageMetadataV1;
	decodeFrame(index: number, signal?: AbortSignal): Promise<FramescaperBrowserNativeImageDecodedFrameV1>;
	close(): void;
}

export type OpenFramescaperBrowserNativeImageV1 = (request: Readonly<{
	readonly bytes: Uint8Array;
	readonly format: ReviewedImageFormat;
	readonly mimeType: string;
	readonly signal?: AbortSignal;
}>) => Promise<FramescaperBrowserNativeImageDecodeSessionV1>;

export interface FramescaperBrowserNativeImageDecodeRequestV1 {
	readonly bytes: Uint8Array;
	readonly fileName: string;
	readonly mimeTypeHint: string | null;
	readonly open: OpenFramescaperBrowserNativeImageV1;
	readonly signal?: AbortSignal;
}

export interface FramescaperBrowserNativeImageDecodeResultV1 {
	readonly recognizedFormat: ReviewedImageFormat;
	readonly canonicalMimeType: string;
	readonly publication: FramescaperImageFramePackPublicationV1;
	readonly notices: readonly string[];
}

/** Strictly classify, admit, decode, normalize, and pack one qualified native raster. */
export async function decodeFramescaperBrowserNativeImageV1(
	request: FramescaperBrowserNativeImageDecodeRequestV1,
): Promise<FramescaperBrowserNativeImageDecodeResultV1> {
	if (!(request?.bytes instanceof Uint8Array) || request.bytes.byteLength < 1) {
		throw new TypeError('Browser-native image decode requires non-empty bytes.');
	}
	if (typeof request.fileName !== 'string' || !request.fileName) {
		throw new TypeError('Browser-native image decode requires a file name.');
	}
	if (typeof request.open !== 'function') throw new TypeError('Browser-native image decode requires a decoder port.');
	cancelled(request.signal);
	const classification = classifyImageFormatSignature(request.bytes);
	if (classification.status === 'excluded') {
		throw new RangeError(`The excluded ${classification.format.toUpperCase()} image family cannot be imported.`);
	}
	if (classification.status !== 'recognized') throw new RangeError('The image byte signature is not recognized.');
	const mimeType = NATIVE_MIME_TYPES.get(classification.format);
	if (!mimeType) throw new RangeError(`The reviewed ${classification.format} format has no qualified browser-native route.`);
	let session: FramescaperBrowserNativeImageDecodeSessionV1 | null = null;
	try {
		session = await request.open({
			bytes: request.bytes, format: classification.format, mimeType,
			...(request.signal ? { signal: request.signal } : {}),
		});
		const metadata = normalizeMetadata(session.metadata);
		const route = routeImageDecoder({
			format: classification.format, colour: 'srgb-8-bit', topology: metadata.topology,
			qualifiedRoutes: [{
				decoder: 'browser-native', format: classification.format,
				colour: 'srgb-8-bit', topology: metadata.topology,
			}],
		});
		if (route.status !== 'ready' || route.decoder !== 'browser-native') {
			throw new RangeError(`The ${classification.format} topology is not qualified for browser-native decode.`);
		}
		admit(metadata, request.bytes.byteLength, metadata.frameCount * FALLBACK_DURATION_MICROSECONDS);
		const notices: string[] = [];
		let presentationTicks = 0n;
		let fallbackCount = 0;
		const frames = [];
		for (let index = 0; index < metadata.frameCount; index += 1) {
			cancelled(request.signal);
			const decoded = await session.decodeFrame(index, request.signal);
			const rgba = normalizedRgba(decoded.rgba, metadata.width, metadata.height, index);
			const embedded = positiveDuration(decoded.durationMicroseconds);
			const durationTicks = BigInt(embedded ?? FALLBACK_DURATION_MICROSECONDS);
			if (embedded === null) fallbackCount += 1;
			frames.push(Object.freeze({ presentationTicks, durationTicks, rgba }));
			presentationTicks += durationTicks;
		}
		admit(metadata, request.bytes.byteLength, safeNumber(presentationTicks, 'image duration'));
		const timingMode: FramescaperImageTimingModeV1 = fallbackCount === 0
			? 'embedded' : fallbackCount === metadata.frameCount ? 'fallback' : 'mixed';
		if (fallbackCount > 0) notices.push(
			`${String(fallbackCount)} image frame${fallbackCount === 1 ? '' : 's'} used the five-second timing fallback.`,
		);
		const publication = createFramescaperImageFramePackV1({
			original: request.bytes,
			receipt: {
				schemaVersion: 1,
				decoder: { id: 'browser-native', version: metadata.runtimeVersion },
				input: {
					format: classification.format,
					mimeTypeHint: request.mimeTypeHint,
					byteLength: request.bytes.byteLength,
				},
				canvas: { width: metadata.width, height: metadata.height },
				colour: { input: 'srgb-8-bit', output: 'srgb-rgba8', recipe: route.normalization },
				topology: metadata.topology,
				timing: { fallbackMicroseconds: FALLBACK_DURATION_MICROSECONDS, fallbackFrameCount: fallbackCount },
				notices,
			},
			width: metadata.width, height: metadata.height, timingMode, frames,
		});
		admitImageCanonicalBody(publication.assetByteLength);
		return Object.freeze({
			recognizedFormat: classification.format,
			canonicalMimeType: mimeType,
			publication,
			notices: Object.freeze(notices),
		});
	} finally {
		session?.close();
	}
}

function admit(
	metadata: FramescaperBrowserNativeImageMetadataV1,
	sourceByteLength: number,
	durationMicroseconds: number,
): void {
	admitImageDecodeWorkload({
		sourceByteLength,
		width: metadata.width,
		height: metadata.height,
		precision: 'sdr',
		frameCount: metadata.frameCount,
		durationMicroseconds,
		iccBytes: 0,
		metadataBytes: 0,
	});
}

function normalizeMetadata(value: unknown): FramescaperBrowserNativeImageMetadataV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Browser-native image metadata must be an object.');
	}
	const row = value as Record<string, unknown>;
	const expected = ['width', 'height', 'frameCount', 'topology', 'runtimeVersion'];
	if (Reflect.ownKeys(row).length !== expected.length || Reflect.ownKeys(row).some((key) => (
		typeof key !== 'string' || !expected.includes(key)
	))) throw new TypeError('Browser-native image metadata must be exact.');
	if (!Number.isSafeInteger(row.width) || Number(row.width) < 1
		|| !Number.isSafeInteger(row.height) || Number(row.height) < 1
		|| !Number.isSafeInteger(row.frameCount) || Number(row.frameCount) < 1) {
		throw new RangeError('Browser-native image metadata dimensions and frame count must be positive integers.');
	}
	if (row.topology !== 'single' && row.topology !== 'animated') {
		throw new RangeError('Browser-native image topology is unsupported.');
	}
	if ((row.topology === 'single') !== (row.frameCount === 1)) {
		throw new RangeError('Browser-native image topology and frame count disagree.');
	}
	if (typeof row.runtimeVersion !== 'string' || !row.runtimeVersion || row.runtimeVersion.length > 128) {
		throw new TypeError('Browser-native image runtime version must be bounded text.');
	}
	return Object.freeze({
		width: Number(row.width), height: Number(row.height), frameCount: Number(row.frameCount),
		topology: row.topology, runtimeVersion: row.runtimeVersion,
	});
}

function normalizedRgba(value: unknown, width: number, height: number, index: number): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength !== width * height * 4) {
		throw new RangeError(`Browser-native image frame ${String(index)} has an invalid RGBA extent.`);
	}
	const output = value.slice();
	for (let offset = 0; offset < output.byteLength; offset += 4) {
		if (output[offset + 3] !== 0) continue;
		output[offset] = 0; output[offset + 1] = 0; output[offset + 2] = 0;
	}
	return output;
}

function positiveDuration(value: unknown): number | null {
	return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function safeNumber(value: bigint, name: string): number {
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${name} exceeds safe integers.`);
	return Number(value);
}

function cancelled(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('Image decode was cancelled.', 'AbortError');
}
