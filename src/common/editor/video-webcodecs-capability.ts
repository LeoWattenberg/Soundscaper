/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Whether this browser can encode a given delivery, and as what.
 *
 * The plan never changes because WebCodecs is or is not present: it states a
 * canvas, a rate, and a quality tier, and this decides only which encoder is
 * asked to produce those bytes. An unqualified browser is therefore a fallback
 * to the shipped FFmpeg, reported per delivery, and never a failed export.
 *
 * The codec string has to carry a level, and the level has to admit the canvas
 * and rate the plan asked for — a level that does not is the encoder quietly
 * producing something other than the delivery. Both tables below are the
 * specifications' own limits rather than a guess at what browsers accept, so a
 * canvas past every level is refused here with the reason rather than at an
 * encoder that would only say "unsupported".
 */

export type VideoWebCodecsTier = 'webcodecs' | 'ffmpeg';

export interface VideoWebCodecsCanvas {
	readonly width: number;
	readonly height: number;
	/** Exact rational rate; the level tables are defined against samples per second. */
	readonly frameRate: { readonly num: number; readonly den: number };
}

export interface VideoWebCodecsSupport {
	readonly tier: VideoWebCodecsTier;
	readonly codec: string | null;
	/** Why the WebCodecs tier was not chosen, or null when it was. */
	readonly reason: string | null;
}

interface EncoderConfigProbe {
	isConfigSupported?(config: Readonly<Record<string, unknown>>): Promise<{ supported?: boolean }>;
}

/**
 * H.264 levels as Annex A defines them: macroblocks per second, and frame size
 * in macroblocks. The `code` is the level_idc byte the codec string spells.
 *
 * Levels that add nothing but a bitrate ceiling are left out, since the smallest
 * level covering a picture and a rate is always the earlier of the pair: 4.1
 * carries 4.0's macroblock limits, and 5.1 carries 5.0's frame size.
 */
const H264_LEVELS = Object.freeze([
	Object.freeze({ code: '1e', macroblocksPerSecond: 40_500, macroblocksPerFrame: 1_620 }),
	Object.freeze({ code: '1f', macroblocksPerSecond: 108_000, macroblocksPerFrame: 3_600 }),
	Object.freeze({ code: '20', macroblocksPerSecond: 216_000, macroblocksPerFrame: 5_120 }),
	Object.freeze({ code: '28', macroblocksPerSecond: 245_760, macroblocksPerFrame: 8_192 }),
	Object.freeze({ code: '2a', macroblocksPerSecond: 522_240, macroblocksPerFrame: 8_704 }),
	Object.freeze({ code: '32', macroblocksPerSecond: 589_824, macroblocksPerFrame: 22_080 }),
	Object.freeze({ code: '33', macroblocksPerSecond: 983_040, macroblocksPerFrame: 36_864 }),
	Object.freeze({ code: '34', macroblocksPerSecond: 2_073_600, macroblocksPerFrame: 36_864 }),
	Object.freeze({ code: '3c', macroblocksPerSecond: 4_177_920, macroblocksPerFrame: 139_264 }),
	Object.freeze({ code: '3d', macroblocksPerSecond: 8_355_840, macroblocksPerFrame: 139_264 }),
	Object.freeze({ code: '3e', macroblocksPerSecond: 16_711_680, macroblocksPerFrame: 139_264 }),
]);

/** VP9 levels: luma samples per second, and luma samples per picture. */
const VP9_LEVELS = Object.freeze([
	Object.freeze({ code: '10', samplesPerSecond: 829_440, samplesPerPicture: 36_864 }),
	Object.freeze({ code: '11', samplesPerSecond: 2_764_800, samplesPerPicture: 73_728 }),
	Object.freeze({ code: '20', samplesPerSecond: 4_608_000, samplesPerPicture: 122_880 }),
	Object.freeze({ code: '21', samplesPerSecond: 9_216_000, samplesPerPicture: 245_760 }),
	Object.freeze({ code: '30', samplesPerSecond: 20_736_000, samplesPerPicture: 552_960 }),
	Object.freeze({ code: '31', samplesPerSecond: 36_864_000, samplesPerPicture: 983_040 }),
	Object.freeze({ code: '40', samplesPerSecond: 83_558_400, samplesPerPicture: 2_228_224 }),
	Object.freeze({ code: '41', samplesPerSecond: 160_432_128, samplesPerPicture: 2_228_224 }),
	Object.freeze({ code: '50', samplesPerSecond: 311_951_360, samplesPerPicture: 8_912_896 }),
	Object.freeze({ code: '51', samplesPerSecond: 588_251_136, samplesPerPicture: 8_912_896 }),
	Object.freeze({ code: '52', samplesPerSecond: 1_176_502_272, samplesPerPicture: 8_912_896 }),
	Object.freeze({ code: '60', samplesPerSecond: 1_176_502_272, samplesPerPicture: 35_651_584 }),
	Object.freeze({ code: '61', samplesPerSecond: 2_353_004_544, samplesPerPicture: 35_651_584 }),
	Object.freeze({ code: '62', samplesPerSecond: 4_706_009_088, samplesPerPicture: 35_651_584 }),
]);

