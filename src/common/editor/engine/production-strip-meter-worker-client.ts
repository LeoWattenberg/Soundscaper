/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../closed-domain-value.ts';
import { canonicalStripRefKey, normalizeStripRef } from '../parameter-address.ts';
import type { StripMeterSnapshot } from '../production-audio/strip-meter-session.ts';
import {
	PRODUCTION_STRIP_METER_WORKER_MAXIMUM_FRAMES,
	PRODUCTION_STRIP_METER_WORKER_MAXIMUM_STRIPS,
	PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION,
	type ProductionStripMeterSample,
	type ProductionStripMeterWorkerRequest,
} from './production-strip-meter-worker-runtime.ts';

type WorkerEvent = Readonly<{ data?: unknown; error?: unknown; message?: string }>;
type WorkerListener = (event: WorkerEvent) => void;

export interface ProductionStripMeterWorkerPort {
	addEventListener(type: 'message' | 'messageerror' | 'error', listener: WorkerListener): void;
	removeEventListener(type: 'message' | 'messageerror' | 'error', listener: WorkerListener): void;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
	terminate(): void;
}

export interface ProductionStripMeterWorkerClientOptions {
	readonly createWorker?: () => ProductionStripMeterWorkerPort;
	readonly setTimeout?: typeof globalThis.setTimeout;
	readonly clearTimeout?: typeof globalThis.clearTimeout;
}

export interface ProductionStripMeterWorkerClient {
	submit(samples: readonly ProductionStripMeterSample[]): boolean;
	busy(): boolean;
	snapshot(): readonly StripMeterSnapshot[];
	reset(): void;
	dispose(): void;
	failed(): Error | null;
}

const EMPTY_SNAPSHOT: readonly StripMeterSnapshot[] = Object.freeze([]);
const RESPONSE_TIMEOUT_MS = 2_000;

