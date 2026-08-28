/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCaptureRuntimeAvailability,
	type CaptureRuntimeAvailability,
} from '../framescaper-capture-domain.ts';
import { captureSpoolCrossContextLockAvailable } from '../storage/capture-spool-operation-lock.ts';
import type { FramescaperBrowserRecorderFactoryOptions } from './framescaper-browser-recorder-factory.ts';
import {
	selectFramescaperVideoMimeType,
} from './framescaper-browser-capture-source.ts';
import type { FramescaperCaptureDesktopSelection } from './framescaper-capture-device-adapter.ts';
import { readProjectSchemaIdentity } from '../project-schema-identity.ts';

export interface FramescaperCaptureRuntimeProbeOptions {
	readonly availability: CaptureRuntimeAvailability;
	readonly productId: string;
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly embedded: boolean;
	readonly desktop: FramescaperCaptureDesktopSelection | null;
	readonly MediaRecorder: FramescaperBrowserRecorderFactoryOptions['MediaRecorder'];
	readonly TrackProcessor: FramescaperBrowserRecorderFactoryOptions['MediaStreamTrackProcessor'];
	readonly getAudioContext: FramescaperBrowserRecorderFactoryOptions['getAudioContext'];
	readonly recordingControllerFactory?: FramescaperBrowserRecorderFactoryOptions['recordingControllerFactory'];
	readonly AudioWorkletNode?: unknown;
	readonly captureSpoolLockAvailable?: () => boolean;
	readonly durable: boolean;
	readonly canonical: boolean;
	readonly videoProbe: boolean;
}

export async function completeFramescaperCaptureRuntimeProbe(
	input: Readonly<FramescaperCaptureRuntimeProbeOptions>,
): Promise<CaptureRuntimeAvailability> {
	if (input.productId !== 'framescaper') return unavailable('unsupported-platform');
	const identity = readProjectSchemaIdentity(input);
	if (identity.schemaFamily !== 'framescaper' || identity.schemaVersion !== 1) {
		return unavailable('unsupported-platform');
	}
	if (input.embedded && !input.desktop) return unavailable('embedded-route');
	if (input.availability.status !== 'available') return input.availability;
	if (!input.availability.sourceRoles.includes('display')) return unavailable('display-capture-unavailable');
	if (selectFramescaperVideoMimeType(input.MediaRecorder) === null) return unavailable('video-encoder-unavailable');
	let desktopStatus: Awaited<ReturnType<FramescaperCaptureDesktopSelection['status']>> | null = null;
	if (input.desktop) {
		desktopStatus = await input.desktop.status();
		if (!desktopStatus.available) return unavailable('unsupported-platform');
	}
	let context: Awaited<ReturnType<FramescaperBrowserRecorderFactoryOptions['getAudioContext']>>;
	try {
		context = await input.getAudioContext();
		if (!context || !Number.isFinite(context.sampleRate) || context.sampleRate <= 0) return unavailable('audio-packet-source-unavailable');
	} catch { return unavailable('audio-packet-source-unavailable'); }
	const worklet = typeof input.recordingControllerFactory === 'function' || (
		typeof (input.AudioWorkletNode ?? globalThis.AudioWorkletNode) === 'function'
		&& typeof context.audioWorklet?.addModule === 'function'
		&& typeof context.createMediaStreamSource === 'function'
	);
	if (typeof input.TrackProcessor !== 'function' && !worklet) return unavailable('audio-packet-source-unavailable');
	if (!(input.captureSpoolLockAvailable ?? captureSpoolCrossContextLockAvailable)()) {
		return unavailable('durable-storage-unavailable');
	}
	if (!input.durable) return unavailable('durable-storage-unavailable');
	if (!input.videoProbe) return unavailable('media-probe-unavailable');
	if (!input.canonical) return unavailable('durable-storage-unavailable');
	const sourceRoles = desktopStatus?.systemAudio === false
		? input.availability.sourceRoles.filter((role) => role !== 'system-audio')
		: input.availability.sourceRoles;
	return createCaptureRuntimeAvailability({ status: 'available', sourceRoles });
}

function unavailable(reason: Parameters<typeof createCaptureRuntimeAvailability>[0] extends infer _Value
	? 'embedded-route' | 'unsupported-platform' | 'display-capture-unavailable' | 'video-encoder-unavailable'
		| 'audio-packet-source-unavailable' | 'durable-storage-unavailable' | 'media-probe-unavailable'
	: never): CaptureRuntimeAvailability {
	return createCaptureRuntimeAvailability({ status: 'unavailable', reason, detail: null });
}
