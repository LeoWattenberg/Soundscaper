/* SPDX-License-Identifier: AGPL-3.0-only */

import { LegacyAupError } from './aup-legacy-xml.ts';

const MIB = 1024 * 1024;
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const AU_HEADER_BYTES = 24;

export interface LegacyAupBlockLimits {
	readonly maximumSelectedFiles: number;
	readonly maximumBlockReferences: number;
	readonly maximumBlockFileBytes: number;
	readonly maximumBlockPayloadBytes: number;
	readonly maximumBlockFrames: number;
	readonly maximumSelectedBlockBytes: number;
	readonly maximumRetainedPcmBytes: number;
}

export const LEGACY_AUP_BLOCK_HARD_LIMITS: Readonly<LegacyAupBlockLimits> = Object.freeze({
	maximumSelectedFiles: 65_536,
	maximumBlockReferences: 65_536,
	maximumBlockFileBytes: 2 * MIB,
	maximumBlockPayloadBytes: MIB,
	maximumBlockFrames: 524_288,
	maximumSelectedBlockBytes: 512 * MIB,
	maximumRetainedPcmBytes: 512 * MIB,
});

export function resolveLegacyAupBlockLimits(
	overrides: Partial<LegacyAupBlockLimits> = {},
): Readonly<LegacyAupBlockLimits> {
	if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
		throw new TypeError('Legacy AUP block limits must be an object.');
	}
	for (const name of Object.keys(overrides)) {
		if (!Object.hasOwn(LEGACY_AUP_BLOCK_HARD_LIMITS, name)) {
			throw new TypeError(`Unsupported legacy AUP block limit: ${name}.`);
		}
	}
	const limits = { ...LEGACY_AUP_BLOCK_HARD_LIMITS, ...overrides };
	for (const name of Object.keys(LEGACY_AUP_BLOCK_HARD_LIMITS) as (keyof LegacyAupBlockLimits)[]) {
		const value = limits[name];
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError(`Legacy AUP ${name} must be a positive safe integer.`);
		}
		if (value > LEGACY_AUP_BLOCK_HARD_LIMITS[name]) {
			throw new RangeError(`Legacy AUP ${name} cannot exceed its hard limit.`);
		}
	}
	return Object.freeze(limits);
}

/** Checked counters shared by admission and allocation across one legacy project. */
export class LegacyAupBlockBudget {
	readonly limits: Readonly<LegacyAupBlockLimits>;
	#selectedFiles = 0;
	#blockReferences = 0;
	#selectedBlockBytes = 0;
	#retainedPcmBytes = 0;

	constructor(limits: Partial<LegacyAupBlockLimits> = {}) {
		this.limits = resolveLegacyAupBlockLimits(limits);
	}

	get selectedFiles(): number {
		return this.#selectedFiles;
	}

	get blockReferences(): number {
		return this.#blockReferences;
	}

	get selectedBlockBytes(): number {
		return this.#selectedBlockBytes;
	}

	get retainedPcmBytes(): number {
		return this.#retainedPcmBytes;
	}

	admitSelectedFile(): void {
		const observed = this.#selectedFiles + 1;
		if (observed > this.limits.maximumSelectedFiles) {
			throw limitError(
				'Too many files were selected with the legacy AUP project.',
				'PROJECT_BLOCK_FILE_COUNT_LIMIT',
				'maximumSelectedFiles',
				this.limits.maximumSelectedFiles,
				observed,
			);
		}
		this.#selectedFiles = observed;
	}

	admitReference(frameCount: number): void {
		assertFrameCount(frameCount);
		const observedReferences = this.#blockReferences + 1;
		if (observedReferences > this.limits.maximumBlockReferences) {
			throw limitError(
				'The legacy AUP project references too many audio blocks.',
				'PROJECT_BLOCK_REFERENCE_LIMIT',
				'maximumBlockReferences',
				this.limits.maximumBlockReferences,
				observedReferences,
			);
		}
		if (frameCount > this.limits.maximumBlockFrames) {
			throw limitError(
				'A legacy AUP audio block exceeds its frame limit.',
				'PROJECT_BLOCK_FRAME_LIMIT',
				'maximumBlockFrames',
				this.limits.maximumBlockFrames,
				frameCount,
			);
		}
		this.#blockReferences = observedReferences;
		this.#admitPcmFrames(frameCount);
	}