/** A bounded one-batch client. Slow worker ticks are skipped, never queued. */
export function createProductionStripMeterWorkerClient(
	options: ProductionStripMeterWorkerClientOptions = {},
): ProductionStripMeterWorkerClient {
	let worker: ProductionStripMeterWorkerPort | null = null;
	let generation = 1;
	let requestId = 0;
	let inFlight: Readonly<{ generation: number; requestId: number }> | null = null;
	let latest: readonly StripMeterSnapshot[] = EMPTY_SNAPSHOT;
	let failure: Error | null = null;
	let disposed = false;
	let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
	const setResponseTimeout = options.setTimeout ?? globalThis.setTimeout;
	const clearResponseTimeout = options.clearTimeout ?? globalThis.clearTimeout;
	const clearTimer = (): void => {
		if (timer === null) return;
		clearResponseTimeout(timer);
		timer = null;
	};

	const detach = (): void => {
		if (!worker) return;
		worker.removeEventListener('message', onMessage);
		worker.removeEventListener('messageerror', onMessageError);
		worker.removeEventListener('error', onError);
		worker.terminate();
		worker = null;
	};
	const fail = (reason: unknown): void => {
		if (disposed || failure) return;
		failure = reason instanceof Error ? reason : new Error('Production strip meter worker failed.');
		inFlight = null;
		latest = EMPTY_SNAPSHOT;
		clearTimer();
		detach();
	};
	const onMessage = (event: WorkerEvent): void => {
		if (disposed || failure || !inFlight) return;
		try {
			const response = readClosedDomainRecord(event.data, 'meter worker response',
				['type', 'protocolVersion', 'generation', 'requestId', 'snapshot', 'error'],
				['type', 'protocolVersion', 'generation', 'requestId']);
			const responseGeneration = readClosedDomainField(response, 'generation', 'meter worker response');
			const responseId = readClosedDomainField(response, 'requestId', 'meter worker response');
			if (responseGeneration !== inFlight.generation || responseId !== inFlight.requestId) return;
			if (readClosedDomainField(response, 'protocolVersion', 'meter worker response')
				!== PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION) {
				throw new Error('The meter worker response protocol version is invalid.');
			}
			inFlight = null;
			clearTimer();
			if (responseGeneration !== generation) return;
			const type = readClosedDomainField(response, 'type', 'meter worker response');
			if (type === 'error') {
				const errorValue = readClosedDomainRecord(
					readClosedDomainField(response, 'error', 'meter worker response'),
					'meter worker error', ['name', 'message'],
				);
				const message = readClosedDomainField(errorValue, 'message', 'meter worker error');
				if (typeof message !== 'string' || !message || message.length > 1_024) {
					throw new TypeError('The meter worker returned an invalid error.');
				}
				fail(new Error(message));
				return;
			}
			if (type !== 'result') throw new TypeError('The meter worker returned an unknown response.');
			latest = normalizeSnapshot(readClosedDomainField(response, 'snapshot', 'meter worker response'));
		} catch (error) { fail(error); }
	};
	const onMessageError = (): void => fail(new Error('The production strip meter worker returned an unreadable response.'));
	const onError = (event: WorkerEvent): void => fail(event.error instanceof Error
		? event.error : new Error(event.message || 'Production strip meter worker failed.'));

	return Object.freeze({
		submit(samples: readonly ProductionStripMeterSample[]): boolean {
			if (disposed || failure || inFlight) return false;
			if (requestId >= Number.MAX_SAFE_INTEGER || generation >= Number.MAX_SAFE_INTEGER) {
				fail(new RangeError('The production strip meter worker sequence was exhausted.'));
				return false;
			}
			const prepared = prepareSamples(samples);
			try {
				if (!worker) {
					worker = (options.createWorker ?? createWorker)();
					worker.addEventListener('message', onMessage);
					worker.addEventListener('messageerror', onMessageError);
					worker.addEventListener('error', onError);
				}
				const id = ++requestId;
				const request: ProductionStripMeterWorkerRequest = {
					type: 'sample', protocolVersion: PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION,
					generation, requestId: id, samples: prepared.samples,
				};
				inFlight = { generation, requestId: id };
				timer = setResponseTimeout(
					() => fail(new Error('Production strip meter worker response timed out.')),
					RESPONSE_TIMEOUT_MS,
				);
				(timer as { unref?(): void }).unref?.();
				worker.postMessage(request, prepared.transfer);
				return true;
			} catch (error) {
				fail(error);
				return false;
			}
		},
		busy: (): boolean => inFlight !== null,
		snapshot: (): readonly StripMeterSnapshot[] => latest,
		reset(): void {
			if (disposed || failure) return;
			if (generation >= Number.MAX_SAFE_INTEGER) {
				fail(new RangeError('The production strip meter worker generation was exhausted.'));
				return;
			}
			generation += 1;
			latest = EMPTY_SNAPSHOT;
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			inFlight = null;
			latest = EMPTY_SNAPSHOT;
			clearTimer();
			detach();
		},
		failed: (): Error | null => failure,
	});
}

function prepareSamples(value: unknown): Readonly<{
	samples: readonly ProductionStripMeterSample[];
	transfer: readonly ArrayBuffer[];
}> {
	const values = readClosedDomainArray(value, 'production strip meter samples',
		0, PRODUCTION_STRIP_METER_WORKER_MAXIMUM_STRIPS);
	const buffers = new Set<ArrayBuffer>();
	const strips = new Set<string>();
	const transfer: ArrayBuffer[] = [];
	const samples = values.map((value, index) => {
		const name = `production strip meter samples[${String(index)}]`;
		const sample = readClosedDomainRecord(value, name, ['strip', 'channelLabels', 'channels']);
		const strip = normalizeStripRef(readClosedDomainField(sample, 'strip', name));
		const key = canonicalStripRefKey(strip);
		if (strips.has(key)) throw new TypeError('Production strip meter samples require unique strips.');
		strips.add(key);
		const channels = readClosedDomainArray(readClosedDomainField(sample, 'channels', name),
			`${name}.channels`, 1, 32);
		const labels = readClosedDomainArray(readClosedDomainField(sample, 'channelLabels', name),
			`${name}.channelLabels`, channels.length, channels.length);
		const channelLabels = labels.map((label) => {
			if (typeof label !== 'string' || label.length < 1 || label.length > 32 || label.trim() !== label) {
				throw new TypeError('Production strip meter channel labels must contain 1 through 32 canonical characters.');
			}
			return label;
		});
		if (new Set(channelLabels).size !== channelLabels.length) {
			throw new TypeError('Production strip meter channel labels must be unique.');
		}
		const pcm = channels.map((channel) => {
			if (!(channel instanceof Float32Array) || channel.length < 1
				|| channel.length > PRODUCTION_STRIP_METER_WORKER_MAXIMUM_FRAMES) {
				throw new RangeError('Production strip meter channels require 1 through 256 Float32 frames.');
			}
			if (!(channel.buffer instanceof ArrayBuffer) || channel.byteOffset !== 0
				|| channel.byteLength !== channel.buffer.byteLength) {
				throw new TypeError('Production strip meter transfer requires exact-span owned buffers.');
			}
			if (buffers.has(channel.buffer)) throw new TypeError('Production strip meter transfer requires unique buffers.');
			buffers.add(channel.buffer);
			transfer.push(channel.buffer);
			return channel;
		});
		if (pcm.some((channel) => channel.length !== pcm[0]?.length)) {
			throw new RangeError('Production strip meter channels must have the same frame count.');
		}
		return Object.freeze({ strip, channelLabels: Object.freeze(channelLabels), channels: Object.freeze(pcm) });
	});
	return Object.freeze({ samples: Object.freeze(samples), transfer: Object.freeze(transfer) });
}