/** Main profile, no constraint flags: the SDR 8:4:2:0 baseline every encoder has. */
const H264_PROFILE = '4d00';
/** Profile 0, 8-bit 4:2:0 — the fenced tier owns everything wider. */
const VP9_PROFILE_AND_DEPTH = Object.freeze({ profile: '00', bitDepth: '08' });

/**
 * The codec string a delivery needs, or null when no level admits it.
 *
 * The smallest level that covers both the picture and the rate is chosen, since
 * an unnecessarily high level narrows what can decode the result for no gain.
 */
export function resolveVideoWebCodecsCodec(
	videoCodec: string,
	canvas: VideoWebCodecsCanvas,
): string | null {
	const { width, height, frameRate } = canvasGeometry(canvas);
	const perSecond = frameRate.num / frameRate.den;
	if (videoCodec === 'h264') {
		const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
		const level = H264_LEVELS.find((candidate) => (
			macroblocks <= candidate.macroblocksPerFrame
			&& macroblocks * perSecond <= candidate.macroblocksPerSecond
		));
		return level ? `avc1.${H264_PROFILE}${level.code}` : null;
	}
	if (videoCodec === 'vp9') {
		const samples = width * height;
		const level = VP9_LEVELS.find((candidate) => (
			samples <= candidate.samplesPerPicture
			&& samples * perSecond <= candidate.samplesPerSecond
		));
		return level
			? `vp09.${VP9_PROFILE_AND_DEPTH.profile}.${level.code}.${VP9_PROFILE_AND_DEPTH.bitDepth}`
			: null;
	}
	return null;
}

/**
 * Which tier will encode this delivery.
 *
 * Every "no" carries its reason, because a delivery that quietly took the
 * slower path with no explanation is the reporting failure this milestone's
 * gate is about. The probe is the browser's own `isConfigSupported`, so a
 * browser that ships the API but not the codec is a fallback rather than an
 * error at the first frame.
 */
export async function resolveVideoWebCodecsSupport(
	videoCodec: string,
	canvas: VideoWebCodecsCanvas,
	encoder: EncoderConfigProbe | undefined,
): Promise<VideoWebCodecsSupport> {
	if (typeof encoder?.isConfigSupported !== 'function') {
		return fallback('This browser has no WebCodecs video encoder.');
	}
	const codec = resolveVideoWebCodecsCodec(videoCodec, canvas);
	if (!codec) {
		return fallback(`No ${videoCodec} level admits a ${canvas.width}x${canvas.height} delivery at this rate.`);
	}
	const { width, height, frameRate } = canvasGeometry(canvas);
	let probed: { supported?: boolean };
	try {
		probed = await encoder.isConfigSupported(Object.freeze({
			codec,
			width,
			height,
			framerate: frameRate.num / frameRate.den,
			// Annex B for H.264 and raw frames for VP9 are what the elementary
			// stream remux reads; a description-bearing variant would not be.
			...(videoCodec === 'h264' ? { avc: Object.freeze({ format: 'annexb' }) } : {}),
		}));
	} catch (error) {
		return fallback(`This browser refused the ${codec} configuration: ${errorText(error)}`);
	}
	if (!probed?.supported) return fallback(`This browser does not encode ${codec}.`);
	return Object.freeze({ tier: 'webcodecs' as const, codec, reason: null });
}

function fallback(reason: string): VideoWebCodecsSupport {
	return Object.freeze({ tier: 'ffmpeg' as const, codec: null, reason });
}

function canvasGeometry(canvas: VideoWebCodecsCanvas) {
	const width = positiveInteger(canvas?.width, 'canvas width');
	const height = positiveInteger(canvas?.height, 'canvas height');
	const num = positiveInteger(canvas?.frameRate?.num, 'canvas frame rate numerator');
	const den = positiveInteger(canvas?.frameRate?.den, 'canvas frame rate denominator');
	return { width, height, frameRate: { num, den } };
}

function positiveInteger(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return value;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
