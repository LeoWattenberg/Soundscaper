/* SPDX-License-Identifier: AGPL-3.0-only */

// Repository-generated fixture. Four packed 64x32 rgb24 frames use the
// backgrounds below. Ordinal n (1..4) is encoded little-endian in four bars:
// bit b owns x [2 + 8b, 8 + 8b), y [2, 14), white when set and black otherwise.
// Pinned @ffmpeg/core 0.12.10 encoded these bytes three times identically.
const ORDINAL_VFR_MP4_BASE64 = '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';

const FRAME_BACKGROUNDS = Object.freeze([
	Object.freeze([240, 16, 16]),
	Object.freeze([16, 240, 16]),
	Object.freeze([16, 16, 240]),
	Object.freeze([240, 240, 16]),
]);

const FFMPEG_ARGUMENTS = Object.freeze([
	'-f', 'rawvideo',
	'-pixel_format', 'rgb24',
	'-video_size', '64x32',
	'-framerate', '1000/70',
	'-i', 'ordinal.rgb',
	'-vf', 'settb=expr=1/1000,setpts=if(eq(N\\,0)\\,0\\,if(eq(N\\,1)\\,40\\,if(eq(N\\,2)\\,130\\,200)))',
	'-fps_mode', 'vfr',
	'-c:v', 'libx264',
	'-preset', 'ultrafast',
	'-profile:v', 'baseline',
	'-crf', '1',
	'-g', '1',
	'-bf', '0',
	'-pix_fmt', 'yuv420p',
	'-enc_time_base', '1/1000',
	'-video_track_timescale', '1000',
	'-movflags', '+faststart',
	'-map_metadata', '-1',
	'-map_chapters', '-1',
	'-an',
	'-y', 'ordinal-vfr.mp4',
]);

const PIXEL_ORACLE = Object.freeze([
	ordinalOracle(1, 0.020, 0, [239, 16, 17, 255]),
	ordinalOracle(2, 0.085, 0.04, [17, 240, 18, 255]),
	ordinalOracle(3, 0.165, 0.13, [16, 17, 238, 255]),
	ordinalOracle(4, 0.235, 0.2, [240, 239, 18, 255]),
]);

export const videoRetimePreviewMedia = Object.freeze({
	id: 'video-retime-vfr-ordinal-mp4-v1',
	file: Object.freeze({
		name: 'video-retime-vfr-ordinal.mp4',
		mimeType: 'video/mp4',
		buffer: Buffer.from(ORDINAL_VFR_MP4_BASE64, 'base64'),
	}),
	width: 64,
	height: 32,
	rawByteLength: 24_576,
	rawSha256: '191afca830eff27f7bb057e46256b775e64fa5c143abc7e17f38ec394bc65203',
	outputByteLength: 3_967,
	outputSha256: '8800d170f366faadbf9e8b28523e1294c8ec5cbf470f957698d95259a0450205',
	// H.264 stores these frames as YUV. Decoder-specific YUV-to-RGB integer
	// rounding changes a color channel by up to two values across platforms.
	decoderChannelTolerance: 2,
	generation: Object.freeze({
		runtime: '@ffmpeg/core 0.12.10',
		pixelFormat: 'rgb24',
		frameBackgrounds: FRAME_BACKGROUNDS,
		ordinalBitOrder: 'least-significant first',
		ordinalBarBounds: Object.freeze({ yStart: 2, yEnd: 14, xStart: 2, width: 6, stride: 8 }),
		arguments: FFMPEG_ARGUMENTS,
	}),
	timing: Object.freeze({
		timescale: 1_000,
		presentationTicks: Object.freeze([0n, 40n, 130n, 200n]),
		finalFrameDurationTicks: 70n,
		endTicks: 270n,
		intervalDurationTicks: Object.freeze([40n, 90n, 70n, 70n]),
	}),
	pixelOracle: PIXEL_ORACLE,
});

/** Compare decoded RGB with the pinned oracle while keeping opaque alpha exact. */
export function decodedRgbaMatchesOracle(actual, expected) {
	if (!Array.isArray(actual) || !Array.isArray(expected)
		|| actual.length !== 4 || expected.length !== 4) return false;
	if (!actual.every(Number.isFinite) || !expected.every(Number.isFinite)) return false;
	return actual.slice(0, 3).every((channel, index) => (
		Math.abs(channel - expected[index]) <= videoRetimePreviewMedia.decoderChannelTolerance
	)) && actual[3] === expected[3];
}

export function createVideoRetimePreviewOrdinalRgb() {
	const width = videoRetimePreviewMedia.width;
	const height = videoRetimePreviewMedia.height;
	const frameBytes = width * height * 3;
	const bytes = Buffer.alloc(frameBytes * FRAME_BACKGROUNDS.length);
	for (let frame = 0; frame < FRAME_BACKGROUNDS.length; frame += 1) {
		const [red, green, blue] = FRAME_BACKGROUNDS[frame];
		const frameOffset = frame * frameBytes;
		for (let pixel = 0; pixel < width * height; pixel += 1) {
			const offset = frameOffset + pixel * 3;
			bytes[offset] = red;
			bytes[offset + 1] = green;
			bytes[offset + 2] = blue;
		}
		for (let bit = 0; bit < 4; bit += 1) {
			const value = ((frame + 1) & (1 << bit)) === 0 ? 0 : 255;
			for (let y = 2; y < 14; y += 1) {
				for (let x = 2 + bit * 8; x < 8 + bit * 8; x += 1) {
					const offset = frameOffset + (y * width + x) * 3;
					bytes[offset] = value;
					bytes[offset + 1] = value;
					bytes[offset + 2] = value;
				}
			}
		}
	}
	return bytes;
}

function ordinalOracle(ordinal, midpointSeconds, mediaTimeSeconds, centerRgba) {
	return Object.freeze({
		ordinal,
		midpointSeconds,
		mediaTimeSeconds,
		centerRgba: Object.freeze(centerRgba),
		ordinalBits: Object.freeze(Array.from(
			{ length: 4 },
			(_value, bit) => (ordinal & (1 << bit)) === 0 ? 0 : 1,
		)),
	});
}