	admitStereoPadding(frameCount: number): void {
		assertFrameCount(frameCount);
		this.#admitPcmFrames(frameCount);
	}

	admitReferencedFile(filename: string, size: unknown): void {
		if (!Number.isSafeInteger(size) || (size as number) < 0) {
			throw new LegacyAupError(
				`${filename} has an invalid declared size.`,
				'INVALID_BLOCK_FILE_SIZE',
				{ filename, observed: size },
			);
		}
		const byteLength = size as number;
		if (byteLength > this.limits.maximumBlockFileBytes) {
			throw limitError(
				`${filename} exceeds the legacy AUP block-file byte limit.`,
				'PROJECT_BLOCK_FILE_TOO_LARGE',
				'maximumBlockFileBytes',
				this.limits.maximumBlockFileBytes,
				byteLength,
				{ filename },
			);
		}
		if (byteLength < AU_HEADER_BYTES) {
			throw new LegacyAupError(
				`${filename} is shorter than an AU block header.`,
				'CORRUPT_BLOCK_FILE',
				{ filename, observed: byteLength, minimum: AU_HEADER_BYTES },
			);
		}
		if (byteLength > this.limits.maximumSelectedBlockBytes - this.#selectedBlockBytes) {
			throw limitError(
				'The selected legacy AUP block files exceed their aggregate byte limit.',
				'PROJECT_BLOCK_BYTES_LIMIT',
				'maximumSelectedBlockBytes',
				this.limits.maximumSelectedBlockBytes,
				this.#selectedBlockBytes + byteLength,
				{ filename },
			);
		}
		this.#selectedBlockBytes += byteLength;
	}

	assertActualFileSize(filename: string, declaredSize: number, actualSize: number): void {
		if (actualSize !== declaredSize) {
			throw new LegacyAupError(
				`${filename} did not return its authoritative declared byte length.`,
				'PROJECT_BLOCK_SIZE_MISMATCH',
				{ filename, declared: declaredSize, observed: actualSize },
			);
		}
	}

	#admitPcmFrames(frameCount: number): void {
		const availableBytes = this.limits.maximumRetainedPcmBytes - this.#retainedPcmBytes;
		if (frameCount > Math.floor(availableBytes / FLOAT32_BYTES)) {
			throw limitError(
				'The legacy AUP project exceeds its retained PCM byte limit.',
				'PROJECT_PCM_LIMIT',
				'maximumRetainedPcmBytes',
				this.limits.maximumRetainedPcmBytes,
				this.#retainedPcmBytes + frameCount * FLOAT32_BYTES,
			);
		}
		this.#retainedPcmBytes += frameCount * FLOAT32_BYTES;
	}
}

