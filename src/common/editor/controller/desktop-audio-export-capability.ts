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
import {
	DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER,
	isDesktopMainAudioCodecRuntime,
} from '../desktop-main-audio-codec-runtime-marker.ts';

interface DesktopAudioExportPlan {
	readonly format: unknown;
	readonly sampleRate: unknown;
	readonly channelCount: unknown;
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
}

function audioPlan(value: DesktopAudioExportPlan): Readonly<{
	readonly format: string; readonly sampleRate: number; readonly channelCount: number;
}> {
	if (!value || typeof value !== 'object' || typeof value.format !== 'string'
		|| !Number.isSafeInteger(value.sampleRate) || !Number.isSafeInteger(value.channelCount)) {
		throw new TypeError('The planned desktop audio export geometry is invalid.');
	}
	return Object.freeze({
		format: value.format,
		sampleRate: Number(value.sampleRate),
		channelCount: Number(value.channelCount),
	});
}
