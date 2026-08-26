/* SPDX-License-Identifier: AGPL-3.0-only */

/** Production AssistanceShotRuntimeAdapter for one authenticated external FFmpeg pair. */

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, isAbsolute, normalize } from 'node:path';

import type { SpeechRuntimeStatus } from './assistance-speech-runtime.ts';
import type {
	AssistanceShotDetectionRequest,
	AssistanceShotRuntimeAdapter,
} from './assistance-shot-runtime.ts';
import {
	isExternalFfmpegExecutablePairAdmission,
	type ExternalFfmpegExecutablePairAdmission,
} from './external-ffmpeg-executable-pair-admission.ts';
import type {
	ExternalFfmpegPreferenceService,
	ExternalFfmpegRuntimeAdmission,
	ExternalFfmpegRuntimeInvalidationReason,
} from './external-ffmpeg-preference-service.ts';
import {
	createExternalFfmpegShotDetector,
	ExternalFfmpegShotDetectorError,
	type ExternalFfmpegShotDetector,
	type ExternalFfmpegShotDetectorErrorReason,
	type ExternalFfmpegShotDetectorOptions,
} from './external-ffmpeg-shot-detector.ts';

export const ASSISTANCE_EXTERNAL_FFMPEG_SHOT_RUNTIME_MODULE_ID = 'external-ffmpeg-scdet';

/** Capabilities used by the detector's fixed canary and source grammar. */
export const ASSISTANCE_EXTERNAL_FFMPEG_SHOT_REQUIRED_CAPABILITIES = Object.freeze({
	demuxers: Object.freeze(['lavfi']),
	muxers: Object.freeze(['null']),
	filters: Object.freeze(['color', 'concat', 'metadata', 'scdet', 'showinfo']),
});

type ShotPreferenceAuthority = Pick<
	ExternalFfmpegPreferenceService,
	'admission' | 'invalidateAdmission'
>;

export interface ExternalFfmpegAssistanceShotRuntimeOptions {
	readonly preferences: ShotPreferenceAuthority;
	/** Test seam; production always uses the fixed detector factory. */
	readonly createDetector?: (options: ExternalFfmpegShotDetectorOptions) => ExternalFfmpegShotDetector;
}

type InspectedAdmission =
	| Readonly<{ readonly status: 'absent' }>
	| Readonly<{
		readonly status: 'invalid-identity' | 'missing-capabilities';
		readonly admission: ExternalFfmpegRuntimeAdmission;
	}>
	| Readonly<{
		readonly status: 'available';
		readonly admission: ExternalFfmpegRuntimeAdmission;
		readonly pair: ExternalFfmpegExecutablePairAdmission;
	}>;

const OPTION_KEYS = new Set(['preferences', 'createDetector']);
const REQUEST_KEYS = new Set(['videoPath', 'signal']);
const SHA256 = /^[0-9a-f]{64}$/u;
const CAPABILITY_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const QUALIFICATION_UNAVAILABLE = new Set<ExternalFfmpegShotDetectorErrorReason>([
	'canary-failed', 'executable-unavailable', 'identity-changed', 'metadata-invalid',
	'metadata-limit', 'process-failed', 'process-signalled', 'spawn-failed',
	'stderr-limit', 'timeout',
]);
const DETECTION_UNAVAILABLE = new Set<ExternalFfmpegShotDetectorErrorReason>([
	'executable-unavailable', 'identity-changed', 'spawn-failed',
]);

/**
 * Bind shot detection to the preference service's current main-only admission.
 * Every request gets a new detector so its canary qualification cannot be reused
 * after either the staged source authority or executable admission changes.
 */
export function createExternalFfmpegAssistanceShotRuntimeAdapter(
	options: ExternalFfmpegAssistanceShotRuntimeOptions,
): AssistanceShotRuntimeAdapter {
	validateOptions(options);
	const preferences = options.preferences;
	const createDetector = options.createDetector ?? createExternalFfmpegShotDetector;

	return Object.freeze({
		status(): Promise<SpeechRuntimeStatus> {
			const inspected = inspectAdmission(preferences.admission());
			return Promise.resolve(statusFor(inspected.status));
		},

		async detect(
			request: AssistanceShotDetectionRequest,
		) {
			const normalized = normalizeRequest(request);
			throwIfCancelled(normalized.signal);
			const inspected = inspectAdmission(preferences.admission());
			if (inspected.status === 'absent') return null;
			if (inspected.status !== 'available') {
				await preferences.invalidateAdmission(
					inspected.admission,
					'identity-changed',
				);
				return null;
			}
			const { admission, pair } = inspected;
			const detector = createDetector({
				pair,
				workingDirectory: dirname(normalized.videoPath),
				digestExecutable: sha256File,
			});

			try {
				await detector.qualify(signalOptions(normalized.signal));
				throwIfCancelled(normalized.signal);
			} catch (error) {
				throwIfCancelled(normalized.signal);
				if (!isDetectorReason(error, QUALIFICATION_UNAVAILABLE)) throw error;
				await preferences.invalidateAdmission(admission, invalidationReason(error.reason));
				return null;
			}
			if (preferences.admission() !== admission) return null;

			try {
				const result = await detector.detect(Object.freeze({
					sourcePath: normalized.videoPath,
					...(normalized.signal ? { signal: normalized.signal } : {}),
				}));
				throwIfCancelled(normalized.signal);
				return preferences.admission() === admission ? result : null;
			} catch (error) {
				throwIfCancelled(normalized.signal);
				if (!isDetectorReason(error, DETECTION_UNAVAILABLE)) throw error;
				await preferences.invalidateAdmission(admission, invalidationReason(error.reason));
				return null;
			}
		},
	});
}

