/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Delivery goldens for milestone 6B-1.
 *
 * Two things are pinned here, and they answer different questions.
 *
 * The digests answer byte-stability: an FFmpeg run is deterministic given its
 * arguments and its inputs, so an unchanged argument vector over unchanged
 * media is an unchanged output file. Pinning the whole vector by digest rather
 * than the plan's JSON is deliberate — the plan may grow a field without
 * changing a single delivered byte, and a plan digest would call that a
 * regression while missing an encoder setting that silently moved.
 *
 * The geometry fragments answer crop-correctness, and they are kept readable
 * because a failure there is a framing bug someone has to reason about. They
 * are the scale, pad, crop, and overlay filters lifted out of the graph in the
 * order the graph applies them.
 */

export const VIDEO_DELIVERY_GOLDEN_PROVENANCE = Object.freeze({
	source: Object.freeze({ width: 1_920, height: 1_080, frameRate: 30 }),
	project: Object.freeze({ sampleRate: 48_000, rangeFrames: 48_000 }),
	stagedPaths: Object.freeze({ video: '/in.mp4', audio: '/mix.wav' }),
	note: 'One 16:9 clip filling a one-second range, so every delivery below differs only in its stated canvas.',
	/**
	 * The default-option vectors were regenerated at 1f2502ee — the commit before
	 * 6B-1's first change — and came back identical, so byte-stability here is a
	 * measured fact rather than a claim. The keyed 1280x720 vector was checked
	 * the same way; its 9:16 sibling could not be, because that build's encoder
	 * refused any canvas taller than 720.
	 */
	byteStabilityVerifiedAgainst: '1f2502ee',
});

export interface VideoDeliveryGolden {
	readonly argumentCount: number;
	/** SHA-256 of the space-joined FFmpeg argument vector. */
	readonly sha256: string;
	readonly geometry: readonly string[];
}

export const VIDEO_DELIVERY_GRAPH_GOLDENS: Readonly<Record<string, VideoDeliveryGolden>> = Object.freeze({
	/** The automatic 1280x720 canvas: what every export produced before 6B-1. */
	defaultMp4: Object.freeze({
		argumentCount: 40,
		sha256: '8b79b7e316fb5092758deb0c09b85f677a55ddd766ba61b2e189219f05d24dea',
		geometry: Object.freeze([
			'scale=w=1280:h=720:flags=bicubic',
			'pad=w=1280:h=720:x=0:y=0:color=black@0',
		]),
	}),
	defaultWebm: Object.freeze({
		argumentCount: 42,
		sha256: '9457d9bcc4ea16bfd20db08ec398a1818fdc20a685013a4aa461f9dd4480e040',
		geometry: Object.freeze([
			'scale=w=1280:h=720:flags=bicubic',
			'pad=w=1280:h=720:x=0:y=0:color=black@0',
		]),
	}),
	/** 9:16 letterboxed: the whole 16:9 frame, 608 tall, centred with 656 above and below. */
	verticalContain: Object.freeze({
		argumentCount: 40,
		sha256: '2a3889909be731ba52da2dc4c2e485de9f362a404022cd942b921c9f403755b7',
		geometry: Object.freeze([
			'scale=w=1080:h=608:flags=bicubic',
			'pad=w=1080:h=1920:x=0:y=656:color=black@0',
		]),
	}),
	/**
	 * 9:16 cropped: the frame is scaled until it fills the height, at which point
	 * it is 3413 wide and overhangs a 1080-wide canvas by 1166 on each side. A
	 * pad cannot take a negative offset, so this is an overlay, and the fractional
	 * centre reproduces the same left edge the placement resolved.
	 */
	verticalCover: Object.freeze({
		argumentCount: 40,
		sha256: 'a714b1b5a19062980a506cfe9805352f1ce6ed3581ea108d66468783da00684f',
		geometry: Object.freeze([
			'scale=w=3413:h=1920:flags=bicubic',
			'crop=w=iw*1:h=ih*1:x=iw*0:y=ih*0:exact=1',
			'overlay=x=540.5-overlay_w/2:y=960-overlay_h/2:eof_action=pass:repeatlast=0:format=auto:alpha=premultiplied',
		]),
	}),
	/** 9:16 stretched: the canvas exactly, aspect ratio abandoned as asked. */
	verticalStretch: Object.freeze({
		argumentCount: 40,
		sha256: '31eb5acd34270be67e9bc3cbf19c05ce8089fc00cd7706a396922b48f656fbce',
		geometry: Object.freeze([
			'scale=w=1080:h=1920:flags=bicubic',
			'pad=w=1080:h=1920:x=0:y=0:color=black@0',
		]),
	}),
});