function normalizeSnapshot(value: unknown): readonly StripMeterSnapshot[] {
	const values = readClosedDomainArray(value, 'production strip meter snapshot',
		0, PRODUCTION_STRIP_METER_WORKER_MAXIMUM_STRIPS);
	const seen = new Set<string>();
	return Object.freeze(values.map((value, index) => {
		const name = `production strip meter snapshot[${String(index)}]`;
		const entry = readClosedDomainRecord(value, name,
			['strip', 'sequence', 'channelCount', 'channels', 'correlation', 'phaseDegrees']);
		const strip = normalizeStripRef(readClosedDomainField(entry, 'strip', name));
		const key = canonicalStripRefKey(strip);
		if (seen.has(key)) throw new TypeError('The meter worker returned duplicate strips.');
		seen.add(key);
		const sequence = readClosedDomainField(entry, 'sequence', name);
		if (!Number.isSafeInteger(sequence) || Number(sequence) < 1) {
			throw new TypeError('The meter worker returned an invalid sequence.');
		}
		const channelCount = readClosedDomainField(entry, 'channelCount', name);
		const rawChannels = readClosedDomainArray(readClosedDomainField(entry, 'channels', name),
			`${name}.channels`, 1, 32);
		if (channelCount !== rawChannels.length) throw new TypeError('The meter worker returned mismatched channels.');
		const channels = rawChannels.map((raw, channelIndex) => {
			const channelName = `${name}.channels[${String(channelIndex)}]`;
			const channel = readClosedDomainRecord(raw, channelName, ['label', 'peak', 'rms']);
			const label = readClosedDomainField(channel, 'label', channelName);
			const peak = readClosedDomainField(channel, 'peak', channelName);
			const rms = readClosedDomainField(channel, 'rms', channelName);
			if (typeof label !== 'string' || !label || label.length > 32 || label.trim() !== label
				|| !finiteNonnegative(peak) || !finiteNonnegative(rms)) {
				throw new TypeError('The meter worker returned invalid channel measurements.');
			}
			return Object.freeze({ label, peak, rms });
		});
		if (new Set(channels.map(({ label }) => label)).size !== channels.length) {
			throw new TypeError('The meter worker returned duplicate channel labels.');
		}
		const correlation = readClosedDomainField(entry, 'correlation', name);
		const phaseDegrees = readClosedDomainField(entry, 'phaseDegrees', name);
		if ((correlation !== null && !finiteRange(correlation, -1, 1))
			|| (phaseDegrees !== null && !finiteRange(phaseDegrees, 0, 180))
			|| (correlation === null) !== (phaseDegrees === null)) {
			throw new TypeError('The meter worker returned invalid stereo phase measurements.');
		}
		return Object.freeze({
			strip, sequence: sequence as number, channelCount: rawChannels.length,
			channels: Object.freeze(channels),
			correlation: correlation as number | null, phaseDegrees: phaseDegrees as number | null,
		});
	}));
}

function finiteNonnegative(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function finiteRange(value: unknown, minimum: number, maximum: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function createWorker(): ProductionStripMeterWorkerPort {
	if (typeof Worker !== 'function') throw new Error('Production strip metering requires Web Worker support.');
	return new Worker(new URL('./production-strip-meter-worker.ts', import.meta.url), {
		type: 'module', name: 'soundscaper-production-strip-meter',
	}) as unknown as ProductionStripMeterWorkerPort;
}
