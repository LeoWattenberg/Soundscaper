/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertVideoRetimeExactOrdinalAuthority,
	resolveVideoRetimeExactOutputOrdinal,
	resolveVideoRetimeExactPictureOrdinal,
	type VideoRetimeExactOrdinalAuthority,
	type VideoRetimeExactPictureRequest,
} from './video-retime-exact-ordinal-authority.ts';
import type { VideoRetimeExactOutputOrdinal } from './video-retime-exact-ordinal-oracle.ts';
import type { VideoRetimeFrameDescriptor } from './video-retime-frame-dispatch.ts';
import {
	createVideoRetimePreviewExecutor,
	type VideoRetimePreviewExecutor,
	type VideoRetimePreviewMediaPort,
	type VideoRetimePreviewResult,
} from './video-retime-preview-executor.ts';

export type { VideoRetimePreviewMediaPort } from './video-retime-preview-executor.ts';

export interface VideoRetimeExactPreviewConsumer {
	readonly requestFrame: (
		request: VideoRetimeExactPictureRequest,
	) => Promise<VideoRetimePreviewResult>;
	readonly cancel: () => void;
	readonly dispose: () => void;
}

export interface VideoRetimeExactExportFrameSource {
	readonly frameCount: number;
	readonly frameAt: (outputOrdinal: number) => VideoRetimeExactOutputOrdinal;
}

const EXPORT_SOURCES = new WeakSet<object>();
const EXPORT_FRAME_OWNERS = new WeakMap<object, VideoRetimeExactExportFrameSource>();

/**
 * Drive the real paused-media preview executor only from an authenticated
 * picture selected by the shared exact authority. Raw frame descriptors never
 * cross this candidate consumer boundary.
 */
export function createVideoRetimeExactPreviewConsumer(
	authority: VideoRetimeExactOrdinalAuthority,
	port: VideoRetimePreviewMediaPort,
	options: Readonly<{ readonly onPresented: (descriptor: VideoRetimeFrameDescriptor) => void }>,
): VideoRetimeExactPreviewConsumer {
	assertVideoRetimeExactOrdinalAuthority(authority);
	const executor: VideoRetimePreviewExecutor = createVideoRetimePreviewExecutor(port, options);
	let disposed = false;
	const requestFrame = (
		request: VideoRetimeExactPictureRequest,
	): Promise<VideoRetimePreviewResult> => {
		if (disposed) return Promise.reject(new Error('The exact video preview consumer is disposed.'));
		const picture = resolveVideoRetimeExactPictureOrdinal(authority, request);
		return executor.requestFrame(Object.freeze({
			outerCell: picture.outerCell,
			segmentIndex: picture.segmentIndex,
			mode: picture.mode,
			sourceFrame: picture.sourcePosition,
			sourceTime: picture.sourceTime,
			drawableSourceFrame: picture.sourceOrdinal,
			drawableSourceStartTime: picture.drawableSourceStartTime,
			drawableSourceEndTime: picture.drawableSourceEndTime,
		}));
	};
	return Object.freeze({
		requestFrame,
		cancel: (): void => { executor.cancel(); },
		dispose: (): void => {
			if (disposed) return;
			disposed = true;
			executor.dispose();
		},
	});
}

/** Random-access export source over the same private oracle used by preview and OFX. */
export function createVideoRetimeExactExportFrameSource(
	authority: VideoRetimeExactOrdinalAuthority,
): VideoRetimeExactExportFrameSource {
	assertVideoRetimeExactOrdinalAuthority(authority);
	const source: VideoRetimeExactExportFrameSource = Object.freeze({
		frameCount: authority.outputFrameCount,
		frameAt(outputOrdinal: number): VideoRetimeExactOutputOrdinal {
			const resolved = resolveVideoRetimeExactOutputOrdinal(authority, outputOrdinal);
			const frame = Object.freeze({
				outputOrdinal: resolved.outputOrdinal,
				relativePts: resolved.relativePts,
				absoluteSample: resolved.absoluteSample,
				pictures: resolved.pictures,
			});
			EXPORT_FRAME_OWNERS.set(frame, source);
			return frame;
		},
	});
	EXPORT_SOURCES.add(source);
	return source;
}

export function assertVideoRetimeExactExportFrameSource(
	value: unknown,
): asserts value is VideoRetimeExactExportFrameSource {
	if (!value || typeof value !== 'object' || !EXPORT_SOURCES.has(value)) {
		throw new TypeError('An authenticated exact video export frame source is required.');
	}
}

export function assertVideoRetimeExactExportFrame(
	source: VideoRetimeExactExportFrameSource,
	value: unknown,
): asserts value is VideoRetimeExactOutputOrdinal {
	assertVideoRetimeExactExportFrameSource(source);
	if (!value || typeof value !== 'object' || EXPORT_FRAME_OWNERS.get(value) !== source) {
		throw new TypeError('An export frame owned by the authenticated exact source is required.');
	}
}
