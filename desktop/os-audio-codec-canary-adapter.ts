/* SPDX-License-Identifier: AGPL-3.0-only */

/** Live startup canaries for reviewed target-native codecs through the production helper. */

import { createHash } from 'node:crypto';

import type {
	OperatingSystemCodecCanaryRequest,
	OperatingSystemCodecCanaryResult,
} from './os-codec-capability-adapter.ts';
import type {
	OperatingSystemAudioCodecOperationRunner,
	OperatingSystemAudioCodecTarget,
} from './os-audio-codec-operation-runner.ts';
import {
	inspectOperatingSystemAudioSource,
	inspectOperatingSystemMp3SourceProfile,
} from './os-audio-codec-source-inspection.ts';

export const OPERATING_SYSTEM_MP3_CANARY_SHA256 =
	'90971a846ba5d03488be96ada4f9ea6698aa47e7f487adfe65d606519b0270f2';
export const OPERATING_SYSTEM_AAC_M4A_CANARY_SHA256 =
	'1db255988826f9f6f8322f6cfb6c82c6ee7873c3252c822bc0ac1793d5729451';
export const OPERATING_SYSTEM_AAC_M4A_ENCODE_CANARY_SHA256 =
	'9e752b61eca88c56fd7981f151614479106874d054333aafb961662a78ca3be6';
export const OPERATING_SYSTEM_MP3_ENCODE_CANARY_SHA256 =
	OPERATING_SYSTEM_AAC_M4A_ENCODE_CANARY_SHA256;

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

interface ReviewedDecodeCanary {
	readonly operation: 'audio-decode';
	readonly format: 'mp3' | 'aac-m4a';
	readonly bytes: Uint8Array;
	readonly sha256: string;
	readonly sampleRate: 48_000;
	readonly channelCount: 2;
}

interface ReviewedEncodeCanary {
	readonly operation: 'audio-encode';
	readonly format: 'aac-m4a' | 'mp3';
	readonly bytes: Uint8Array;
	readonly sha256: string;
	readonly sampleRate: 48_000;
	readonly channelCount: 2;
	readonly frameCount: 2_048;
	readonly bitrateKbps: 160 | 192;
}

type ReviewedCanary = ReviewedDecodeCanary | ReviewedEncodeCanary;

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

/* AAC-LC-in-M4A media generated from the same source and exact pinned image.
 * This byte sequence is shared with the target-native CTest fixture. */