/**
 * The keyed path encodes finished RGBA frames, so its arguments carry no
 * geometry at all — the framing already happened in the renderer. They are
 * short enough to pin verbatim, which is worth more than a digest here.
 */
export const VIDEO_DELIVERY_KEYED_ARGUMENTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	/** The automatic canvas, which is the vector this path emitted before 6B-1. */
	defaultMp4: Object.freeze([
		'-nostdin', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
		'-video_size', '1280x720', '-framerate', '30/1', '-i', '/frames.rgba',
		'-frames:v', '30', '-map', '0:v:0', '-map_metadata', '-1', '-map_chapters', '-1',
		'-sn', '-dn', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
		'-pix_fmt', 'yuv420p', '-r', '30/1', '-an', '-movflags', '+faststart',
		'-f', 'mp4', '/encoded.mp4',
	]),
	defaultWebm: Object.freeze([
		'-nostdin', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
		'-video_size', '1280x720', '-framerate', '30/1', '-i', '/frames.rgba',
		'-frames:v', '30', '-map', '0:v:0', '-map_metadata', '-1', '-map_chapters', '-1',
		'-sn', '-dn', '-c:v', 'libvpx-vp9', '-crf', '31', '-b:v', '0',
		'-deadline', 'good', '-cpu-used', '4',
		'-pix_fmt', 'yuv420p', '-r', '30/1', '-an', '-f', 'webm', '/encoded.webm',
	]),
	mp4: Object.freeze([
		'-nostdin', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
		'-video_size', '1080x1920', '-framerate', '30/1', '-i', '/frames.rgba',
		'-frames:v', '30', '-map', '0:v:0', '-map_metadata', '-1', '-map_chapters', '-1',
		'-sn', '-dn', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
		'-pix_fmt', 'yuv420p', '-r', '30/1', '-an', '-movflags', '+faststart',
		'-f', 'mp4', '/encoded.mp4',
	]),
	webm: Object.freeze([
		'-nostdin', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
		'-video_size', '1080x1920', '-framerate', '30/1', '-i', '/frames.rgba',
		'-frames:v', '30', '-map', '0:v:0', '-map_metadata', '-1', '-map_chapters', '-1',
		'-sn', '-dn', '-c:v', 'libvpx-vp9', '-crf', '31', '-b:v', '0',
		'-deadline', 'good', '-cpu-used', '4',
		'-pix_fmt', 'yuv420p', '-r', '30/1', '-an', '-f', 'webm', '/encoded.webm',
	]),
});

/**
 * Where a 1920x1080 source lands in a 1080x1920 canvas, per fit.
 *
 * This is the arithmetic both paths share, so it is pinned once rather than
 * inferred from either one's filter output.
 */
export const VIDEO_DELIVERY_VERTICAL_PLACEMENTS = Object.freeze({
	contain: Object.freeze({ fittedWidth: 1_080, fittedHeight: 608, fittedX: 0, fittedY: 656 }),
	cover: Object.freeze({ fittedWidth: 3_413, fittedHeight: 1_920, fittedX: -1_166, fittedY: 0 }),
	stretch: Object.freeze({ fittedWidth: 1_080, fittedHeight: 1_920, fittedX: 0, fittedY: 0 }),
});
