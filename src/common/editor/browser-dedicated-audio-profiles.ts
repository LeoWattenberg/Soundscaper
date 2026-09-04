/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What each reviewed payload will and will not encode, and how a request's
 * settings reach it.
 *
 * Every dedicated format admits an exact geometry and an exact settings record,
 * and the two lossy formats that carry a bit-rate strategy — Audacity's four for
 * MP3 and its three VBR modes for Opus — name their choice here rather than in
 * the loader that only moves bytes across the WebAssembly boundary.
 */

import type {
	BrowserDedicatedAudioFormat, DedicatedAudioEncodeRequest,
} from './browser-dedicated-audio-codec.ts';

const MP3_BITRATES = new Set([32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]);
const MP2_BITRATES = new Set([32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]);
const OPUS_BITRATES = new Set([16, 24, 32, 48, 64, 80, 96, 112, 128, 160, 192, 256]);
const MAXIMUM_MP3_VBR_QUALITY = 9;
const MAXIMUM_MP3_PRESET = 3;
const MAXIMUM_OPUS_VBR_MODE = 2;
const MP3_RATE_MODE_CONSTANT = 0;
const MP3_RATE_MODE_AVERAGE = 1;
const MP3_RATE_MODE_VARIABLE = 2;
const MP3_RATE_MODE_PRESET = 3;

export function validateProfile(
	format: BrowserDedicatedAudioFormat,
	geometry: Readonly<{ frameCount: number; channelCount: number; sampleRate: number }>,
	settings: Readonly<Record<string, number>>,
): void {
	if (geometry.sampleRate < 8_000 || geometry.sampleRate > 192_000) {
		throw new RangeError('The dedicated codec sample rate must be between 8 and 192 kHz.');
	}
	if (geometry.channelCount > (format === 'mp3' || format === 'mp2' || format === 'opus'
		|| format === 'ogg-vorbis' ? 2 : 8)) {
		throw new RangeError(`The dedicated ${format} profile does not admit this channel count.`);
	}
	if ((format === 'mp3' || format === 'mp2')
		&& ![32_000, 44_100, 48_000].includes(geometry.sampleRate)) {
		throw new RangeError(`The dedicated ${format} profile requires 32, 44.1, or 48 kHz PCM.`);
	}
	if (format === 'opus' && geometry.sampleRate !== 48_000) {
		throw new RangeError('The dedicated Opus profile requires 48 kHz PCM.');
	}
	const maximumFrames = format === 'mp3' || format === 'mp2' ? 8_388_608 : 33_554_432;
	if (geometry.frameCount > maximumFrames) throw new RangeError(`The dedicated ${format} frame bound was exceeded.`);
	if (format === 'flac') exactIntegerSetting(settings, 'compressionLevel', 0, 8);
	else if (format === 'ogg-vorbis') exactIntegerSetting(settings, 'quality', 0, 10);
	else if (format === 'wavpack') exactIntegerSetting(settings, 'compressionLevel', 2, 2);
	else if (format === 'opus') validateOpusProfile(settings);
	else if (format === 'mp3') validateMp3Profile(geometry, settings);
	else {
		const bitrate = exactIntegerSetting(settings, 'bitrateKbps', 32, 384);
		admittedBitrate(bitrate, MP2_BITRATES, format);
		if (geometry.channelCount === 1 ? bitrate > 192 : bitrate < 64 || bitrate === 80) {
			throw new RangeError('The dedicated MP2 bitrate is outside its admitted channel tuple.');
		}
	}
}

export function encodeArguments(request: DedicatedAudioEncodeRequest): number[] {
	const common = [request.frameCount, request.channelCount];
	switch (request.format) {
		case 'flac': return [...common, request.sampleRate, request.settings.compressionLevel!];
		case 'mp3': return [...common, request.sampleRate, ...mp3RateArguments(request.settings)];
		case 'ogg-vorbis': return [...common, request.sampleRate, request.settings.quality!];
		case 'opus': return [...common, request.settings.bitrateKbps! * 1_000, request.settings.vbrMode!];
		case 'mp2': return [...common, request.sampleRate, request.settings.bitrateKbps!];
		case 'wavpack': throw new Error('WavPack uses its bounded chunk encoder.');
	}
}

