/* SPDX-License-Identifier: AGPL-3.0-only */

/** One exact browser audio profile shared by capability probes and encoders. */

export type BrowserWebCodecsAudioCodec = 'aac' | 'opus';

export const BROWSER_AAC_WEB_CODECS_CODEC = 'mp4a.40.2';
export const BROWSER_OPUS_WEB_CODECS_CODEC = 'opus';

export interface BrowserWebCodecsAudioGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly bitrate: number;
}

export interface BrowserAudioEncoderProbe {
	isConfigSupported?(config: Readonly<Record<string, unknown>>): Promise<Readonly<{ supported?: boolean }>>;
}

export function browserWebCodecsAudioConfiguration(
	codec: BrowserWebCodecsAudioCodec,
	geometry: BrowserWebCodecsAudioGeometry,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		codec: codec === 'aac' ? BROWSER_AAC_WEB_CODECS_CODEC : BROWSER_OPUS_WEB_CODECS_CODEC,
		sampleRate: positiveInteger(geometry.sampleRate, 'sample rate'),
		numberOfChannels: positiveInteger(geometry.channelCount, 'channel count'),
		bitrate: positiveInteger(geometry.bitrate, 'bitrate'),
	});
}

export function browserWebCodecsAudioFullCodecString(codec: BrowserWebCodecsAudioCodec): string {
	return codec === 'aac' ? BROWSER_AAC_WEB_CODECS_CODEC : BROWSER_OPUS_WEB_CODECS_CODEC;
}

export async function probeBrowserWebCodecsAudioEncoding(
	codec: BrowserWebCodecsAudioCodec,
	geometry: BrowserWebCodecsAudioGeometry,
	encoder: BrowserAudioEncoderProbe | undefined = (
		globalThis as Readonly<Record<string, unknown>>
	).AudioEncoder as BrowserAudioEncoderProbe | undefined,
): Promise<boolean> {
	if (typeof encoder?.isConfigSupported !== 'function') return false;
	try {
		return (await encoder.isConfigSupported(
			browserWebCodecsAudioConfiguration(codec, geometry),
		)).supported === true;
	} catch {
		return false;
	}
}

function positiveInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new RangeError(`Browser WebCodecs audio ${label} must be a positive integer.`);
	}
	return value;
}
