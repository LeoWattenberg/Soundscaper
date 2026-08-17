/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What a native audio open request may ask for and what the grant answering it
 * may claim. The session in native-audio-session.ts owns what happens next; the
 * bounds here are the ones a request or a grant has to satisfy before any of
 * that is reached, and they are the only place a device identifier, a clock, a
 * width or a reported latency is admitted into renderer state.
 */

import { PLATFORM_TRANSFER_HARD_LIMITS } from '../platform/bounded-transfer.ts';
import { NATIVE_AUDIO_CALIBRATION_LIMITS as LIMITS, NATIVE_AUDIO_MODES, type NativeAudioMode } from './native-audio-calibration.ts';
import { isOpaqueNativeAudioHandle, type NativeAudioDirection } from './native-audio-inventory.ts';

/** A device reports the latency it really has, so its bound is real time at the clock it was granted. */
export const NATIVE_AUDIO_MAXIMUM_DEVICE_LATENCY_SECONDS = 2;

export type NativeAudioFailureCode = 'aborted' | 'already-open' | 'closed' | 'contract-violation' | 'device-lost' | 'host-failed' | 'invalid-request' | 'mode-denied' | 'not-open';

export class NativeAudioSessionError extends Error {
	readonly code: NativeAudioFailureCode;
	constructor(code: NativeAudioFailureCode, message: string) {
		super(message);
		this.name = 'NativeAudioSessionError';
		this.code = code;
	}
}

/** What the backend actually gave, as opposed to what was asked for. */
export type NativeAudioStreamGrant = Readonly<{ backend: string; requestedMode: NativeAudioMode; grantedMode: NativeAudioMode; sampleRate: number; bufferFrames: number; channelCount: number; latencyFrames: number }>;
export type NativeAudioOpenRequest = Readonly<{
	backend: string; mode: NativeAudioMode; sampleRate: number; bufferFrames: number; channelCount: number;
	inputDeviceId?: string; outputDeviceId?: string; signal?: AbortSignal;
}>;

export function parseOpenRequest(request: NativeAudioOpenRequest): NativeAudioOpenRequest {
	if (!request || typeof request !== 'object' || Array.isArray(request)) refuse('A native audio open request must be a plain record.');
	const record = request as Readonly<Record<string, unknown>>;
	const backend = typeof record.backend === 'string' ? record.backend : '';
	if (!backend || backend.length > LIMITS.maximumBackendLength) refuse('A native audio open request must name a bounded backend.');
	if (typeof record.mode !== 'string' || !(NATIVE_AUDIO_MODES as readonly string[]).includes(record.mode)) {
		refuse('A native audio open request must name a shared or exclusive mode.');
	}
	const inputDeviceId = deviceIdOf(record.inputDeviceId);
	const outputDeviceId = deviceIdOf(record.outputDeviceId);
	if (!inputDeviceId && !outputDeviceId) refuse('A native audio open request must name at least one device.');
	return Object.freeze({
		backend, mode: record.mode as NativeAudioMode, inputDeviceId, outputDeviceId, signal: request.signal,
		sampleRate: bounded(record.sampleRate, LIMITS.minimumSampleRate, LIMITS.maximumSampleRate, 'sample rate'),
		bufferFrames: bounded(record.bufferFrames, 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames, 'buffer frames'),
		channelCount: bounded(record.channelCount, 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels, 'channel count'),
	});
}

/**
 * The port must restate what it was asked for and name what it gave. A port
 * that rewrites the request has substituted a mode on its own, which is exactly
 * the substitution the session exists to prevent.
 */
export function admitGrant(value: unknown, parsed: NativeAudioOpenRequest, direction: NativeAudioDirection): NativeAudioStreamGrant {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new NativeAudioSessionError('contract-violation', `A native audio ${direction} grant must be a plain record.`);
	}
	const grant = value as Readonly<Record<string, unknown>>;
	if (grant.backend !== parsed.backend || grant.requestedMode !== parsed.mode) {
		throw new NativeAudioSessionError('contract-violation', `A native audio ${direction} grant must restate the request it answers.`);
	}
	if (typeof grant.grantedMode !== 'string' || !(NATIVE_AUDIO_MODES as readonly string[]).includes(grant.grantedMode)) {
		throw new NativeAudioSessionError('contract-violation', `A native audio ${direction} grant must name the mode it granted.`);
	}
	const sampleRate = bounded(grant.sampleRate, LIMITS.minimumSampleRate, LIMITS.maximumSampleRate, 'granted sample rate');
	return Object.freeze({
		backend: parsed.backend, requestedMode: parsed.mode, grantedMode: grant.grantedMode as NativeAudioMode, sampleRate,
		bufferFrames: bounded(grant.bufferFrames, 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames, 'granted buffer frames'),
		channelCount: bounded(grant.channelCount, 1, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels, 'granted channel count'),
		// A device reports how far the sound is from its converter, which is a
		// span of time at the clock it was granted, not a bound on how much audio
		// moves in one transfer.
		latencyFrames: bounded(grant.latencyFrames, 0, sampleRate * NATIVE_AUDIO_MAXIMUM_DEVICE_LATENCY_SECONDS, 'granted latency'),
	});
}

export function asSessionError(reason: unknown): NativeAudioSessionError {
	if (reason instanceof NativeAudioSessionError) return reason;
	return new NativeAudioSessionError('aborted', messageOf(reason) || 'The native audio operation was aborted.');
}

export function codeOf(error: unknown, fallbackCode: NativeAudioFailureCode): NativeAudioFailureCode {
	return error instanceof NativeAudioSessionError ? error.code : fallbackCode;
}

export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function refuse(message: string): never {
	throw new NativeAudioSessionError('invalid-request', message);
}

/**
 * The identifier is republished in the status, in the calibration tuple and in
 * the prefix a lost recording commits, so it is held to the same opacity the
 * inventory holds a handle to. Refusing it here is what keeps a path out of
 * renderer state when the caller did not get its id from the inventory.
 */
function deviceIdOf(value: unknown): string {
	if (value == null || value === '') return '';
	if (typeof value !== 'string' || value.length > LIMITS.maximumDeviceIdLength) refuse('A native audio device identifier must be bounded text.');
	if (!isOpaqueNativeAudioHandle(value)) refuse('A native audio device identifier must be opaque, never a path.');
	return value;
}

function bounded(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		refuse(`A native audio ${label} is outside its admitted bounds.`);
	}
	return value as number;
}
