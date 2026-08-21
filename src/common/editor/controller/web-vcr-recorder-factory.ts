/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	BrowserCaptureStream,
	BrowserCaptureTrack,
} from './framescaper-browser-capture-source.ts';
import type {
	FramescaperCaptureRecorder,
	FramescaperCaptureRecorderRequest,
} from './framescaper-capture-session-types.ts';
import type { WebVcrDimensions, WebVcrNormalizedCrop } from '../web-vcr-domain.ts';

export interface WebVcrRecorderCropLease {
	readonly track: BrowserCaptureTrack;
	readonly firstFrame: Promise<Readonly<{
		readonly inputSize: Readonly<WebVcrDimensions>;
		readonly outputSize: Readonly<WebVcrDimensions>;
	}>>;
	dispose(reason?: unknown): Promise<void>;
}

export interface WebVcrRecorderFactoryOptions {
	readonly base: (
		request: FramescaperCaptureRecorderRequest<BrowserCaptureStream, BrowserCaptureTrack>,
	) => PromiseLike<FramescaperCaptureRecorder> | FramescaperCaptureRecorder;
	readonly frozenCrop: () => Readonly<WebVcrNormalizedCrop>;
	readonly openCrop: (request: Readonly<{
		readonly source: BrowserCaptureTrack;
		readonly crop: Readonly<WebVcrNormalizedCrop>;
		onError(error: unknown): void;
	}>) => Readonly<WebVcrRecorderCropLease>;
	readonly createStream: (tracks: readonly BrowserCaptureTrack[]) => BrowserCaptureStream;
	onDimensions?(value: Readonly<{
		readonly inputSize: Readonly<WebVcrDimensions>;
		readonly outputSize: Readonly<WebVcrDimensions>;
	}>): void;
}

/** Gives the existing recorder only a cropped generator track; raw pixels never reach its encoder. */
export function createWebVcrRecorderFactory(
	options: WebVcrRecorderFactoryOptions,
): WebVcrRecorderFactoryOptions['base'] {
	return async (request) => {
		if (request.source.role !== 'display') return options.base(request);
		const crop = options.openCrop({
			source: request.source.track,
			crop: options.frozenCrop(),
			onError: request.onError,
		});
		let recorder: FramescaperCaptureRecorder;
		try {
			const dimensions = await crop.firstFrame;
			options.onDimensions?.(dimensions);
			recorder = await options.base({
				...request,
				source: Object.freeze({
					...request.source,
					track: crop.track,
					stream: options.createStream([crop.track]),
					settings: Object.freeze({
						...request.source.settings,
						width: dimensions.outputSize.width,
						height: dimensions.outputSize.height,
					}),
				}),
			});
		} catch (error) {
			await crop.dispose(error).catch(() => undefined);
			throw error;
		}
		return wrapCroppedRecorder(recorder, crop);
	};
}

function wrapCroppedRecorder(
	recorder: FramescaperCaptureRecorder,
	crop: Readonly<WebVcrRecorderCropLease>,
): Readonly<FramescaperCaptureRecorder> {
	let stopPromise: Promise<void> | null = null;
	let disposePromise: Promise<void> | null = null;
	let cropDisposePromise: Promise<void> | null = null;
	const disposeCrop = (): Promise<void> => cropDisposePromise ??= crop.dispose();
	return Object.freeze({
		format: recorder.format,
		start: (activeTimeUs?: number) => recorder.start(activeTimeUs),
		pause: () => recorder.pause(),
		resume: (excludedPauseDurationUs?: number) => recorder.resume(excludedPauseDurationUs),
		stop() {
			stopPromise ??= settleTogether([
				() => recorder.stop(),
				disposeCrop,
			], 'Web VCR recorder did not stop cleanly.');
			return stopPromise;
		},
		dispose() {
			disposePromise ??= settleTogether([
				() => recorder.dispose(),
				disposeCrop,
			], 'Web VCR recorder did not dispose cleanly.');
			return disposePromise;
		},
		...(recorder.setMonitoring ? { setMonitoring: (enabled: boolean) => recorder.setMonitoring?.(enabled) } : {}),
		...(recorder.setInputGain ? { setInputGain: (value: number) => recorder.setInputGain?.(value) } : {}),
	});
}

async function settleTogether(
	operations: readonly (() => PromiseLike<unknown> | unknown)[],
	message: string,
): Promise<void> {
	const results = await Promise.allSettled(operations.map((operation) => Promise.resolve().then(operation)));
	const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
	if (failures.length) throw new AggregateError(failures, message);
}
