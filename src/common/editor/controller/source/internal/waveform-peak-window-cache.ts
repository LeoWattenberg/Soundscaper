/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	SourceLifecycleWaveformPeakRequest,
	SourceLifecycleWaveformPeakWindow,
} from './source-lifecycle-types.d.ts';
import type {
	WaveformPcmRange,
	WaveformPeakWindowOptions,
	WaveformPeakWindow,
} from '../waveform-analysis.ts';
import { MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS } from '../../../waveform-peak-contract.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface WaveformPeakWindowCacheOptions<Provider> {
	readonly cacheKey: string;
	readonly sourceId: string;
	readonly range: WaveformPcmRange;
	readonly pixelWidth: number;
	readonly maximumBlockSize: number;
	readonly maximumEntries: number;
	readonly requests: Map<string, SourceLifecycleWaveformPeakRequest>;
	readonly windows: Map<string, SourceLifecycleWaveformPeakWindow>;
	readonly getProvider: () => Promise<Provider | null>;
	readonly readWindow: (
		provider: Provider,
		range: WaveformPcmRange,
		options: WaveformPeakWindowOptions,
	) => Awaitable<WaveformPeakWindow>;
	readonly isCurrent: () => boolean;
	readonly isRetiredError: (error: unknown) => boolean;
	readonly publish: () => void;
}

/** Own the bounded, viewport-local peak cache used when an exact PCM request is too large. */
export async function requestCachedWaveformPeakWindow<Provider>({
	cacheKey,
	sourceId,
	range,
	pixelWidth,
	maximumBlockSize,
	maximumEntries,
	requests,
	windows,
	getProvider,
	readWindow,
	isCurrent,
	isRetiredError,
	publish,
}: WaveformPeakWindowCacheOptions<Provider>): Promise<SourceLifecycleWaveformPeakWindow | null> {
	const blockSize = Math.min(
		Math.floor((range.endFrame - range.startFrame) / pixelWidth),
		maximumBlockSize,
	);
	if (blockSize < 1) throw new RangeError('This waveform scale requires individual PCM samples.');
	const pending = requests.get(cacheKey);
	const pendingMatches = Boolean(pending && pending.sourceId === sourceId
		&& peakRequestContains(pending, range, blockSize));
	const cached = windows.get(cacheKey);
	if (cached && cached.sourceId === sourceId && peakRequestContains(cached, range, blockSize)) {
		if (pending && !pendingMatches) {
			requests.delete(cacheKey);
			pending.abort();
		}
		windows.delete(cacheKey);
		windows.set(cacheKey, cached);
		return cached;
	}
	if (pending && pendingMatches) return pending.promise;
	const superseded = pending;
	requests.delete(cacheKey);
	superseded?.abort();
	if (Math.ceil((range.endFrame - range.startFrame) / blockSize)
		> MAXIMUM_WAVEFORM_PEAK_WINDOW_BUCKETS) return null;
	while (requests.size >= maximumEntries) {
		const oldestKey = requests.keys().next().value;
		if (oldestKey === undefined) break;
		const oldest = requests.get(oldestKey);
		requests.delete(oldestKey);
		oldest?.abort();
	}
	const controller = new AbortController();
	const request: SourceLifecycleWaveformPeakRequest = {
		sourceId,
		...range,
		blockSize,
		abort: () => controller.abort(),
		promise: Promise.resolve().then(async () => {
			const provider = await getProvider();
			if (!provider || controller.signal.aborted || requests.get(cacheKey) !== request || !isCurrent()) return null;
			return readWindow(provider, range, { pixelWidth, maximumBlockSize, signal: controller.signal });
		}).then((result) => {
			if (!result || requests.get(cacheKey) !== request) {
				if (requests.get(cacheKey) === request) requests.delete(cacheKey);
				return null;
			}
			requests.delete(cacheKey);
			if (!isCurrent()) return null;
			const window: SourceLifecycleWaveformPeakWindow = Object.freeze({
				clipId: cacheKey,
				sourceId,
				startFrame: result.startFrame,
				endFrame: result.endFrame,
				blockSize: result.blockSize,
				pixelsPerSample: result.pixelsPerSample,
				channels: Object.freeze(result.channels),
			});
			windows.delete(cacheKey);
			windows.set(cacheKey, window);
			while (windows.size > maximumEntries) {
				const oldestKey = windows.keys().next().value;
				if (oldestKey === undefined) break;
				windows.delete(oldestKey);
			}
			publish();
			return window;
		}).catch((error: unknown) => {
			if (requests.get(cacheKey) === request) requests.delete(cacheKey);
			if (controller.signal.aborted || isRetiredError(error)) return null;
			throw error;
		}),
	};
	requests.set(cacheKey, request);
	return request.promise;
}

function peakRequestContains(
	window: WaveformPcmRange & Readonly<{ blockSize: number }>,
	range: WaveformPcmRange,
	maximumBlockSize: number,
): boolean {
	return window.startFrame <= range.startFrame
		&& window.endFrame >= range.endFrame
		&& window.blockSize <= maximumBlockSize;
}
