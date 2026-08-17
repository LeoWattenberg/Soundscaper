/* SPDX-License-Identifier: AGPL-3.0-only */

import { getVideoExportFormat } from './video-export.js';

/**
 * Stream-copy muxing for pre-encoded video.
 *
 * The WebCodecs tier produces encoded chunks, not frames, so the container is
 * all that remains to be written. FFmpeg already ships and already muxes, and
 * measurement says muxing is a rounding error against encoding: on a 640x360
 * 90-frame fixture, `encode + mux` took 3494 ms while `remux only` took 4.9 ms
 * — 0.1%. Reusing it therefore costs almost nothing and avoids taking on a
 * muxer dependency with its own licensing row and provenance manifest.
 *
 * Two things this path must not do. It must not re-encode: `-c:v copy` is the
 * whole point, and a plan that needs pixels touched belongs on the ordinary
 * encode path. And it must not let the frame rate degrade to a decimal —
 * elementary streams carry no container timing, so the rate is supplied as the
 * exact rational the plan owns and handed to FFmpeg as `num/den`.
 */

/** Elementary-stream container per codec. Neither carries timing, hence the explicit rate. */
const ELEMENTARY_FORMAT: Readonly<Record<string, string>> = Object.freeze({
	h264: 'h264',
	vp9: 'ivf',
});

export interface VideoRemuxRequest {
	/** `mp4` or `webm`, resolved against the shipping format table. */
	readonly format: string;
	/** Exact rational sequence rate; never pre-divided into a decimal. */
	readonly frameRate: { readonly num: number; readonly den: number };
	/** Path of the pre-encoded elementary stream. */
	readonly videoInputPath: string;
	/** Optional staged PCM mix. Audio stays on the ordinary encoder. */
	readonly audioInputPath?: string | null;
	readonly outputPath: string;
}

export function buildVideoRemuxArgs(request: VideoRemuxRequest): readonly string[] {
	const descriptor = getVideoExportFormat(String(request?.format ?? '')) as {
		id: string; container: string; videoCodec: string; audioEncoder: string;
	};
	const elementary = ELEMENTARY_FORMAT[descriptor.videoCodec];
	if (!elementary) {
		throw new RangeError(`No elementary stream container is defined for ${descriptor.videoCodec}.`);
	}
	const rate = request?.frameRate;
	if (!rate || !Number.isSafeInteger(rate.num) || !Number.isSafeInteger(rate.den)
		|| rate.num <= 0 || rate.den <= 0) {
		throw new TypeError('A remux requires an exact rational frame rate.');
	}
	const videoInput = nonEmpty(request?.videoInputPath, 'video input');
	const output = nonEmpty(request?.outputPath, 'output');
	const audioInput = request?.audioInputPath ? nonEmpty(request.audioInputPath, 'audio input') : null;

	const args = [
		'-f', elementary,
		// The exact quotient, so 30000/1001 stays 30000/1001 rather than 29.97.
		'-r', `${rate.num}/${rate.den}`,
		'-i', videoInput,
	];
	if (audioInput) args.push('-i', audioInput);
	args.push(
		'-map', '0:v:0',
		...(audioInput ? ['-map', '1:a:0'] : []),
		'-map_metadata', '-1',
		'-map_chapters', '-1',
		'-sn',
		'-dn',
		// Never re-encode: the chunks arrive already compressed.
		'-c:v', 'copy',
	);
	if (audioInput) args.push('-c:a', descriptor.audioEncoder, '-b:a', '192k');
	else args.push('-an');
	if (descriptor.id === 'mp4') args.push('-movflags', '+faststart');
	args.push('-f', descriptor.container, '-y', output);
	return Object.freeze(args);
}

/** The elementary-stream container a caller must wrap chunks in for this format. */
export function videoRemuxElementaryFormat(format: string): string {
	const descriptor = getVideoExportFormat(String(format ?? '')) as { videoCodec: string };
	const elementary = ELEMENTARY_FORMAT[descriptor.videoCodec];
	if (!elementary) {
		throw new RangeError(`No elementary stream container is defined for ${descriptor.videoCodec}.`);
	}
	return elementary;
}

function nonEmpty(value: unknown, label: string): string {
	const text = String(value ?? '').trim();
	if (!text) throw new TypeError(`A remux ${label} path is required.`);
	if (text.includes('\0')) throw new TypeError(`A remux ${label} path must not contain NUL.`);
	return text;
}
