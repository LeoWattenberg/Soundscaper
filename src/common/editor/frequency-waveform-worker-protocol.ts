/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FrequencyWaveformAnalyzer,
	generateFrequencyWaveformWindowWithFft,
	type GenerateFrequencyWaveformWindowOptions,
	type FrequencyWaveformAnalyzerOptions,
	type FrequencyWaveformFft,
} from './frequency-waveform-analysis.ts';
import type { FrequencyWaveformAnalysis, FrequencyWaveformWindow } from './frequency-waveform-contract.ts';
import { fft, initializePffft } from './pffft.js';

export type FrequencyWaveformWorkerRequest = Readonly<{
	readonly type: 'start';
	readonly options: FrequencyWaveformAnalyzerOptions;
}> | Readonly<{
	readonly type: 'chunk';
	readonly channels: readonly ArrayBuffer[];
}> | Readonly<{
	readonly type: 'finish';
}> | Readonly<{
	readonly type: 'window';
	readonly channels: readonly ArrayBuffer[];
	readonly sampleRate: number;
	readonly options: GenerateFrequencyWaveformWindowOptions;
}>;

export type FrequencyWaveformWorkerResponse = Readonly<{
	readonly type: 'ready' | 'ack';
}> | Readonly<{
	readonly type: 'result';
	readonly result: FrequencyWaveformAnalysis;
}> | Readonly<{
	readonly type: 'window-result';
	readonly result: FrequencyWaveformWindow;
}> | Readonly<{
	readonly type: 'error';
	readonly message: string;
}>;

export interface FrequencyWaveformWorkerHost {
	postMessage(message: FrequencyWaveformWorkerResponse, transfer?: Transferable[]): void;
}

export type PrepareFrequencyWaveformFft = () => Promise<FrequencyWaveformFft>;

export function createFrequencyWaveformWorkerProtocol(
	host: FrequencyWaveformWorkerHost,
	prepareTransform: PrepareFrequencyWaveformFft = preparePffftTransform,
): (request: FrequencyWaveformWorkerRequest) => Promise<void> {
	let analyzer: FrequencyWaveformAnalyzer | null = null;
	return async (request): Promise<void> => {
		if (request.type === 'window') {
			if (analyzer) throw new Error('Frequency waveform analysis is already started.');
			const result = generateFrequencyWaveformWindowWithFft(
				request.channels.map((channel) => new Float32Array(channel)),
				request.sampleRate,
				request.options,
				await prepareTransform(),
			);
			host.postMessage({ type: 'window-result', result }, frequencyWaveformWindowTransferables(result));
			return;
		}
		if (request.type === 'start') {
			if (analyzer) throw new Error('Frequency waveform analysis is already started.');
			analyzer = new FrequencyWaveformAnalyzer(request.options, await prepareTransform());
			host.postMessage({ type: 'ready' });
			return;
		}
		if (!analyzer) throw new Error('Frequency waveform analysis is not started.');
		if (request.type === 'chunk') {
			analyzer.push(request.channels.map((channel) => new Float32Array(channel)));
			host.postMessage({ type: 'ack' });
			return;
		}
		if (request.type === 'finish') {
			const result = analyzer.finish();
			analyzer = null;
			host.postMessage({ type: 'result', result }, frequencyWaveformTransferables(result));
			return;
		}
		throw new TypeError('Unsupported frequency waveform worker request.');
	};
}

export function frequencyWaveformTransferables(analysis: FrequencyWaveformAnalysis): Transferable[] {
	return analysis.levels.flatMap((level) => [
		...(['low', 'mid', 'high'] as const).flatMap((band) => level.bands[band]
			.flatMap((channel) => [channel.minimums.buffer, channel.maximums.buffer])),
		level.centroid.numerators.buffer,
		level.centroid.weights.buffer,
	]) as Transferable[];
}

export function frequencyWaveformWindowTransferables(window: FrequencyWaveformWindow): Transferable[] {
	return [
		...(['low', 'mid', 'high'] as const).flatMap((band) => window.bands[band]
			.map((channel) => channel.buffer)),
		window.centroid.numerators.buffer,
		window.centroid.weights.buffer,
	] as Transferable[];
}

async function preparePffftTransform(): Promise<FrequencyWaveformFft> {
	await initializePffft();
	return fft as FrequencyWaveformFft;
}
