/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

import {
	PLATFORM_TRANSFER_HARD_LIMITS, createBoundedAudioChunk, createBoundedPortMessage,
	type AbortablePortOperation, type BoundedAudioChunk, type BoundedPortMessage,
} from '../../src/common/editor/platform/bounded-transfer.ts';
import {
	createNativeAudioSession,
	type NativeAudioCapturedPrefix, type NativeAudioDirection, type NativeAudioExclusivePolicy,
	type NativeAudioInputStreamPort, type NativeAudioInventoryReport, type NativeAudioOpenPortRequest,
	type NativeAudioOpenRequest, type NativeAudioOutputLossPolicy, type NativeAudioOutputStreamPort,
	type NativeAudioSession, type NativeAudioSessionStatus, type NativeAudioStreamGrant,
} from '../../src/common/editor/controller/native-audio-session.ts';

export type FakePort = NativeAudioInputStreamPort & NativeAudioOutputStreamPort;
export type GrantOverrides = Readonly<Partial<Record<NativeAudioDirection, Partial<NativeAudioStreamGrant>>>>;

export const INPUT_ID = 'native:alsa:in:hw:0,0';
export const OUTPUT_ID = 'native:alsa:out:hw:0,0';
export const INVENTORY: NativeAudioInventoryReport = Object.freeze({
	backend: 'alsa',
	status: 'available',
	detail: '',
	devices: Object.freeze([
		Object.freeze({ handle: 'hw:0,0', label: 'Built-in', direction: 'duplex' as const, channelCount: 4, isDefault: true }),
		Object.freeze({ handle: 'usb:2', label: 'Interface', direction: 'input' as const, channelCount: 3 }),
	]),
});
export const OPEN: NativeAudioOpenRequest = Object.freeze({
	backend: 'alsa', mode: 'shared', sampleRate: 48_000, bufferFrames: 512, channelCount: 2,
	inputDeviceId: INPUT_ID, outputDeviceId: OUTPUT_ID,
});

export interface HarnessOptions {
	readonly inventory?: unknown;
	readonly enumerateHook?: (request: AbortablePortOperation) => Promise<BoundedPortMessage<NativeAudioInventoryReport>>;
	readonly openHook?: (direction: NativeAudioDirection, port: FakePort) => Promise<FakePort>;
	readonly readHook?: (request: AbortablePortOperation) => Promise<BoundedAudioChunk | null>;
	readonly writeHook?: () => Promise<void>;
	readonly grants?: GrantOverrides;
	readonly exclusivePolicy?: NativeAudioExclusivePolicy;
	readonly outputLossPolicy?: NativeAudioOutputLossPolicy;
	/** A device that has already vanished throws rather than closing politely. */
	readonly closeThrows?: boolean;
	/** A grant that answers truthfully while it is admitted and lies afterwards. */
	readonly poisonGrantAfterAdmission?: boolean;
}

export interface Harness {
	readonly session: NativeAudioSession;
	readonly opens: Record<NativeAudioDirection, number>;
	readonly closes: Record<NativeAudioDirection, number>;
	readonly statuses: NativeAudioSessionStatus[];
	readonly commits: NativeAudioCapturedPrefix[];
	readonly policies: NativeAudioExclusivePolicy[];
}

export function chunk(frames = 128): BoundedAudioChunk {
	return createBoundedAudioChunk([new Float32Array(frames), new Float32Array(frames)],
		{ sequence: 0, maximumFrameCount: PLATFORM_TRANSFER_HARD_LIMITS.audioChunkFrames });
}

export function tick(): Promise<void> {
	return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function grantOf(options: HarnessOptions, direction: NativeAudioDirection, request: NativeAudioOpenPortRequest): NativeAudioStreamGrant {
	const base = {
		backend: request.backend, requestedMode: request.mode, grantedMode: request.mode,
		sampleRate: request.format.sampleRate, bufferFrames: request.bufferFrames,
		channelCount: request.format.channelCount, latencyFrames: 64, ...options.grants?.[direction],
	};
	if (!options.poisonGrantAfterAdmission) return Object.freeze(base);
	let reads = 0;
	return Object.freeze({
		...base,
		get channelCount(): number {
			reads += 1;
			return reads > 1 ? 999_999 : base.channelCount;
		},
	});
}

export function createHarness(options: HarnessOptions = {}): Harness {
	const opens: Record<NativeAudioDirection, number> = { input: 0, output: 0 };
	const closes: Record<NativeAudioDirection, number> = { input: 0, output: 0 };
	const statuses: NativeAudioSessionStatus[] = [];
	const commits: NativeAudioCapturedPrefix[] = [];
	const policies: NativeAudioExclusivePolicy[] = [];
	const openPort = (direction: NativeAudioDirection, request: NativeAudioOpenPortRequest): Promise<FakePort> => {
		opens[direction] += 1;
		const port: FakePort = Object.freeze({
			device: Object.freeze({
				id: request.deviceId, kind: direction === 'input' ? 'audio-input' as const : 'audio-output' as const,
				label: 'Built-in', isDefault: true,
			}),
			format: request.format,
			maximumChunkFrames: request.maximumChunkFrames,
			grant: grantOf(options, direction, request),
			read: options.readHook ?? ((): Promise<BoundedAudioChunk | null> => Promise.resolve(chunk())),
			write: options.writeHook ?? ((): Promise<void> => Promise.resolve()),
			close: (): Promise<void> => {
				closes[direction] += 1;
				if (options.closeThrows) throw new Error('the device is gone');
				return Promise.resolve();
			},
		});
		return options.openHook ? options.openHook(direction, port) : Promise.resolve(port);
	};
	const session = createNativeAudioSession({
		host: {
			enumerate: options.enumerateHook ?? ((): Promise<BoundedPortMessage<NativeAudioInventoryReport>> => Promise.resolve(
				createBoundedPortMessage('native-audio-inventory', (options.inventory ?? INVENTORY) as NativeAudioInventoryReport,
					{ sequence: 0, maximumEncodedBytes: PLATFORM_TRANSFER_HARD_LIMITS.messageBytes }),
			)),
			openInput: (request) => openPort('input', request),
			openOutput: (request) => openPort('output', request),
		},
		exclusivePolicy: options.exclusivePolicy,
		outputLossPolicy: options.outputLossPolicy,
		onStatus: (status) => statuses.push(status),
		onExclusivePolicy: (policy) => policies.push(policy),
		commitCapturedPrefix: (commit) => commits.push(commit),
	});
	return { session, opens, closes, statuses, commits, policies };
}

export function failure(outcome: Readonly<{ status: string }>): Readonly<{ code: string; message: string }> {
	assert.equal(outcome.status, 'failed', `expected a failure, received ${outcome.status}`);
	return outcome as unknown as Readonly<{ code: string; message: string }>;
}

export async function openHarness(options: HarnessOptions = {}, request: NativeAudioOpenRequest = OPEN): Promise<Harness> {
	const harness = createHarness(options);
	assert.equal((await harness.session.open(request)).status, 'opened');
	return harness;
}
