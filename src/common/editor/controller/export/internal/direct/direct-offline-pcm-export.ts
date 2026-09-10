/* SPDX-License-Identifier: AGPL-3.0-only */

import { isDirectOfflineAudioMixPlan } from './direct-audio-render-plan.ts';
import {
	createDirectPcmEncoder,
	DIRECT_PCM_RENDER_CHUNK_FRAMES,
	type DirectPcmContainerEncoder,
	type DirectPcmDestination,
} from './direct-pcm-export.ts';

interface DirectOfflinePcmPlan extends Readonly<Record<string, unknown>> {
	readonly channelCount: number;
	readonly format: string;
	readonly mimeType: string;
	readonly outputFileBytesPerRender: number;
	readonly outputFrames: number;
}

export interface DirectOfflinePcmEncodedOutput extends Readonly<Record<string, unknown>> {
	readonly blob: null;
	readonly byteLength: number;
	readonly bytes: null;
	readonly directDestination: DirectPcmDestination;
	readonly mimeType: string;
}

export interface EncodeDirectOfflinePcmOptions {
	readonly assertCurrent: () => void;
	readonly channels: readonly Float32Array[];
	readonly createEncoder: (
		options: Readonly<Record<string, unknown>>,
	) => DirectPcmContainerEncoder;
	readonly destination: DirectPcmDestination;
	readonly encoderOptions: Readonly<Record<string, unknown>>;
	readonly plan: unknown;
	readonly signal: AbortSignal;
}

/** Drain an admitted offline render without assembling encoded bytes in memory. */
export async function encodeDirectOfflinePcm(
	options: EncodeDirectOfflinePcmOptions,
): Promise<DirectOfflinePcmEncodedOutput> {
	const plan = exactOfflinePcmPlan(options.plan);
	assertRenderedGeometry(options.channels, plan);
	const assertActive = (): void => {
		throwIfAborted(options.signal);
		options.assertCurrent();
		if (!isDirectOfflineAudioMixPlan(plan)) {
			throw new Error('The admitted offline PCM render plan changed during encoding.');
		}
	};

	assertActive();
	const encoder = await createDirectPcmEncoder(
		options.destination,
		options.createEncoder,
		options.encoderOptions,
		containerLabel(plan.format),
	);
	assertActive();
	for (let offset = 0; offset < plan.outputFrames; offset += DIRECT_PCM_RENDER_CHUNK_FRAMES) {
		const end = Math.min(plan.outputFrames, offset + DIRECT_PCM_RENDER_CHUNK_FRAMES);
		const block = options.channels.map((channel) => channel.subarray(offset, end));
		assertActive();
		await encoder.write(block);
		assertActive();
	}
	assertActive();
	const byteLength = await encoder.finalize();
	assertActive();
	if (byteLength !== plan.outputFileBytesPerRender) {
		throw new Error('The offline PCM encoder byte count does not match its planned file size.');
	}
	if (options.destination.bytesWritten() !== plan.outputFileBytesPerRender) {
		throw new Error('The offline PCM destination byte count does not match its planned file size.');
	}
	return Object.freeze({
		blob: null,
		bytes: null,
		byteLength,
		directDestination: options.destination,
		mimeType: plan.mimeType,
	});
}

function exactOfflinePcmPlan(value: unknown): DirectOfflinePcmPlan {
	if (!isDirectOfflineAudioMixPlan(value) || !value || typeof value !== 'object') {
		throw new TypeError('The offline PCM render plan is not centrally admitted.');
	}
	const plan = value as DirectOfflinePcmPlan;
	const mimeType = plan.format === 'aiff' ? 'audio/aiff' : 'audio/wav';
	if (!['aiff', 'bwf', 'bw64', 'wav'].includes(plan.format)
		|| plan.mimeType !== mimeType
		|| !Number.isSafeInteger(plan.outputFileBytesPerRender)
		|| plan.outputFileBytesPerRender <= 0) {
		throw new TypeError('The offline PCM render plan has invalid container geometry.');
	}
	return plan;
}

function assertRenderedGeometry(
	channels: readonly Float32Array[],
	plan: DirectOfflinePcmPlan,
): void {
	if (!Array.isArray(channels) || channels.length !== plan.channelCount) {
		throw new RangeError('The offline PCM render channel count does not match its plan.');
	}
	for (const channel of channels) {
		if (!(channel instanceof Float32Array) || channel.length !== plan.outputFrames) {
			throw new RangeError('The offline PCM render channel frame count does not match its plan.');
		}
	}
}

function containerLabel(format: string): string {
	return format === 'aiff' ? 'AIFF' : format.toUpperCase();
}

function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('The offline PCM export was cancelled.', 'AbortError');
}