const AAC_M4A_CANARY_BASE64 =
	'AAAAHGZ0eXBNNEEgAAACAE00QSBpc29taXNvMgAAAwptb292AAAAbG12aGQAAAAAAAAAAAAAAAAAALuAAAAJYAABAAABAAAA'
	+ 'AAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC'
	+ 'AAACNXRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAJYAAAAAAAAAAAAAAAAQEAAAAAAQAAAAAAAAAAAAAAAAAA'
	+ 'AAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAACWAAAAQAAAEAAAAAAa1tZGlh'
	+ 'AAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAANYFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFu'
	+ 'ZGxlcgAAAAFYbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAEcc3Ri'
	+ 'bAAAAGpzdHNkAAAAAAAAAAEAAABabXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAA2ZXNkcwAAAAADgICAJQAB'
	+ 'AASAgIAXQBUAAAAAAfQAAAHcMgWAgIAFEZBW5QAGgICAAQIAAAAgc3R0cwAAAAAAAAACAAAAAwAABAAAAAABAAABYAAAABxz'
	+ 'dHNjAAAAAAAAAAEAAAABAAAABAAAAAEAAAAkc3RzegAAAAAAAAAAAAAABAAAAScAAAGUAAABfQAAAAcAAAAUc3RjbwAAAAAA'
	+ 'AAABAAADNgAAABpzZ3BkAQAAAHJvbGwAAAACAAAAAf//AAAAHHNiZ3AAAAAAcm9sbAAAAAEAAAAEAAAAAQAAAGF1ZHRhAAAA'
	+ 'WW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAA'
	+ 'AABMYXZmNjMuMS4xMDAAAAAIZnJlZQAABEdtZGF03ABMYXZjNjMuMS4xMDAAQlUf////+AI65wwh6hzJW7b739+pFyZNbkyS'
	+ 'Sdj1ggO1u1batnMWYdjcW6S2bT2E7i5p7i9Z2d4jeXUv+JAiO2K8lxH/z/1rqZRenew83dw8lbh2VpHW2K4thNtWTT2XcWwn'
	+ 'CsVy9bNlUzMWE01ZNNTDPWtxsXGxbbFxsXGxcbwd12u61uu1uumzps6bOmzps6bOmzps6bGmzps6bOizos4kokokokokokok'
	+ 'okokokokokokokokokokokokokokokokokokokokokokokokokokokokokokokp4p4p595+KKKKKKKKKKKKKKKKKKKKKKKKO'
	+ 'H4vDqHMlbtvvf36kXJk1uTJJJ2PWCAAAAAAAAAAAAAAAAAAADiFMbP4H/n/n/kXaabrVRkUuxGKK5WZP+3+PqW8dTWr6/p8f'
	+ 'HFi7m//H/Uvi5VJ/8f4jjWrqgiXdsdis+Ls7Oz+k2MzscgGdkIWda1AP72JFl7AyfQpnUYaxmLMxy2mn2FmkbS/N2FmkaV+U'
	+ 'qmZgcSSkWTGSaSaFg+vDGuRnYjA6XZ/l8uIA+n0+nyyxAD6fT6RRcVAfT6PAkIUAN3P9PMjGeSx9vIbCFjaEn0yMHjhCGOhg'
	+ 'ElzOULrs07gNKikE4yLMCSDBt0Xsuyua8I8S0TjmQou6LCiPg67FxquY2x5Wxysnwddrcaew2xwtjlZOtxsXGbIGDKycqpxZ'
	+ '02dNnDAMAzZVTSqaTOGOE1eMKRgGNeMjVgwMDPA+uQkJBgYGRO7uElXpkctjyXKeYEMBUmZxGUCsifG7e4XHdB27G2LKcqsN'
	+ 'aynKrDYspsVhsVhjn1spZKVWGOE0jSTOzsTRY7cPfoe/Q9+n/b/H1LeOprV9f0+PjixY/8f9S+LlD/4/xHGtXQAAAAAAAAAA'
	+ 'AAAAAAAAAAAOIUzY/8f8f8fsRNmGnNmKlE37e009T/4/29tNa1q9f8f+n/X8WTWrf6/9P/LzYD3+evPlAhoGP0yRp1JPPw2U'
	+ 'b9V5D8cCS5pRYEkWSgzVPyaZZW6DAy3K3QYGdwm6DAzu4SVyBgYGW7hITdBgYGfBwkJhBgY2t3WVuiWgYGNyrfrFLcdNbN1A'
	+ 'qnuqvIPnkWEOta59ZqrHwcaviWUnFqn3jmSRSDNaZKmmCboMDTPdugwNNMsrdugwMDTTYBJW6DAwNg7hIm0GBgYGs9v8/57/'
	+ '2nQExPBNKrXAQTBohZNEKs2EBLrBGd0UWXKhaIHkMdBiugVAAusHtf5T0D2/uf2zrTxvrvxDrjxPrPmTiHM/E+ZOIcz7L35s'
	+ 'jdey90bI+i8yp1ybKm3UOUqKFdIOzfGuuvEei8VvXE6zsWvbDoOxaFsNxw1ywsSPXsevY9ex2kV51P/j/b201rQ/T/0/6/iy'
	+ 'aH8f9P/LzYD3+evPlAhoAAAAAAAAAAAAAAAAAADgIUDaRgjBwA==';
const AAC_M4A_CANARY_BYTES = Buffer.from(AAC_M4A_CANARY_BASE64, 'base64');
if (AAC_M4A_CANARY_BYTES.byteLength !== 1_909
	|| sha256(AAC_M4A_CANARY_BYTES) !== OPERATING_SYSTEM_AAC_M4A_CANARY_SHA256) {
	throw new Error('The embedded OS AAC M4A canary failed its source digest.');
}

/* Deterministic interleaved f32le input shared byte-for-byte with the target CTest.
 * It is deliberately synthetic and small; the resulting M4A is separately parsed. */
