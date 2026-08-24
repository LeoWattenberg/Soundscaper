/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Built-in audio deliveries an image sequence may publish beside its frames.
 *
 * BW64 is deliberately absent: that format is the ADM programme path, not an
 * ordinary companion mix. Custom FFmpeg is absent because a user-authored
 * command is not a closed, reproducible delivery choice. The remaining list is
 * the maintained built-in media-export catalog in its stable menu order.
 */
export const PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1 = Object.freeze([
	'wav', 'bwf', 'aiff', 'flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a',
] as const);

export type PlatformImageSequenceCompanionAudioFormatV1 =
	(typeof PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1)[number];

export type PlatformImageSequenceCompanionAudioSampleFormatV1 =
	'int16' | 'int20' | 'int24' | 'int32' | 'float32';

export interface PlatformImageSequenceCompanionAudioChoiceV1 {
	readonly formatId: PlatformImageSequenceCompanionAudioFormatV1;
	/** Null means the built-in compressed format's fixed encoder input policy. */
	readonly sampleFormat: PlatformImageSequenceCompanionAudioSampleFormatV1 | null;
}

export const DEFAULT_PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_V1:
	PlatformImageSequenceCompanionAudioChoiceV1 = Object.freeze({
		formatId: 'bwf',
		sampleFormat: 'int24',
	});

const SAMPLE_FORMATS: Readonly<Record<
	PlatformImageSequenceCompanionAudioFormatV1,
	readonly PlatformImageSequenceCompanionAudioSampleFormatV1[]
>> = Object.freeze({
	wav: sampleFormats('int16', 'int20', 'int24', 'float32'),
	bwf: sampleFormats('int16', 'int20', 'int24'),
	aiff: sampleFormats('int16', 'int24', 'int32', 'float32'),
	flac: sampleFormats('int16', 'int24'),
	mp3: sampleFormats(),
	'ogg-vorbis': sampleFormats(),
	opus: sampleFormats(),
	wavpack: sampleFormats('int16', 'int24', 'int32', 'float32'),
	mp2: sampleFormats(),
	'aac-m4a': sampleFormats(),
});

const DEFAULT_SAMPLE_FORMATS: Readonly<Partial<Record<
	PlatformImageSequenceCompanionAudioFormatV1,
	PlatformImageSequenceCompanionAudioSampleFormatV1
>>> = Object.freeze({
	wav: 'int24', bwf: 'int24', aiff: 'int24', flac: 'int24', wavpack: 'int24',
});

/** Snapshot one closed user choice; omission preserves the deterministic BWF/int24 default. */
export function snapshotPlatformImageSequenceCompanionAudioChoiceV1(
	value: unknown = DEFAULT_PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_V1,
): PlatformImageSequenceCompanionAudioChoiceV1 {
	const record = closedChoice(value);
	const formatId = format(record.formatId);
	const supported = SAMPLE_FORMATS[formatId];
	const sampleFormat = record.sampleFormat === undefined
		? DEFAULT_SAMPLE_FORMATS[formatId] ?? null
		: record.sampleFormat;
	if (supported.length === 0) {
		if (sampleFormat !== null) {
			throw new RangeError(`${formatId} companion audio does not expose a PCM sample format.`);
		}
		return Object.freeze({ formatId, sampleFormat: null });
	}
	if (typeof sampleFormat !== 'string'
		|| !(supported as readonly string[]).includes(sampleFormat)) {
		throw new RangeError(`${formatId} companion audio does not support ${String(sampleFormat)}.`);
	}
	return Object.freeze({
		formatId,
		sampleFormat: sampleFormat as PlatformImageSequenceCompanionAudioSampleFormatV1,
	});
}

function format(value: unknown): PlatformImageSequenceCompanionAudioFormatV1 {
	if (typeof value !== 'string'
		|| !(PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1 as readonly string[]).includes(value)) {
		throw new RangeError('Image-sequence companion audio must use a built-in non-ADM format.');
	}
	return value as PlatformImageSequenceCompanionAudioFormatV1;
}

function sampleFormats(
	...values: PlatformImageSequenceCompanionAudioSampleFormatV1[]
): readonly PlatformImageSequenceCompanionAudioSampleFormatV1[] {
	return Object.freeze(values);
}

function closedChoice(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Image-sequence companion audio choice must be a closed plain record.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	for (const key of Reflect.ownKeys(record)) {
		if (typeof key !== 'string' || !['formatId', 'sampleFormat'].includes(key)) {
			throw new TypeError('Image-sequence companion audio choice has an unsupported field.');
		}
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Image-sequence companion audio choice.${String(key)} must be data.`);
		}
	}
	if (!Object.hasOwn(record, 'formatId')) {
		throw new TypeError('Image-sequence companion audio choice requires formatId.');
	}
	return record;
}
