/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact desktop codec gate run after export planning and before rendering. */

import type {
	DesktopAudioCodecCapabilityQuery,
	DesktopAudioCodecCapabilityResult,
} from '../../../../desktop/desktop-audio-codec-capability-contract.ts';
import { DESKTOP_AUDIO_CODEC_FORMATS } from '../../../../desktop/desktop-audio-codec-operation-contract.ts';
import {
	desktopAudioCodecCapabilityReason,
	queryDesktopAudioCodecCapability,
} from '../desktop-audio-codec-capabilities.ts';
import { DESKTOP_BUNDLED_WAVPACK_COMPRESSION_LEVEL } from '../desktop-wavpack-codec-profile.ts';
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
	const plan = audioPlan(planValue);
	if (!FORMATS.has(plan.format)) return;
	const query = (runtime as Partial<DesktopAudioExportCodecRuntime>).desktopAudioCodecCapabilities;
	if (typeof query !== 'function') {
		throw new Error(desktopAudioCodecCapabilityReason('configure-external-ffmpeg'));
	}
	const capability = await queryDesktopAudioCodecCapability(
		(request) => Reflect.apply(query, runtime, [request]),
		{
			operation: 'audio-encode', format: plan.format as never,
			sampleRate: plan.sampleRate, channelCount: plan.channelCount,
		},
	);
	if (!capability.available) throw new Error(desktopAudioCodecCapabilityReason(capability.reason));
	if (plan.format === 'wavpack' && capability.provider === 'bundled'
		&& plan.compressionLevel !== DESKTOP_BUNDLED_WAVPACK_COMPRESSION_LEVEL) {
		throw new Error('The bundled WavPack provider supports only compression level 2 (reviewed fast mode).');
	}
	if (plan.format === 'flac' && capability.provider === 'bundled') {
		if (plan.bitDepth !== 24 || plan.sampleFormat !== 'int24') {
			throw new Error('The bundled FLAC provider supports only explicitly converted signed 24-bit PCM.');
		}
		if (plan.compressionLevel === null || plan.compressionLevel > 8) {
			throw new Error('The bundled FLAC provider supports compression levels 0 through 8.');
		}
	}
}

function audioPlan(value: DesktopAudioExportPlan): Readonly<{
	readonly format: string; readonly sampleRate: number; readonly channelCount: number;
	readonly compressionLevel: number | null; readonly bitDepth: number | null;
	readonly sampleFormat: string | null;
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
	return Object.freeze({
		format: value.format,
		sampleRate: Number(value.sampleRate),
		channelCount: Number(value.channelCount),
		compressionLevel,
		bitDepth,
		sampleFormat,
	});
}
