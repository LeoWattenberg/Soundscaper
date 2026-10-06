/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_ENCODING_RAW_F32LE,
	PCM_ENCODING_WAVPACK_F32_V1,
	PcmStorageCorruptionError,
	WavPackCodecClient,
	crc32,
	exactArrayBuffer,
	minimumWavPackSavings,
	maximumWavPackPayloadBytes,
	pcmRawByteLength,
	unpackOwnedPlanarFloat32,
	unpackPlanarFloat32,
} from '../wavpack/index.js';
import {
	sourceChunkFromLegacyRecord,
	type StorageRecord,
} from './media-records.ts';
import type { AudioEditorOptimizationMode } from '../performance-preferences.ts';

interface CodecResult {
	readonly encoding?: unknown;
	readonly payload?: unknown;
	readonly pcmCrc32?: unknown;
}

interface PcmCodec {
	encode(input: ArrayBuffer, options: Record<string, unknown>): Promise<CodecResult>;
	decode(input: ArrayBuffer, options: Record<string, unknown>): Promise<CodecResult>;
	close?(): void;
}

interface EncodedPcm {
	readonly encoding: string;
	readonly payload: ArrayBuffer;
	readonly pcmCrc32: number;
	readonly uncompressedBytes: number;
	readonly storedBytes: number;
}

interface DecodedPcmChunk {
	readonly index: number;
	readonly frames: number;
	readonly channels: readonly Float32Array[];
}

export interface PcmRepositoryOptions {
	readonly codec?: PcmCodec | null;
	readonly codecFactory?: (() => PcmCodec) | null;
}

/** Lossless PCM encoding and record validation boundary. */
export class PcmRepository {
	#codec: PcmCodec | null;
	readonly #codecFactory: () => PcmCodec;
	readonly #ownsCodec: boolean;
	#circuitOpen = false;
	#optimizationMode: AudioEditorOptimizationMode = 'memory';
	#checksumUnavailable = false;

	constructor({ codec = null, codecFactory = null }: PcmRepositoryOptions = {}) {
		this.#codec = codec;
		this.#codecFactory = codecFactory || (() => new WavPackCodecClient() as PcmCodec);
		this.#ownsCodec = !codec;
	}

	setOptimizationMode(mode: AudioEditorOptimizationMode): void {
		if (mode !== 'memory' && mode !== 'speed') throw new RangeError('PCM optimization mode must be memory or speed.');
		this.#optimizationMode = mode;
	}

