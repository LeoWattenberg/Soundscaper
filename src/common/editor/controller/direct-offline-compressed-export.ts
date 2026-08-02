/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	encodeDirectCompressedStagedFile,
	type DirectCompressedDestination,
	type DirectCompressedEncodeOptions,
	type DirectCompressedEncodedOutput,
	type DirectCompressedFormat,
	type DirectCompressedPlan,
} from './direct-compressed-export.ts';
import { captureDirectCompressedContract } from './direct-compressed-plan.ts';

interface OfflineCompressedEncoding extends Readonly<Record<string, unknown>> {
	readonly bitDepth: number | null;
	readonly inputChannelCount: number;
	readonly sampleFormat: string | null;
}

interface OfflineCompressedPlan extends DirectCompressedPlan {
	readonly ditherMode: string;
	readonly encoding: OfflineCompressedEncoding;
	readonly format: DirectCompressedFormat;
	readonly mimeType: string;
	readonly outputFrames: number;
	readonly sampleRate: number;
}

export interface EncodeDirectOfflineCompressedOptions {
	readonly assertCurrent: () => void;
	readonly channels: readonly Float32Array[];
	readonly destination: DirectCompressedDestination;
	readonly encodeWav: (
		channels: readonly Float32Array[],
		settings: Readonly<Record<string, unknown>>,
	) => Uint8Array;
	readonly ffmpeg: DirectCompressedEncodeOptions['ffmpeg'];
	readonly onEncoding: () => void;
	readonly plan: DirectCompressedPlan;
	readonly signal: AbortSignal;
}

/** Stage one admitted offline render at input width, then stream FFmpeg output to its target. */
export async function encodeDirectOfflineCompressed(
	options: EncodeDirectOfflineCompressedOptions,
): Promise<DirectCompressedEncodedOutput> {
	const { assertCurrent, encodeWav, onEncoding } = options;
	const plan = exactOfflineCompressedPlan(options.plan);
	const assertActive = (): void => {
		throwIfAborted(options.signal);
		assertCurrent();
		if (captureDirectCompressedContract(plan)?.renderStrategy !== 'offline') {
			throw new Error('The admitted offline compressed render plan changed during encoding.');
		}
	};
	assertActive();
	assertRenderedGeometry(options.channels, plan);
	const bitDepth = plan.encoding.bitDepth ?? 24;
	const stagingFloat = plan.format !== 'flac';
	let encodedBytes: Uint8Array | null = encodeWav(options.channels, {
		sampleRate: plan.sampleRate,
		bitDepth: stagingFloat ? 32 : Math.min(24, bitDepth),
		float: stagingFloat,
		dither: stagingFloat ? 'none' : plan.ditherMode,
	});
	if (!(encodedBytes instanceof Uint8Array) || encodedBytes.byteLength === 0) {
		throw new TypeError('The offline compressed WAV staging encoder returned invalid bytes.');
	}
	assertActive();
	let stagedBytes: Uint8Array<ArrayBuffer> | null;
	if (encodedBytes.buffer instanceof ArrayBuffer) {
		stagedBytes = new Uint8Array(encodedBytes.buffer, encodedBytes.byteOffset, encodedBytes.byteLength);
	} else {
		stagedBytes = new Uint8Array(encodedBytes.byteLength);
		stagedBytes.set(encodedBytes);
	}
	encodedBytes = null;
	let stagedFile: Blob | null = new Blob([stagedBytes], { type: 'audio/wav' });
	stagedBytes = null;
	assertActive();
	onEncoding();
	return encodeDirectCompressedStagedFile({
		assertCurrent,
		cleanupStagedFile() {
			stagedFile = null;
			stagedBytes = null;
		},
		destination: options.destination,
		encodingSettings: {
			...plan.encoding,
			bitDepth,
			sampleRate: plan.sampleRate,
			applyDither: plan.encoding.sampleFormat !== 'float32'
				&& plan.ditherMode !== 'none'
				&& plan.format !== 'flac',
		},
		ffmpeg: options.ffmpeg,
		plan,
		signal: options.signal,
		stagedFile,
	});
}

function exactOfflineCompressedPlan(value: DirectCompressedPlan): OfflineCompressedPlan {
	const contract = captureDirectCompressedContract(value);
	if (!contract || contract.renderStrategy !== 'offline'
		|| !value.encoding || typeof value.encoding !== 'object'
		|| !Number.isSafeInteger(value.encoding.inputChannelCount)
		|| Number(value.encoding.inputChannelCount) < 1
		|| !Number.isSafeInteger(value.outputFrames)
		|| Number(value.outputFrames) < 1
		|| !Number.isSafeInteger(value.sampleRate)
		|| Number(value.sampleRate) < 1) {
		throw new TypeError('The offline compressed render plan is not centrally admitted.');
	}
	return value as OfflineCompressedPlan;
}

function assertRenderedGeometry(
	channels: readonly Float32Array[],
	plan: OfflineCompressedPlan,
): void {
	if (!Array.isArray(channels) || channels.length !== plan.encoding.inputChannelCount) {
		throw new RangeError('The offline compressed render channel count does not match its input-width plan.');
	}
	for (const channel of channels) {
		if (!(channel instanceof Float32Array) || channel.length !== plan.outputFrames) {
			throw new RangeError('The offline compressed render channel frame count does not match its plan.');
		}
	}
}

function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('The offline compressed export was cancelled.', 'AbortError');
}
