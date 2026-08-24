/* SPDX-License-Identifier: AGPL-3.0-only */

/** Live startup canary for the target-native MP3 decoder, run through its production helper. */

import { createHash } from 'node:crypto';

import type {
	OperatingSystemCodecCanaryRequest,
	OperatingSystemCodecCanaryResult,
} from './os-codec-capability-adapter.ts';
import type {
	OperatingSystemAudioCodecOperationRunner,
	OperatingSystemAudioCodecTarget,
} from './os-audio-codec-operation-runner.ts';

export const OPERATING_SYSTEM_MP3_CANARY_SHA256 =
	'90971a846ba5d03488be96ada4f9ea6698aa47e7f487adfe65d606519b0270f2';

export interface OperatingSystemAudioCodecCanaryAdapter {
	runCanary(
		request: OperatingSystemCodecCanaryRequest,
		signal: AbortSignal,
	): Promise<OperatingSystemCodecCanaryResult>;
}

export interface OperatingSystemAudioCodecCanaryAdapterOptions {
	readonly target: OperatingSystemAudioCodecTarget;
	readonly runner: OperatingSystemAudioCodecOperationRunner;
}

/* Generated only as test media with digest-pinned mwader/static-ffmpeg 9.0
 * (sha256:b90574a4e2ae62b763c39c384526689e7eb435da6398f4fb3f6c3f1c6a14ce33).
 * The input was a 997 Hz, 48 kHz stereo, 50 ms source; this is not codec code. */
const CANARY_BASE64 =
	'//uUZAAAAqcRzRVlgAAAAA0goAABGJlFGrnqgAAAADSDAAAAApakA6AdAOXLLxpFuvADuLnBIpnsm/GcspvsmiSCg1dhQJAg'
	+ 'A0BoIhMMFi9evXr16+4OAgCAIOicH+CGc4Df3dPu6eD4IOqBMP5MEHYDP6QQ5d/d0gCAACUmEKH0YjYpz6jAEuBCBaZLpWRh'
	+ 'K3PhgmQNw3JhKiDAc08SqjItGINBEFEKACGnyCaWoAzs3wNoLUhxXwM+IsDDZCAyGPC6YnuBj0jAYGEIGIg+kklwMQCkAUHA'
	+ 'YRCAGEQsAgCsur8DAwHAwMDQsSACAQGAQEGy//g3CDYCH7BcMFoQm0MU/v/CwkQiC4YLhhSIZZDIor3/1eHzCCwzooEUCOoW'
	+ 'ULmIaLl/22Wq3cipSIsTx0mS6ZF42WXXfoVXQWDqYC47UuhswAQAfMAcAUzBOAJ8wWAGFMDuAJzAVgaMw9IWrMUUaFzQDRGA'
	+ 'xBcJaMCFANzAJgFMwHAA5EIAYhCaVLOt//uUZCEM800Lw49/AAAAAA0g4AABC0QtFFXsAAAAADSCgAAE+XHd8vKpN47YiVI3'
	+ '9f62tDiYtZGpc4rGHP5U0eWLvb4slE2Q+6OpU8qK0lmNqroblUC8wngPTAoCeMLYIAwzRPTGpEBMlDl86+QADDrGHMT8KUwT'
	+ 'wNwKAwCgMBARM1l8P76cGCwKsYnVRuXKroXJRd9TPbXXTZ3DourldnvLe77MWgAAABGGCkJEEEEFNEoMOiUGcCgBAwJUiC2M'
	+ 'CKAciCmMCh30wlwJTArb3OHsCkHAEHHKBGDgDAknsDAcNdgOwSAUNpt4GcIAcIMDhdCyMAIgAw0EO2Wv1gHBAJHBPwNjAFiG'
	+ 'uv+LEDY4CIIMkFsAtYf/7xxBdQFyBmg2wOYQb+n/h6gfQgwggJIQYR4JJ/r/+RYR4KIRYToLYRYToNAmkv/V6/X2FKDYJoXA'
	+ 'PBNC4B4JoZAlikOD//////////8likOC4IggWjYbD4fD4bDUagM0OWstUsD/ggAm//uUZG0ABg6BR2Z6gAAAAA0gwAAAGgFh'
	+ 'a7mdEhAAADSDAAAABmq3+YYTS/1/mKYgxQ6MC/5i35knIwycJ9X5//C6UxichRPtKYr/+KuTRQQq8JFJnGsBVZbErv//+CWA'
	+ 'ofMwrAqYLFTLJZbEt0sS////8AoAoPMofMCaBgkyRkwJSliX0sS7V////9OUAAS5ymJZUvcqUtLHsqseyqx7L/////QTLFLk'
	+ 'onLpLwpDMFLwpjY1tbrZbrZb//////9kqDqYzNUUUwl+oop1MVR9TqY7Wy3Wy3Wy3Wy3WkxMQU1FMy4xMDCqqqqqqqqqqqqq'
	+ 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
	+ 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
	+ '//uUZFGP8AAAaQcAAAgAAA0g4AABAAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
	+ 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
	+ 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
	+ 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
	+ 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
	+ 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const CANARY_BYTES = Buffer.from(CANARY_BASE64, 'base64');