function inspectAdmission(admission: ExternalFfmpegRuntimeAdmission | null): InspectedAdmission {
	if (admission === null) return Object.freeze({ status: 'absent' });
	let pair: ExternalFfmpegExecutablePairAdmission;
	try {
		pair = Object.freeze({
			executablePath: admission.executablePath,
			ffmpegSha256: admission.identity.ffmpegSha256,
			ffprobePath: admission.identity.ffprobePath,
			ffprobeSha256: admission.identity.ffprobeSha256,
			executablePairClosureSha256: admission.identity.executablePairClosureSha256,
		});
	} catch {
		return Object.freeze({ status: 'invalid-identity', admission });
	}
	if (!isExternalFfmpegExecutablePairAdmission(pair)
		|| typeof admission.version !== 'string' || admission.version.length === 0
		|| admission.version !== admission.identity.version
		|| typeof admission.capabilityGeneration !== 'string'
		|| !SHA256.test(admission.capabilityGeneration)) {
		return Object.freeze({ status: 'invalid-identity', admission });
	}
	if (!hasRequiredCapabilities(admission.capabilities)) {
		return Object.freeze({ status: 'missing-capabilities', admission });
	}
	return Object.freeze({ status: 'available', admission, pair });
}

function hasRequiredCapabilities(value: unknown): boolean {
	if (!plainObject(value)) return false;
	const capabilities = value as Record<string, unknown>;
	for (const key of ['encoders', 'decoders', 'muxers', 'demuxers', 'filters']) {
		if (!capabilityList(capabilities[key])) return false;
	}
	return ASSISTANCE_EXTERNAL_FFMPEG_SHOT_REQUIRED_CAPABILITIES.demuxers
		.every((item) => (capabilities.demuxers as readonly string[]).includes(item))
		&& ASSISTANCE_EXTERNAL_FFMPEG_SHOT_REQUIRED_CAPABILITIES.muxers
			.every((item) => (capabilities.muxers as readonly string[]).includes(item))
		&& ASSISTANCE_EXTERNAL_FFMPEG_SHOT_REQUIRED_CAPABILITIES.filters
			.every((item) => (capabilities.filters as readonly string[]).includes(item));
}

function capabilityList(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.length <= 65_536
		&& value.every((item) => typeof item === 'string' && CAPABILITY_TOKEN.test(item));
}

function statusFor(status: InspectedAdmission['status']): SpeechRuntimeStatus {
	let reason: string | null = null;
	if (status === 'absent') reason = 'External FFmpeg has not been admitted.';
	if (status === 'invalid-identity') reason = 'The admitted external FFmpeg executable-pair identity is invalid.';
	if (status === 'missing-capabilities') reason = 'The admitted external FFmpeg lacks required shot-detection capabilities.';
	return Object.freeze({
		available: status === 'available',
		reason,
		moduleId: ASSISTANCE_EXTERNAL_FFMPEG_SHOT_RUNTIME_MODULE_ID,
	});
}

function normalizeRequest(request: AssistanceShotDetectionRequest): AssistanceShotDetectionRequest {
	if (!plainObject(request)
		|| Object.keys(request).some((key) => !REQUEST_KEYS.has(key))
		|| typeof request.videoPath !== 'string' || !isAbsolute(request.videoPath)
		|| request.videoPath.length > 4_096 || request.videoPath.includes('\0')
		|| request.signal !== undefined && !(request.signal instanceof AbortSignal)) {
		throw new TypeError('An exact absolute staged video path is required for shot detection.');
	}
	const videoPath = normalize(request.videoPath);
	if (videoPath === dirname(videoPath)) {
		throw new TypeError('The staged shot-detection source must name a file.');
	}
	return Object.freeze({ videoPath, ...(request.signal ? { signal: request.signal } : {}) });
}

function signalOptions(signal: AbortSignal | undefined): Readonly<{ readonly signal?: AbortSignal }> {
	return Object.freeze(signal ? { signal } : {});
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
	if (!signal?.aborted) return;
	throw signal.reason ?? new Error('External FFmpeg shot detection was cancelled.');
}

function isDetectorReason<T extends ExternalFfmpegShotDetectorErrorReason>(
	error: unknown,
	reasons: ReadonlySet<T>,
): error is ExternalFfmpegShotDetectorError & Readonly<{ readonly reason: T }> {
	return error instanceof ExternalFfmpegShotDetectorError
		&& reasons.has(error.reason as T);
}

function invalidationReason(
	reason: ExternalFfmpegShotDetectorErrorReason,
): ExternalFfmpegRuntimeInvalidationReason {
	return reason === 'executable-unavailable' || reason === 'spawn-failed'
		? 'executable-unavailable'
		: 'identity-changed';
}

async function sha256File(path: string): Promise<string> {
	const handle = await open(path, fsConstants.O_RDONLY);
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile()) throw new Error('The admitted external FFmpeg path is not a regular file.');
		const hash = createHash('sha256');
		const buffer = Buffer.alloc(64 * 1_024);
		let position = 0;
		for (;;) {
			const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
			if (bytesRead === 0) break;
			hash.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		return hash.digest('hex');
	} finally {
		await handle.close();
	}
}

function validateOptions(options: ExternalFfmpegAssistanceShotRuntimeOptions): void {
	if (!plainObject(options)
		|| Object.keys(options).some((key) => !OPTION_KEYS.has(key))
		|| !plainObject(options.preferences)
		|| typeof options.preferences.admission !== 'function'
		|| typeof options.preferences.invalidateAdmission !== 'function'
		|| options.createDetector !== undefined && typeof options.createDetector !== 'function') {
		throw new TypeError('External FFmpeg Assistance shot runtime options are invalid.');
	}
}

function plainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}
