/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The commands that write a video proxy, and the recipe that names them.
 *
 * A proxy is a smaller stand-in for one original video source. It is derived
 * media and never editorial authority: clip bounds, source timing, extracted
 * audio, relink identity, and delivery all keep referring to the original. What
 * a proxy owes in return is that it presents the *same pictures at the same
 * times*, only smaller — which is what makes the two interchangeable for
 * preview and what `proveVideoProxyTimingConformance` checks boundary by
 * boundary before any consumer is allowed to show one.
 *
 * Three properties of the encode follow directly from that promise.
 *
 * **Frame for frame.** `-fps_mode passthrough` writes each decoded frame with
 * the timestamp it arrived with, so a variable-rate original stays variable and
 * a constant-rate one keeps its exact rational rate. Anything that resamples the
 * stream onto a new clock — `-r`, `-vsync cfr`, a trim — would produce a file
 * whose boundaries no longer line up, and conformance would refuse it.
 *
 * **Display geometry, not coded geometry.** Measured against the pinned
 * `@ffmpeg/core` 0.12.10 (FFmpeg 5.1.4): `-noautorotate` copies the input's
 * display matrix onto the encoded output, and `-metadata:s:v:0 rotate=0` does
 * not clear it because the mov muxer prefers the side data. A proxy written that
 * way declares a rotation that the preview — which already applies the
 * original's display geometry itself — would then apply a second time. Left to
 * autorotate, the decode turns the frames and the output carries no matrix at
 * all. `setsar=1` settles the other half: Chromium applies a stored pixel aspect
 * to `videoWidth` while Firefox ignores it, so a proxy that kept the ratio would
 * present at two different sizes depending on who opened it. The proxy is
 * therefore square-pixelled and already turned, which is the same convention the
 * export follows.
 *
 * **Its own size, decided in the filtergraph.** The generator port is handed the
 * original as a `Blob` and its identity — never a decoded width and height — so
 * the clamp that stops a small source being blown up into a larger "proxy" has
 * to survive the filtergraph parser rather than be computed in JavaScript.
 */

export interface VideoProxyGenerationRecipe extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly version: number;
	readonly maximumHeight: number;
	readonly mimeType: string;
	readonly extension: string;
}

/**
 * The one maintained proxy recipe.
 *
 * Its id and version are persisted with the attachment, so a body produced by a
 * later recipe can never pass as one this recipe wrote. H.264 in MP4 is what the
 * shipped delivery tier already encodes, which keeps a preview-only derivative
 * from being the thing that introduces an uncleared codec.
 */
export const VIDEO_PROXY_GENERATION_RECIPE: VideoProxyGenerationRecipe = Object.freeze({
	id: 'framescaper-video-proxy-h264-540-v1',
	version: 1,
	maximumHeight: 540,
	mimeType: 'video/mp4',
	extension: 'mp4',
});

export interface VideoProxyGenerationRequest {
	readonly inputPath: string;
	readonly outputPath: string;
	/**
	 * The original's timescale, when the caller holds its timing view. The mov
	 * muxer picks its own otherwise, and a timescale that cannot express the
	 * original's boundaries rounds them — which conformance refuses. A caller
	 * that is not sure states nothing rather than pinning the wrong one.
	 */
	readonly timescale?: number;
}

/** The scale-and-square filter, escaped as the filtergraph parser reads it. */
export function videoProxyGenerationFilter(): string {
	// An unescaped comma inside `min(...)` would end the scale filter and start a
	// filter named `ih)`, so the argument separator is escaped where the height
	// expression needs a real one. `trunc(.../2)*2` keeps the height even and
	// `-2` derives an even width from it, both of which yuv420p requires.
	const height = `trunc(min(${String(VIDEO_PROXY_GENERATION_RECIPE.maximumHeight)}\\,ih)/2)*2`;
	return `scale=-2:${height},setsar=1`;
}

/** One proxy, written from one original, at the recipe's size. */
export function buildVideoProxyGenerationArgs(
	request: VideoProxyGenerationRequest,
): readonly string[] {
	const input = nonEmpty(request?.inputPath, 'input');
	const output = nonEmpty(request?.outputPath, 'output');
	const timescale = request?.timescale === undefined ? null : videoTrackTimescale(request.timescale);
	return Object.freeze([
		'-hide_banner', '-nostdin', '-y',
		'-i', input,
		// One video stream and nothing else. A proxy carrying its own audio would
		// invite a second clock into a picture-only derivative; the original keeps
		// owning the sound, which is what `ignore-proxy-container-audio-v1` states.
		'-map', '0:v:0', '-an', '-sn', '-dn',
		'-vf', videoProxyGenerationFilter(),
		'-fps_mode', 'passthrough',
		'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
		'-pix_fmt', 'yuv420p',
		...(timescale === null ? [] : ['-video_track_timescale', String(timescale)]),
		// A preview seeks constantly, and a proxy whose index sits at the end of
		// the file makes the first seek wait for the whole body to arrive.
		'-movflags', '+faststart',
		output,
	]);
}

function nonEmpty(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) {
		throw new TypeError(`A video proxy generation ${name} path is required.`);
	}
	return value;
}

function videoTrackTimescale(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError('A video proxy timescale must be a positive safe integer.');
	}
	return value;
}