	async encode(rawInput: unknown, {
		frames,
		channelCount,
		sampleRate,
		priority,
		signal,
		allowRawOnFailure,
		requireWavPack = false,
	}: {
		readonly frames: number;
		readonly channelCount: number;
		readonly sampleRate: number;
		readonly priority: string;
		readonly signal?: AbortSignal;
		readonly allowRawOnFailure: boolean;
		readonly requireWavPack?: boolean;
	}): Promise<EncodedPcm> {
		const rawPayload = exactBuffer(rawInput);
		const rawBytes = pcmRawByteLength(frames, channelCount);
		if (rawPayload.byteLength !== rawBytes) {
			throw new RangeError('Raw PCM payload does not match its declared geometry.');
		}
		if (!requireWavPack && (rawBytes <= minimumWavPackSavings(rawBytes)
			|| (this.#optimizationMode === 'speed' && priority !== 'migration'))) {
			const checked = await this.#checksum(rawPayload, { frames, channelCount, sampleRate, priority, signal });
			return rawEncodedPcm(checked.payload, checked.pcmCrc32);
		}
		const pcmCrc32 = crc32(rawPayload);
		const rawResult = (): EncodedPcm => rawEncodedPcm(rawPayload, pcmCrc32);
		if (this.#circuitOpen) {
			if (allowRawOnFailure && !requireWavPack) return rawResult();
			throw new Error('WavPack encoding is disabled for this session after a codec failure.');
		}
		try {
			const codecInput = rawPayload.slice(0);
			const encoded = await this.#codecInstance().encode(codecInput, {
				frames,
				channelCount,
				sampleRate,
				priority,
				signal,
				transferInput: true,
				requireWavPack,
			});
			const encoding = encoded?.encoding;
			const payload = exactBuffer(encoded?.payload);
			const resultCrc32 = Number(encoded?.pcmCrc32 ?? pcmCrc32) >>> 0;
			if (resultCrc32 !== pcmCrc32) throw new Error('PCM codec returned an unexpected source CRC-32.');
			if (encoding === PCM_ENCODING_WAVPACK_F32_V1) {
				const minimumSavings = minimumWavPackSavings(rawBytes);
				const maximumPayloadBytes = requireWavPack ? maximumWavPackPayloadBytes(frames, channelCount) : rawBytes - minimumSavings;
				if (!payload.byteLength || payload.byteLength > maximumPayloadBytes) {
					if (requireWavPack) throw new RangeError('Required WavPack payload exceeds its PCM packet capacity.');
					return rawResult();
				}
				if (requireWavPack) {
					const decoded = await this.#codecInstance().decode(payload.slice(0), {
						encoding, frames, channelCount, sampleRate, pcmCrc32, priority, signal, transferInput: true,
					});
					const verified = exactBuffer(decoded?.payload);
					const expectedBits = new Uint8Array(rawPayload), actualBits = new Uint8Array(verified);
					if (verified.byteLength !== rawBytes || expectedBits.some((byte, index) => byte !== actualBits[index])) {
						throw new Error('Required WavPack PCM did not preserve its exact source sample bits.');
					}
					throwIfAborted(signal);
				}
				return {
					encoding,
					payload,
					pcmCrc32,
					uncompressedBytes: rawBytes,
					storedBytes: payload.byteLength,
				};
			}
			if (encoding === PCM_ENCODING_RAW_F32LE) {
				if (requireWavPack) throw new Error('Required WavPack encoding returned a raw fallback.');
				if (payload.byteLength !== rawBytes || crc32(payload) !== pcmCrc32) {
					throw new Error('PCM codec returned invalid raw fallback data.');
				}
				return {
					encoding,
					payload,
					pcmCrc32,
					uncompressedBytes: rawBytes,
					storedBytes: rawBytes,
				};
			}
			throw new Error(`PCM codec returned unsupported encoding ${String(encoding)}.`);
		} catch (error) {
			if (isAbortError(error)) throw error;
			this.#circuitOpen = true;
			if (allowRawOnFailure && !requireWavPack) return rawResult();
			throw error;
		}
	}

	async decodeRecord(
		record: Record<string, unknown>,
		source: StorageRecord,
		signal?: AbortSignal,
		priority = 'foreground',
	): Promise<DecodedPcmChunk> {
		throwIfAborted(signal);
		if (Array.isArray(record?.channels)) return sourceChunkFromLegacyRecord(record);
		let frames: number;
		let channelCount: number;
		let rawBytes: number;
		let payload: ArrayBuffer;
		let expectedCrc32: number;
		try {
			frames = Number(record?.frames);
			channelCount = Number(source?.channelCount);
			rawBytes = pcmRawByteLength(frames, channelCount);
			payload = exactBuffer(record?.payload);
			expectedCrc32 = Number(record?.pcmCrc32);
			if (!Number.isSafeInteger(expectedCrc32) || expectedCrc32 < 0 || expectedCrc32 > 0xffffffff) {
				throw new RangeError('PCM CRC-32 is outside its unsigned 32-bit range.');
			}
		} catch (error) {
			throw new PcmStorageCorruptionError(
				'Persisted PCM record has invalid geometry.',
				'PCM_RECORD_GEOMETRY',
				{ cause: error },
			);
		}
		let rawPayload: ArrayBuffer;
		let ownsDecodedPayload: boolean;
		if (record.encoding === PCM_ENCODING_RAW_F32LE) {
			if (payload.byteLength !== rawBytes) {
				throw new PcmStorageCorruptionError('Raw persisted PCM has invalid geometry.', 'PCM_RECORD_GEOMETRY');
			}
			const checked = await this.#checksum(payload, {
				frames, channelCount, sampleRate: Number(source.sampleRate) || 48_000,
				priority, signal, pcmCrc32: expectedCrc32,
			});
			rawPayload = checked.payload;
			ownsDecodedPayload = checked.owned;
		} else if (record.encoding === PCM_ENCODING_WAVPACK_F32_V1) {
			if (!payload.byteLength || payload.byteLength > maximumWavPackPayloadBytes(frames, channelCount)) {
				throw new PcmStorageCorruptionError(
					'Persisted WavPack PCM has invalid bounded geometry.',
					'PCM_RECORD_GEOMETRY',
				);
			}
			try {
				const decoded = await this.#codecInstance().decode(payload, {
					encoding: record.encoding,
					frames,
					channelCount,
					sampleRate: source.sampleRate || 48_000,
					pcmCrc32: expectedCrc32,
					priority,
					signal,
					transferInput: true,
				});
				rawPayload = exactBuffer(decoded?.payload);
			} catch (error) {
				if (isAbortError(error)) throw error;
				throw new PcmStorageCorruptionError(
					'Persisted WavPack PCM could not be decoded losslessly.',
					errorCode(error) || 'PCM_WAVPACK_DECODE',
					{ cause: error },
				);
			}
			if (rawPayload.byteLength !== rawBytes) {
				throw new PcmStorageCorruptionError(
					'Decoded WavPack PCM failed its geometry or CRC-32.',
					'PCM_CRC_MISMATCH',
				);
			}
			const checked = await this.#checksum(rawPayload, {
				frames, channelCount, sampleRate: Number(source.sampleRate) || 48_000,
				priority, signal, pcmCrc32: expectedCrc32,
			});
			rawPayload = checked.payload;
			ownsDecodedPayload = checked.owned;
		} else {
			throw new PcmStorageCorruptionError(
				`Persisted PCM uses unsupported encoding ${String(record.encoding)}.`,
				'PCM_RECORD_ENCODING',
			);
		}
		throwIfAborted(signal);
		return {
			index: record.index as number,
			frames,
			channels: ownsDecodedPayload ? unpackOwnedPlanarFloat32(rawPayload, frames, channelCount)
				: unpackPlanarFloat32(rawPayload, frames, channelCount),
		};
	}

	closeOwnedCodec(): void {
		if (!this.#ownsCodec) return;
		this.#codec?.close?.();
		this.#codec = null;
		this.#circuitOpen = false;
		this.#checksumUnavailable = false;
	}

	async #checksum(payload: ArrayBuffer, options: {
		readonly frames: number;
		readonly channelCount: number;
		readonly sampleRate: number;
		readonly priority: string;
		readonly signal?: AbortSignal;
		readonly pcmCrc32?: number;
	}): Promise<{ readonly payload: ArrayBuffer; readonly pcmCrc32: number; readonly owned: boolean }> {
		throwIfAborted(options.signal);
		if (payload.byteLength > 4_096 && !this.#checksumUnavailable
			&& (this.#codec instanceof WavPackCodecClient || (this.#ownsCodec && typeof Worker === 'function'))) {
			try {
				const codec = this.#codecInstance();
				if (codec instanceof WavPackCodecClient) {
					const result = await codec.checksum(payload, options) as CodecResult;
					const checked = exactBuffer(result.payload);
					const checksum = Number(result.pcmCrc32);
					if (checked.byteLength !== payload.byteLength || checked === payload
						|| !Number.isSafeInteger(checksum) || checksum < 0 || checksum > 0xffffffff
						|| options.pcmCrc32 !== undefined && checksum !== options.pcmCrc32) {
						throw new Error('The PCM checksum worker returned an invalid result.');
					}
					throwIfAborted(options.signal);
					return { payload: checked, pcmCrc32: checksum, owned: true };
				}
			} catch (error) {
				if (isAbortError(error)) throw error;
				this.#checksumUnavailable = true;
			}
		}
		throwIfAborted(options.signal);
		const checksum = crc32(payload);
		if (options.pcmCrc32 !== undefined && checksum !== options.pcmCrc32) {
			throw new PcmStorageCorruptionError('Raw persisted PCM failed its CRC-32.', 'PCM_CRC_MISMATCH');
		}
		return { payload, pcmCrc32: checksum, owned: false };
	}

	#codecInstance(): PcmCodec {
		if (!this.#codec) this.#codec = this.#codecFactory();
		if (!this.#codec?.encode || !this.#codec?.decode) {
			throw new TypeError('pcmCodec must provide encode() and decode() methods.');
		}
		return this.#codec;
	}
}

function rawEncodedPcm(payload: ArrayBuffer, pcmCrc32: number): EncodedPcm {
	return {
		encoding: PCM_ENCODING_RAW_F32LE, payload, pcmCrc32,
		uncompressedBytes: payload.byteLength, storedBytes: payload.byteLength,
	};
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	const error = new Error('Audio source loading was cancelled.');
	error.name = 'AbortError';
	throw error;
}

function isAbortError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

function errorCode(error: unknown): string | null {
	if (!error || typeof error !== 'object' || !('code' in error)) return null;
	return typeof error.code === 'string' ? error.code : null;
}

function exactBuffer(input: unknown): ArrayBuffer {
	return exactArrayBuffer(input) as ArrayBuffer;
}