const AAC_M4A_ENCODE_CANARY_BYTES = encodeCanaryBytes();
if (AAC_M4A_ENCODE_CANARY_BYTES.byteLength !== 16_384
	|| sha256(AAC_M4A_ENCODE_CANARY_BYTES) !== OPERATING_SYSTEM_AAC_M4A_ENCODE_CANARY_SHA256) {
	throw new Error('The embedded OS AAC M4A encode canary failed its source digest.');
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
			if (!(signal instanceof AbortSignal)) throw new TypeError('The OS audio canary signal is invalid.');
			signal.throwIfAborted();
			const canary = reviewedCanary(request, target);
			if (canary === null) return unavailable('canary-refused');
			const operation = canary.operation === 'audio-encode'
				? Object.freeze({
					operation: 'audio-encode' as const,
					format: canary.format,
					input: new Uint8Array(canary.bytes),
					sampleRate: canary.sampleRate,
					channelCount: canary.channelCount,
					settings: Object.freeze({ bitrateKbps: canary.bitrateKbps }),
					maximumOutputBytes: 1024 * 1024,
				})
				: Object.freeze({
					operation: 'audio-decode' as const,
					format: canary.format,
					input: new Uint8Array(canary.bytes),
					sampleRate: null,
					channelCount: null,
					settings: Object.freeze({ sampleFormat: 'f32le' as const }),
					maximumOutputBytes: 1024 * 1024,
				});
			const result = await runner.execute(operation, { signal });
			signal.throwIfAborted();
			if (result.status !== 'executed') {
				return unavailable(result.reason === 'api-unavailable' ? 'api-unavailable'
					: result.reason === 'tuple-unsupported' ? 'tuple-unsupported' : 'canary-refused');
			}
			const measurements = canary.operation === 'audio-encode'
				? inspectEncodedCanary(canary, result)
				: inspectDecodedCanary(canary, result);
			if (measurements === null) return unavailable('canary-refused');
			const resultDigest = sha256(Buffer.from(JSON.stringify({
				schemaVersion: 1, target, osVersion: request.osVersion,
				implementation: request.implementation,
				capabilityDigest: request.capabilityDigest,
				inputSha256: canary.sha256,
				outputSha256: sha256(result.output),
				...measurements,
			})));
			return Object.freeze({
				contractVersion: 1, status: 'passed', target,
				osVersion: request.osVersion, capabilityId: request.capability.id,
				capabilityDigest: request.capabilityDigest,
				implementation: request.implementation,
				nativeApiReached: true, exactTuplePassed: true, resultDigest,
			});
		},
	});
}

function reviewedCanary(
	request: OperatingSystemCodecCanaryRequest,
	target: OperatingSystemAudioCodecTarget,
): ReviewedCanary | null {
	if (!request || typeof request !== 'object' || request.contractVersion !== 1
		|| request.target !== target || typeof request.osVersion !== 'string'
		|| typeof request.capabilityDigest !== 'string') return null;
	const implementation = target.startsWith('win-')
		? 'windows-media-foundation' : 'apple-audiotoolbox-avfoundation';
	if (request.implementation !== implementation) return null;
	const capability = request.capability;
	if (!capability || capability.mediaKind !== 'audio'
		|| capability.pixelFormat !== null || capability.sampleRate !== 48_000
		|| capability.channelCount !== 2 || capability.width !== null || capability.height !== null) return null;
	if (capability.direction === 'decode' && capability.container === 'mp3' && capability.codec === 'mp3'
		&& capability.profile === null && capability.sampleFormat === 'f32') {
		return Object.freeze({
			operation: 'audio-decode',
			format: 'mp3', bytes: CANARY_BYTES, sha256: OPERATING_SYSTEM_MP3_CANARY_SHA256,
			sampleRate: 48_000, channelCount: 2,
		});
	}
	if (capability.direction === 'decode' && capability.container === 'm4a' && capability.codec === 'aac'
		&& capability.profile === 'lc' && capability.sampleFormat === 'f32p') {
		return Object.freeze({
			operation: 'audio-decode',
			format: 'aac-m4a', bytes: AAC_M4A_CANARY_BYTES,
			sha256: OPERATING_SYSTEM_AAC_M4A_CANARY_SHA256,
			sampleRate: 48_000, channelCount: 2,
		});
	}
	if (capability.direction === 'encode' && capability.container === 'm4a'
		&& capability.codec === 'aac' && capability.profile === 'lc'
		&& capability.sampleFormat === 'f32p') {
		return Object.freeze({
			operation: 'audio-encode', format: 'aac-m4a',
			bytes: AAC_M4A_ENCODE_CANARY_BYTES,
			sha256: OPERATING_SYSTEM_AAC_M4A_ENCODE_CANARY_SHA256,
			sampleRate: 48_000, channelCount: 2, frameCount: 2_048, bitrateKbps: 160,
		});
	}
	if (target.startsWith('win-') && capability.direction === 'encode'
		&& capability.container === 'mp3' && capability.codec === 'mp3'
		&& capability.profile === null && capability.sampleFormat === 'f32p') {
		return Object.freeze({
			operation: 'audio-encode', format: 'mp3', bytes: AAC_M4A_ENCODE_CANARY_BYTES,
			sha256: OPERATING_SYSTEM_MP3_ENCODE_CANARY_SHA256,
			sampleRate: 48_000, channelCount: 2, frameCount: 2_048, bitrateKbps: 192,
		});
	}
	return null;
}

