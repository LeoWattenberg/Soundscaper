/* SPDX-License-Identifier: AGPL-3.0-only */

type PlanarPcm = readonly Float32Array[];

interface StreamingResampler {
	push(channels: PlanarPcm): PlanarPcm;
	finish(outputFrames: number): PlanarPcm;
}

interface ChannelMapping {
	readonly inputChannelCount?: unknown;
	readonly outputChannelCount?: unknown;
	readonly channels?: unknown;
}

export interface RealtimeExportPcmTransform {
	push(channels: PlanarPcm): PlanarPcm;
	finish(outputFrames: number): PlanarPcm;
}

export function createRealtimeExportPcmTransform(options: Readonly<{
	inputChannelCount: number;
	inputSampleRate: number;
	outputChannelCount: number;
	outputSampleRate: number;
	channelMapping: unknown;
	optimizeSelectionUpmix?: boolean;
	applyChannelMapping(channels: PlanarPcm, mapping: unknown): PlanarPcm;
	createResampler(inputSampleRate: number, outputSampleRate: number, channelCount: number): StreamingResampler;
}>): RealtimeExportPcmTransform {
	const inputChannelCount = channelCount(options.inputChannelCount, 'input');
	const outputChannelCount = channelCount(options.outputChannelCount, 'output');
	const inputSampleRate = sampleRate(options.inputSampleRate, 'input');
	const outputSampleRate = sampleRate(options.outputSampleRate, 'output');
	if (typeof options.applyChannelMapping !== 'function' || typeof options.createResampler !== 'function') {
		throw new TypeError('Direct WAV PCM transform dependencies are required.');
	}
	const mapAfterResampling = options.optimizeSelectionUpmix === true && selectionOnlyUpmix(
		options.channelMapping, inputChannelCount, outputChannelCount,
	);
	const resampler = options.createResampler(
		inputSampleRate,
		outputSampleRate,
		mapAfterResampling ? inputChannelCount : outputChannelCount,
	);
	if (!resampler || typeof resampler.push !== 'function' || typeof resampler.finish !== 'function') {
		throw new TypeError('Direct WAV PCM transform requires a streaming resampler.');
	}
	const mapBefore = (channels: PlanarPcm): PlanarPcm => mapAfterResampling
		? channels
		: options.applyChannelMapping(channels, options.channelMapping);
	const mapAfter = (channels: PlanarPcm): PlanarPcm => mapAfterResampling
		? options.applyChannelMapping(channels, options.channelMapping)
		: channels;
	return Object.freeze({
		push(channels: PlanarPcm): PlanarPcm {
			assertPlanarPcm(channels, inputChannelCount, 'input');
			return mapAfter(resampler.push(mapBefore(channels)));
		},
		finish(outputFrames: number): PlanarPcm {
			if (!Number.isSafeInteger(outputFrames) || outputFrames < 1) {
				throw new RangeError('Direct WAV output frame count must be a positive safe integer.');
			}
			return mapAfter(resampler.finish(outputFrames));
		},
	});
}

function selectionOnlyUpmix(mapping: unknown, inputChannelCount: number, outputChannelCount: number): boolean {
	if (outputChannelCount <= inputChannelCount || !mapping || typeof mapping !== 'object') return false;
	const value = mapping as ChannelMapping;
	if (value.inputChannelCount !== inputChannelCount || value.outputChannelCount !== outputChannelCount
		|| !Array.isArray(value.channels) || value.channels.length !== outputChannelCount) return false;
	return value.channels.every((output) => {
		if (!output || typeof output !== 'object') return false;
		const inputs = (output as Readonly<{ inputs?: unknown }>).inputs;
		if (!Array.isArray(inputs) || inputs.length !== 1) return false;
		const selected = inputs[0] as Readonly<{ channel?: unknown; gain?: unknown }> | null;
		return Boolean(selected
			&& Number.isSafeInteger(selected.channel)
			&& Number(selected.channel) >= 0
			&& Number(selected.channel) < inputChannelCount
			&& selected.gain === 1);
	});
}

function assertPlanarPcm(channels: PlanarPcm, expectedChannels: number, label: string): void {
	if (!Array.isArray(channels) || channels.length !== expectedChannels
		|| channels.some((channel) => !(channel instanceof Float32Array))) {
		throw new TypeError(`Direct WAV ${label} PCM channel geometry is invalid.`);
	}
	const frameCount = channels[0]?.length ?? 0;
	if (channels.some((channel) => channel.length !== frameCount)) {
		throw new RangeError(`Direct WAV ${label} PCM frame geometry is invalid.`);
	}
}

function channelCount(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
		throw new RangeError(`Direct WAV ${label} channel count must be an integer from 1 to 32.`);
	}
	return value;
}

function sampleRate(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 8_000 || value > 384_000) {
		throw new RangeError(`Direct WAV ${label} sample rate must be an integer from 8000 to 384000.`);
	}
	return value;
}
