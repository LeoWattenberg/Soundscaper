/* SPDX-License-Identifier: AGPL-3.0-only */

import { getMediaExportFormat } from './media-export.js';
import { getVideoExportFormat } from './video-export.js';

/**
 * The failures the browser FFmpeg runtime raises.
 *
 * Each carries a stable `code` and, where a format is involved, the codec that refused the
 * work, because the surfaces that catch these have to tell the user which delivery is
 * unavailable rather than that encoding failed. They are declared apart from the runtime so
 * a caller can recognize a failure without loading the runtime that produces it.
 */

export class FfmpegCoreUnavailableError extends Error {
	constructor(cause) {
		super('The browser FFmpeg core could not be loaded; compressed media export is unavailable.', { cause });
		this.name = 'FfmpegCoreUnavailableError';
		this.code = 'FFMPEG_CORE_UNAVAILABLE';
	}
}

export class FfmpegDisposedError extends Error {
	constructor() {
		super('The browser FFmpeg runtime has been disposed.');
		this.name = 'FfmpegDisposedError';
		this.code = 'FFMPEG_DISPOSED';
	}
}

export class FfmpegEncodingError extends Error {
	constructor(format, exitCode) {
		const descriptor = getMediaExportFormat(format);
		super(`${descriptor.label} encoding failed because FFmpeg codec ${descriptor.codec} is unavailable or rejected the export settings (exit code ${exitCode}).`);
		this.name = 'FfmpegEncodingError';
		this.code = 'FFMPEG_ENCODING_FAILED';
		this.format = descriptor.id;
		this.codec = descriptor.codec;
		this.exitCode = exitCode;
	}
}

export class FfmpegVideoEncodingError extends Error {
	constructor(format, exitCode) {
		const descriptor = getVideoExportFormat(format);
		super(`${descriptor.label} encoding failed because FFmpeg codec ${descriptor.videoEncoder} is unavailable or rejected the video export plan (exit code ${exitCode}).`);
		this.name = 'FfmpegVideoEncodingError';
		this.code = 'FFMPEG_VIDEO_ENCODING_FAILED';
		this.format = descriptor.id;
		this.videoCodec = descriptor.videoCodec;
		this.videoEncoder = descriptor.videoEncoder;
		this.exitCode = exitCode;
	}
}