function inspectDecodedCanary(
	canary: ReviewedDecodeCanary,
	result: Extract<Awaited<ReturnType<OperatingSystemAudioCodecOperationRunner['execute']>>, {
		readonly status: 'executed';
	}>,
): Readonly<{ readonly decodedGeometry: Readonly<{
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}> }> | null {
	if (!('decodedGeometry' in result)
		|| result.decodedGeometry.sampleRate !== canary.sampleRate
		|| result.decodedGeometry.channelCount !== canary.channelCount
		|| result.decodedGeometry.frameCount < 1
		|| result.output.byteLength !== result.decodedGeometry.frameCount * canary.channelCount
			* Float32Array.BYTES_PER_ELEMENT
		|| !finiteNonSilentFloat32(result.output)) return null;
	return Object.freeze({ decodedGeometry: result.decodedGeometry });
}

function inspectEncodedCanary(
	canary: ReviewedEncodeCanary,
	result: Extract<Awaited<ReturnType<OperatingSystemAudioCodecOperationRunner['execute']>>, {
		readonly status: 'executed';
	}>,
): Readonly<{ readonly encodedTuple: Readonly<{
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly bitrateKbps: number;
}> }> | null {
	if ('decodedGeometry' in result || result.output.byteLength < 1) return null;
	const mp3Profile = canary.format === 'mp3'
		? inspectOperatingSystemMp3SourceProfile(result.output) : null;
	const geometry = canary.format === 'mp3'
		? mp3Profile : inspectOperatingSystemAudioSource('aac-m4a', result.output);
	if (geometry?.sampleRate !== canary.sampleRate
		|| geometry.channelCount !== canary.channelCount
		|| canary.format === 'mp3' && mp3Profile?.bitrateKbps !== canary.bitrateKbps) return null;
	return Object.freeze({
		encodedTuple: Object.freeze({
			sampleRate: canary.sampleRate,
			channelCount: canary.channelCount,
			frameCount: canary.frameCount,
			bitrateKbps: canary.bitrateKbps,
		}),
	});
}

function encodeCanaryBytes(): Uint8Array {
	const bytes = new Uint8Array(2_048 * 2 * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	for (let frame = 0; frame < 2_048; frame += 1) {
		const left = (frame % 31 - 15) / 16;
		view.setFloat32(frame * 8, left, true);
		view.setFloat32(frame * 8 + 4, -left * 0.5, true);
	}
	return bytes;
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
	if (!value || typeof value !== 'object') throw new TypeError('The OS audio canary runner is invalid.');
	const method = Object.getOwnPropertyDescriptor(value, 'execute');
	if (!method || !Object.hasOwn(method, 'value') || typeof method.value !== 'function') {
		throw new TypeError('The OS audio canary runner is invalid.');
	}
	return value as OperatingSystemAudioCodecOperationRunner;
}

function targetId(value: unknown): OperatingSystemAudioCodecTarget {
	if (value !== 'mac-arm64' && value !== 'win-x64' && value !== 'win-arm64') {
		throw new TypeError('The OS audio canary target is unsupported.');
	}
	return value;
}

function unavailable(
	reason: Extract<OperatingSystemCodecCanaryResult, { status: 'unavailable' }>['reason'],
): Extract<OperatingSystemCodecCanaryResult, { status: 'unavailable' }> {
	return Object.freeze({ contractVersion: 1, status: 'unavailable', reason });
}

function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
