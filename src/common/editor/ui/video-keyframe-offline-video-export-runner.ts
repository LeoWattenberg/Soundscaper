/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	VideoKeyframeVideoEncoderRequest,
	VideoKeyframeVideoEncoderResult,
	VideoKeyframeVideoSinkEncoderResult,
} from '../video-keyframe-video-encoder.ts';
import type { VideoKeyframeOfflineHtmlVideoSourceResolver } from './video-keyframe-offline-html-video-source-resolver.ts';
import type { VideoKeyframeOfflineRgbaRenderer } from './video-keyframe-offline-rgba-renderer.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export async function runVideoKeyframeOfflineVideoResources<Output>(
	createResolver: () => VideoKeyframeOfflineHtmlVideoSourceResolver,
	createRenderer: (
		resolver: VideoKeyframeOfflineHtmlVideoSourceResolver,
	) => Readonly<{
		renderer: VideoKeyframeOfflineRgbaRenderer;
		request: VideoKeyframeVideoEncoderRequest;
	}>,
	run: (
		request: VideoKeyframeVideoEncoderRequest,
	) => Promise<VideoKeyframeVideoEncoderResult | VideoKeyframeVideoSinkEncoderResult<Output>>,
	assertCurrent?: () => void,
): Promise<VideoKeyframeVideoEncoderResult | VideoKeyframeVideoSinkEncoderResult<Output>> {
	let resolver: VideoKeyframeOfflineHtmlVideoSourceResolver | null = null;
	let renderer: VideoKeyframeOfflineRgbaRenderer | null = null;
	let result: VideoKeyframeVideoEncoderResult | VideoKeyframeVideoSinkEncoderResult<Output> | null = null;
	let primary: unknown;
	let hasPrimary = false;
	try {
		resolver = createResolver();
		const resources = createRenderer(resolver);
		renderer = resources.renderer;
		result = await run(resources.request);
	} catch (error) {
		primary = error;
		hasPrimary = true;
	}
	const cleanupFailures: unknown[] = [];
	if (renderer !== null) {
		const failure = await retryCleanup(() => renderer!.dispose(), 'offline RGBA renderer');
		if (failure !== null) cleanupFailures.push(failure);
	}
	if (resolver !== null) {
		const failure = await retryCleanup(() => resolver!.dispose(), 'offline video source resolver');
		if (failure !== null) cleanupFailures.push(failure);
	}
	if (!hasPrimary && cleanupFailures.length === 0 && assertCurrent) {
		try { assertCurrent(); } catch (error) { primary = error; hasPrimary = true; }
	}
	if (hasPrimary || cleanupFailures.length > 0) {
		if (result && 'bytes' in result) result.bytes.fill(0);
		if (hasPrimary && cleanupFailures.length === 0) throw primary;
		if (!hasPrimary && cleanupFailures.length === 1) throw cleanupFailures[0];
		throw new AggregateError(
			hasPrimary ? [primary, ...cleanupFailures] : cleanupFailures,
			'Offline video encoding and browser resource cleanup did not both complete successfully.',
			{ ...(hasPrimary ? { cause: primary } : {}) },
		);
	}
	if (!result) throw new Error('Offline video export produced no exact encoded result.');
	return result;
}

async function retryCleanup(
	dispose: () => Awaitable<void>,
	name: string,
): Promise<unknown | null> {
	try {
		await dispose();
		return null;
	} catch (error) {
		try {
			await dispose();
			return null;
		} catch (retryError) {
			return new AggregateError(
				[error, retryError], `${name} cleanup failed twice.`, { cause: error },
			);
		}
	}
}
