/* SPDX-License-Identifier: AGPL-3.0-only */

// Repository-generated fixture. Four packed 256x128 rgb24 frames use the
// backgrounds below. Ordinal n (1..4) is encoded little-endian in four bars:
// bit b owns x [2 + 8b, 8 + 8b), y [2, 14), white when set and black otherwise.
// Pinned @ffmpeg/core 0.12.10 encoded these bytes three times identically.
const ORDINAL_VFR_MP4_BASE64 = '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FgAFAABAFAJChKBQKYpG2osAAQagABFrMjgACEbHAAELvwQjjBCHHiAqaquEAr4IRxghDjxAVNVXCAV8GK40Qj14iKmqvhCK+DFcaIR68RFTVXwhFfAQQoU8ogWNBMW9r2ok8BBChTyiBY0Exb2vaiTwGFKFvKoljYTFve9rJPAYUoW8qiWNhMW972skjEcsAAeeo4AAnRxwABSfkAACBgAAIKAAAgpSw4AAgYAACCgAAIKUsgAAQMQABBQAAEFOWHAAEDEAAQUAABBTlkAACCMAAIOwAAhDSw4AAgjAACDsAAIQ0sgAAQRwABB2AAEIeWHAAEEcAAQdgABCHlklk5OTk5OTk5OTk5OTisMaAAIFqEQABBLQ3o3vjWmcLo1pnC4PxS+dHQ3o3u+N82fG+bf666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666668AAAAKpZYiEaDGA4AAkUAAC0+AALMYAAo4CKACAABAYAAEHMAAQNwASBkATAC2AWzbUIAAIowAAn9mRAABFGAAE/tjAWAAIDAAAg5gACBuACQMgCYAWwC2bahAABFGAAE/syWAAIowAAn9sY4AAijAACf2xAWAAIDIAAg5AACBsACYMgCaAWgC2baiwABFHAAE/oyDgACKMAAJ/bEBYAAgMgACDkAAIGwAJgyAJoBaALZtqLAAEUcAAT+jI4AAoRRwABCRgAOAGAKCRslYjBVXScNTyJwWAwcABgCgkbJWIwVV0nDU8icFgMHAAQAgJGiVgMVVcJw1PAnBZDBwAEAICRolYDFVXCcNTwJwWQwAAPEQRGCsYeGpETp3iIgiMFYw8NSInTvGZBkcIxp4amROHeMyDI4RjTw1MicOhhDAcAAQGQABBuAAEDIAAeyRFAFiAhiSQLEmRtqEAAEAMAAQLDJYAAgBgACBYxgLEBDEkgWJMjbUIAAIAYAAgWGSwABADAAECxjBwABADAAECxiAsgMcgkChNkbaiwABACAAEC0yDgACAGAAIFjEBZAY5BIFCbI21FgACAEAAIFpkcAAQyo4AAgC+Awpo0iuiZOhYae8O0ncBhTRpFdEydCw094dpO4CCGjCKyBk4Fhp6w7CdwEENGEVkDJwLDT1h2E7okSiEcKjOP6JEohHCozj+uZPIZwqc8/rmTyGcKnPPERpYAAqiRwABcejgACJDJycnJycnJycnJycnJxWGJAAEEpDgA46+ixdHX0WLg/DDxa+RL/ets/3rbf4YeuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuvAAAADQGWIghoMYDgACRWAALVAAAs2AACq2IoAIAAEBkAAQcgABA2ABMGYBRALwBeNtQgAAikgACgAZEAAEUkAAUAGMBYAAgMgACDkAAIGwAJgzAKIBeALxtqEAAEUkAAUADJYAAikgACgAxjgACKSAAKADEBYAAgMAACDmAAIG4AJAzAKABfALxtqLAAEUgAAUATIOAAIpIAAoAMQFgACAwAAIOYAAgbgAkDMAoAF8AvG2osAARSAABQBMjgAChHHAAEJCAA4AQAgIGiRgMVRcJ41vAnhZDDwAEAICBokYDFUXCeNbwJ4WQw8ABgCggbJGIwVF0njW8ieFgMPAAYAoIGyRiMFRdJ41vInhYDCAA+ZhlcI1pwYmQOHOMzDK4RrTgxMgcOcRGEVgrWHBiRA6c4iMIrBWsODEiB04F1AWAAIZoAAiQAACdCAAI7AAAkcgACVOAAMSAAA+7IOoBYEAoSAAITSARAACHKym2oQAARjAABTRMlgACBEAAISLGAsAAQGQABByAAEDYAEgZgFEAvgF421BlgACKSAAKADEHAAECIAAQkWICwEAgQAAITaARgACHIym2osAARjQABTQMg4AAikgACgAxAWAAIDAAAg5gACBuACYMwCgAXgC8bavHAAEbeOAAIFXgAIAQEDRIwSGh4F41vCIuBh4ACAEBA0SMEhoeBeNbwiLgYeAAwBQQNkjFKaHoXjW8oi6GHgAMAUEDZIxSmh6F41vKIuhh4zMMrqK04MTz05xmYZXUVpwYnnpziIwisgrDgxLPDnERhFZBWHBiWeHBiFCgAD5lHAAE/eOAAIQkgAAQNAABBcAAEFqWHAAEDQAAQXAABBalkAACBqAAILgAAgtyw4AAgagACC4AAILcsgABAoXLDgAIFC5ZAAEChUsOABAoVLJFycnJycnJycnJycnJxThiIAAgsocAAhnUEGi9EATqCDReiACACEOuEAEIdcK24VtwnbhO3BS+RL41TZ8apt/hh9dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddeA=';

const FRAME_BACKGROUNDS = Object.freeze([
	Object.freeze([240, 16, 16]),
	Object.freeze([16, 240, 16]),
	Object.freeze([16, 16, 240]),
	Object.freeze([240, 240, 16]),
]);

const FFMPEG_ARGUMENTS = Object.freeze([
	'-f', 'rawvideo',
	'-pixel_format', 'rgb24',
	'-video_size', '256x128',
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
	width: 256,
	height: 128,
	rawByteLength: 393_216,
	rawSha256: '6e2ed29cdfc616120eae644f48df7ec6d5b52bc1c8cb5b9f852b5c6976237932',
	outputByteLength: 4_610,
	outputSha256: '7f9c32cf0550053cd25f53e5194ffb48ef41e2eac06946aa25eb75a935eebdde',
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