export function decodeAuBlockFile(
	bytes: unknown,
	overrides: Partial<LegacyAupBlockLimits> = {},
): Float32Array {
	const limits = resolveLegacyAupBlockLimits(overrides);
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < AU_HEADER_BYTES) {
		throw new LegacyAupError('Audacity AU block file is truncated.', 'CORRUPT_BLOCK_FILE');
	}
	if (bytes.byteLength > limits.maximumBlockFileBytes) {
		throw limitError(
			'Audacity AU block file exceeds its byte limit.',
			'PROJECT_BLOCK_FILE_TOO_LARGE',
			'maximumBlockFileBytes',
			limits.maximumBlockFileBytes,
			bytes.byteLength,
		);
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const magic = view.getUint32(0, false);
	const littleEndian = magic === 0x646e732e;
	if (magic !== 0x2e736e64 && !littleEndian) {
		throw new LegacyAupError('Audacity block file has no AU header.', 'CORRUPT_BLOCK_FILE');
	}
	const dataOffset = view.getUint32(4, littleEndian);
	const declaredBytes = view.getUint32(8, littleEndian);
	const encoding = view.getUint32(12, littleEndian);
	const sampleRate = view.getUint32(16, littleEndian);
	const channelCount = view.getUint32(20, littleEndian);
	if (dataOffset < AU_HEADER_BYTES || dataOffset > bytes.byteLength || channelCount !== 1
		|| sampleRate < 1 || sampleRate > 768_000) {
		throw new LegacyAupError('Audacity AU block header is invalid.', 'CORRUPT_BLOCK_FILE');
	}
	const bytesPerSample = bytesPerAuSample(encoding);
	const available = bytes.byteLength - dataOffset;
	const dataBytes = declaredBytes === 0xffff_ffff ? available : declaredBytes;
	if (dataBytes > available || dataBytes % bytesPerSample) {
		throw new LegacyAupError('Audacity AU block sample data is truncated.', 'CORRUPT_BLOCK_FILE');
	}
	if (dataBytes > limits.maximumBlockPayloadBytes) {
		throw limitError(
			'Audacity AU block sample payload exceeds its byte limit.',
			'PROJECT_BLOCK_DATA_TOO_LARGE',
			'maximumBlockPayloadBytes',
			limits.maximumBlockPayloadBytes,
			dataBytes,
		);
	}
	const frameCount = dataBytes / bytesPerSample;
	if (frameCount > limits.maximumBlockFrames) {
		throw limitError(
			'Audacity AU block sample payload exceeds its frame limit.',
			'PROJECT_BLOCK_FRAME_LIMIT',
			'maximumBlockFrames',
			limits.maximumBlockFrames,
			frameCount,
		);
	}
	const output = new Float32Array(frameCount);
	for (let index = 0, offset = dataOffset; index < output.length; index += 1, offset += bytesPerSample) {
		if (encoding === 3) output[index] = view.getInt16(offset, littleEndian) / 32_768;
		else if (encoding === 4) output[index] = signed24(view, offset, littleEndian) / 8_388_608;
		else if (encoding === 5) output[index] = view.getInt32(offset, littleEndian) / 2_147_483_648;
		else if (encoding === 6) output[index] = finite(view.getFloat32(offset, littleEndian));
		else output[index] = finite(view.getFloat64(offset, littleEndian));
	}
	return output;
}

function bytesPerAuSample(encoding: number): number {
	const byteLength = new Map([
		[3, 2],
		[4, 3],
		[5, 4],
		[6, 4],
		[7, 8],
	]).get(encoding);
	if (!byteLength) {
		throw new LegacyAupError(
			`Unsupported AU sample encoding: ${encoding}.`,
			'UNSUPPORTED_SAMPLE_FORMAT',
		);
	}
	return byteLength;
}

function assertFrameCount(frameCount: number): void {
	if (!Number.isSafeInteger(frameCount) || frameCount < 0) {
		throw new LegacyAupError('Legacy block length is invalid.', 'CORRUPT_BLOCK_FILE');
	}
}

function signed24(view: DataView, offset: number, littleEndian: boolean): number {
	const value = littleEndian
		? view.getUint8(offset) | view.getUint8(offset + 1) << 8 | view.getUint8(offset + 2) << 16
		: view.getUint8(offset) << 16 | view.getUint8(offset + 1) << 8 | view.getUint8(offset + 2);
	return value & 0x800000 ? value - 0x1000000 : value;
}

function finite(value: number): number {
	return Number.isFinite(value) ? value : 0;
}

function limitError(
	message: string,
	code: string,
	limit: keyof LegacyAupBlockLimits,
	maximum: number,
	observed: number,
	details: Readonly<Record<string, unknown>> = {},
): LegacyAupError {
	return new LegacyAupError(message, code, { ...details, limit, maximum, observed });
}