if (CANARY_BYTES.byteLength !== 1_536 || sha256(CANARY_BYTES) !== OPERATING_SYSTEM_MP3_CANARY_SHA256) {
	throw new Error('The embedded OS MP3 canary failed its source digest.');
}

export function createOperatingSystemAudioCodecCanaryAdapter(
	options: OperatingSystemAudioCodecCanaryAdapterOptions,
): OperatingSystemAudioCodecCanaryAdapter {
	const target = targetId(options?.target);
	const runner = inspectedRunner(options?.runner);
	return Object.freeze({
		async runCanary(
			request: OperatingSystemCodecCanaryRequest,
			signal: AbortSignal,
		): Promise<OperatingSystemCodecCanaryResult> {
			if (!(signal instanceof AbortSignal)) throw new TypeError('The OS MP3 canary signal is invalid.');
			signal.throwIfAborted();
			if (!isReviewedMp3Canary(request, target)) return unavailable('canary-refused');
			const result = await runner.execute(Object.freeze({
				operation: 'audio-decode' as const,
				format: 'mp3' as const,
				input: new Uint8Array(CANARY_BYTES),
				sampleRate: null,
				channelCount: null,
				settings: Object.freeze({ sampleFormat: 'f32le' as const }),
				maximumOutputBytes: 1024 * 1024,
			}), { signal });
			signal.throwIfAborted();
			if (result.status !== 'executed') {
				return unavailable(result.reason === 'api-unavailable' ? 'api-unavailable'
					: result.reason === 'tuple-unsupported' ? 'tuple-unsupported' : 'canary-refused');
			}
			if (result.decodedGeometry.sampleRate !== 48_000
				|| result.decodedGeometry.channelCount !== 2
				|| result.decodedGeometry.frameCount < 1
				|| result.output.byteLength !== result.decodedGeometry.frameCount * 2
					* Float32Array.BYTES_PER_ELEMENT
				|| !finiteNonSilentFloat32(result.output)) return unavailable('canary-refused');
			const evidenceDigest = sha256(Buffer.from(JSON.stringify({
				schemaVersion: 1, target, osVersion: request.osVersion,
				implementation: request.implementation,
				capabilityDigest: request.capabilityDigest,
				inputSha256: OPERATING_SYSTEM_MP3_CANARY_SHA256,
				outputSha256: sha256(result.output),
				decodedGeometry: result.decodedGeometry,
			})));
			return Object.freeze({
				contractVersion: 1, status: 'qualified', target,
				osVersion: request.osVersion, capabilityId: request.capability.id,
				capabilityDigest: request.capabilityDigest,
				implementation: request.implementation,
				nativeApiReached: true, exactTuplePassed: true, evidenceDigest,
			});
		},
	});
}

function isReviewedMp3Canary(
	request: OperatingSystemCodecCanaryRequest,
	target: OperatingSystemAudioCodecTarget,
): boolean {
	if (!request || typeof request !== 'object' || request.contractVersion !== 1
		|| request.target !== target || typeof request.osVersion !== 'string'
		|| typeof request.capabilityDigest !== 'string') return false;
	const implementation = target.startsWith('win-')
		? 'windows-media-foundation' : 'apple-audiotoolbox-avfoundation';
	if (request.implementation !== implementation) return false;
	const capability = request.capability;
	return !!capability && capability.direction === 'decode' && capability.mediaKind === 'audio'
		&& capability.container === 'mp3' && capability.codec === 'mp3'
		&& capability.profile === null && capability.sampleFormat === 'f32'
		&& capability.pixelFormat === null && capability.sampleRate === 48_000
		&& capability.channelCount === 2 && capability.width === null && capability.height === null;
}

function finiteNonSilentFloat32(value: Uint8Array): boolean {
	if (value.byteLength < Float32Array.BYTES_PER_ELEMENT
		|| value.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return false;
	const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
	let nonzero = false;
	for (let offset = 0; offset < value.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
		const sample = view.getFloat32(offset, true);
		if (!Number.isFinite(sample)) return false;
		if (sample !== 0) nonzero = true;
	}
	return nonzero;
}

function inspectedRunner(value: unknown): OperatingSystemAudioCodecOperationRunner {
	if (!value || typeof value !== 'object') throw new TypeError('The OS MP3 canary runner is invalid.');
	const method = Object.getOwnPropertyDescriptor(value, 'execute');
	if (!method || !Object.hasOwn(method, 'value') || typeof method.value !== 'function') {
		throw new TypeError('The OS MP3 canary runner is invalid.');
	}
	return value as OperatingSystemAudioCodecOperationRunner;
}

function targetId(value: unknown): OperatingSystemAudioCodecTarget {
	if (value !== 'mac-arm64' && value !== 'win-x64' && value !== 'win-arm64') {
		throw new TypeError('The OS MP3 canary target is unsupported.');
	}
	return value;
}

function unavailable(
	reason: Extract<OperatingSystemCodecCanaryResult, { status: 'unavailable' }>['reason'],
): Extract<OperatingSystemCodecCanaryResult, { status: 'unavailable' }> {
	return Object.freeze({ contractVersion: 1, status: 'unavailable', reason });
}

function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
