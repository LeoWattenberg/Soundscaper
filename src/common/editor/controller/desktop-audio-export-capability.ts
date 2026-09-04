/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact desktop codec gate run after export planning and before rendering. */

import type {
	DesktopAudioCodecCapabilityQuery,
	DesktopAudioCodecCapabilityResult,
	DesktopAudioCodecCapabilitySettings,
} from '../../../../desktop/desktop-audio-codec-capability-contract.ts';
import { DESKTOP_AUDIO_CODEC_FORMATS } from '../../../../desktop/desktop-audio-codec-operation-contract.ts';
import {
	desktopAudioCodecCapabilityReason,
	queryDesktopAudioCodecCapability,
} from '../desktop-audio-codec-capabilities.ts';
import { mp3CodecRateSettings, opusCodecRateSettings } from '../media-export.js';
import {
	DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER,
	isDesktopMainAudioCodecRuntime,
} from '../desktop-main-audio-codec-runtime-marker.ts';

interface DesktopAudioExportPlan {
	readonly format: unknown;
	readonly sampleRate: unknown;
	readonly channelCount: unknown;
	readonly encoding?: Readonly<{
		readonly compressionLevel?: unknown;
		readonly bitDepth?: unknown;
		readonly sampleFormat?: unknown;
		readonly quality?: unknown;
		readonly bitRate?: unknown;
		readonly bitRateMode?: unknown;
		readonly bitRatePreset?: unknown;
		readonly vbrQuality?: unknown;
		readonly averageBitRate?: unknown;
		readonly vbrMode?: unknown;
	}>;
}

interface DesktopAudioExportCodecRuntime {
	readonly [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true;
	desktopAudioCodecCapabilities(query: DesktopAudioCodecCapabilityQuery): Promise<DesktopAudioCodecCapabilityResult>;
}

const FORMATS = new Set<string>(DESKTOP_AUDIO_CODEC_FORMATS);

export async function assertDesktopAudioExportCapability(
	runtime: unknown,
	planValue: DesktopAudioExportPlan,
): Promise<void> {
	if (!isDesktopMainAudioCodecRuntime(runtime)) return;
	if (!FORMATS.has(String(planValue?.format))) return;
	const plan = audioPlan(planValue);
	const query = (runtime as Partial<DesktopAudioExportCodecRuntime>).desktopAudioCodecCapabilities;
	if (typeof query !== 'function') {
		throw new Error(desktopAudioCodecCapabilityReason('configure-external-ffmpeg'));
	}
	const capability = await queryDesktopAudioCodecCapability(
		(request) => Reflect.apply(query, runtime, [request]),
		{
			operation: 'audio-encode', format: plan.format as never,
			sampleRate: plan.sampleRate, channelCount: plan.channelCount,
			settings: plan.settings,
		},
	);
	if (!capability.available) throw new Error(desktopAudioCodecCapabilityReason(capability.reason));
}

function audioPlan(value: DesktopAudioExportPlan): Readonly<{
	readonly format: string; readonly sampleRate: number; readonly channelCount: number;
	readonly settings: DesktopAudioCodecCapabilitySettings;
}> {
	if (!value || typeof value !== 'object' || typeof value.format !== 'string'
		|| !Number.isSafeInteger(value.sampleRate) || !Number.isSafeInteger(value.channelCount)) {
		throw new TypeError('The planned desktop audio export geometry is invalid.');
	}
	const compressionLevel = value.format === 'wavpack' || value.format === 'flac'
		? Number(value.encoding?.compressionLevel)
		: null;
	if (compressionLevel !== null && (!Number.isSafeInteger(compressionLevel)
		|| compressionLevel < 0 || compressionLevel > (value.format === 'flac' ? 12 : 8))) {
		throw new TypeError(`The planned desktop ${value.format === 'flac' ? 'FLAC' : 'WavPack'} compression level is invalid.`);
	}
	const bitDepth = value.format === 'flac' ? Number(value.encoding?.bitDepth) : null;
	const sampleFormat = value.format === 'flac' ? String(value.encoding?.sampleFormat ?? '') : null;
	if (value.format === 'flac' && ((bitDepth !== 16 && bitDepth !== 24)
		|| sampleFormat !== `int${String(bitDepth)}`)) {
		throw new TypeError('The planned desktop FLAC PCM format is invalid.');
	}
	let settings: DesktopAudioCodecCapabilitySettings;
	if (value.format === 'flac') settings = Object.freeze({
		compressionLevel: compressionLevel!, bitDepth: bitDepth as 16 | 24,
	});
	else if (value.format === 'wavpack') settings = Object.freeze({ compressionLevel: compressionLevel! });
	else if (value.format === 'ogg-vorbis') settings = Object.freeze({
		quality: plannedInteger(value.encoding?.quality, 0, 10, 'Vorbis quality'),
	});
	/* MP3 asks about the strategy the delivery actually chose, not just a bitrate. */
	else if (value.format === 'mp3') {
		settings = mp3CodecRateSettings(value.encoding ?? {}) as DesktopAudioCodecCapabilitySettings;
	} else if (value.format === 'opus') {
		settings = opusCodecRateSettings(value.encoding ?? {}) as DesktopAudioCodecCapabilitySettings;
	} else settings = Object.freeze({
		bitrateKbps: plannedInteger(value.encoding?.bitRate, 1, 1_000, `${value.format} bitrate`),
	});
	return Object.freeze({
		format: value.format,
		sampleRate: Number(value.sampleRate),
		channelCount: Number(value.channelCount),
		settings,
	});
}

function plannedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new TypeError(`The planned desktop ${label} is invalid.`);
	}
	return number;
}