function validateOpusProfile(settings: Readonly<Record<string, number>>): void {
	exactIntegerSettings(settings, ['bitrateKbps', 'vbrMode'], 'opus');
	if (!Number.isSafeInteger(settings.vbrMode)
		|| settings.vbrMode! < 0 || settings.vbrMode! > MAXIMUM_OPUS_VBR_MODE) {
		throw new RangeError('Dedicated audio setting vbrMode is outside its profile.');
	}
	if (!Number.isSafeInteger(settings.bitrateKbps)
		|| settings.bitrateKbps! < 16 || settings.bitrateKbps! > 256) {
		throw new RangeError('Dedicated audio setting bitrateKbps is outside its profile.');
	}
	admittedBitrate(settings.bitrateKbps!, OPUS_BITRATES, 'opus');
}

/**
 * MP3 admits one bit-rate strategy per request, named by the request's only
 * setting key. The four strategies are Audacity's: `preset` selects a named
 * LAME preset 0 (Excessive) through 3 (Medium), `vbrQuality` LAME's variable
 * rate at quality 0 (best) through 9, `averageBitrateKbps` its average rate,
 * and `bitrateKbps` its constant rate. `exactIntegerSetting` rejects a request
 * that names more than one.
 */
function validateMp3Profile(
	geometry: Readonly<{ frameCount: number; channelCount: number; sampleRate: number }>,
	settings: Readonly<Record<string, number>>,
): void {
	if (Object.hasOwn(settings, 'preset')) {
		exactIntegerSetting(settings, 'preset', 0, MAXIMUM_MP3_PRESET);
		return;
	}
	if (Object.hasOwn(settings, 'vbrQuality')) {
		exactIntegerSetting(settings, 'vbrQuality', 0, MAXIMUM_MP3_VBR_QUALITY);
		return;
	}
	const key = Object.hasOwn(settings, 'averageBitrateKbps') ? 'averageBitrateKbps' : 'bitrateKbps';
	const bitrate = exactIntegerSetting(settings, key, 32, 320);
	admittedBitrate(bitrate, MP3_BITRATES, 'mp3');
	const minimum = geometry.sampleRate === 32_000
		? geometry.channelCount === 1 ? 40 : 48
		: geometry.sampleRate === 44_100 && geometry.channelCount === 1 ? 56 : 64;
	if (bitrate < minimum) throw new RangeError('The dedicated MP3 bitrate is outside its admitted tuple.');
}

/** Marshal the chosen strategy into the payload's rate-mode, rate-value pair. */
function mp3RateArguments(settings: Readonly<Record<string, number>>): number[] {
	if (Object.hasOwn(settings, 'preset')) return [MP3_RATE_MODE_PRESET, settings.preset!];
	if (Object.hasOwn(settings, 'vbrQuality')) return [MP3_RATE_MODE_VARIABLE, settings.vbrQuality!];
	if (Object.hasOwn(settings, 'averageBitrateKbps')) {
		return [MP3_RATE_MODE_AVERAGE, settings.averageBitrateKbps!];
	}
	return [MP3_RATE_MODE_CONSTANT, settings.bitrateKbps!];
}

function exactIntegerSetting(
	settings: Readonly<Record<string, number>>,
	key: string,
	minimum: number,
	maximum: number,
): number {
	const keys = Reflect.ownKeys(settings);
	const descriptor = Object.getOwnPropertyDescriptor(settings, key);
	const value = descriptor?.value;
	if (keys.length !== 1 || keys[0] !== key || descriptor === undefined
		|| !Object.hasOwn(descriptor, 'value') || !Number.isSafeInteger(value)
		|| Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`Dedicated audio setting ${key} is outside its profile.`);
	}
	return Number(value);
}

/** A request states exactly the settings its profile names, and nothing else. */
function exactIntegerSettings(
	settings: Readonly<Record<string, number>>,
	keys: readonly string[],
	format: string,
): void {
	const own = Reflect.ownKeys(settings);
	if (own.length !== keys.length || keys.some((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(settings, key);
		return descriptor === undefined || !Object.hasOwn(descriptor, 'value');
	})) throw new RangeError(`Dedicated ${format} settings are outside their profile.`);
}

function admittedBitrate(
	bitrate: number,
	admitted: ReadonlySet<number>,
	format: BrowserDedicatedAudioFormat,
): void {
	if (!admitted.has(bitrate)) throw new RangeError(`The dedicated ${format} bitrate is unsupported.`);
}

