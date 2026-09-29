/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSessionStripMeterStore,
	type StripMeterSnapshot,
} from '../production-audio/strip-meter-session.ts';
import type { StripRef } from '../parameter-address.ts';

export const PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION = 1;
export const PRODUCTION_STRIP_METER_WORKER_MAXIMUM_STRIPS = 128;
export const PRODUCTION_STRIP_METER_WORKER_MAXIMUM_FRAMES = 256;

export interface ProductionStripMeterSample {
	readonly strip: StripRef;
	readonly channelLabels: readonly string[];
	readonly channels: readonly Float32Array[];
}

export interface ProductionStripMeterWorkerRequest {
	readonly type: 'sample';
	readonly protocolVersion: typeof PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION;
	readonly generation: number;
	readonly requestId: number;
	readonly samples: readonly ProductionStripMeterSample[];
}

export type ProductionStripMeterWorkerResponse = Readonly<{
	type: 'result';
	protocolVersion: typeof PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION;
	generation: number;
	requestId: number;
	snapshot: readonly StripMeterSnapshot[];
}> | Readonly<{
	type: 'error';
	protocolVersion: typeof PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION;
	generation: number;
	requestId: number;
	error: Readonly<{ name: string; message: string }>;
}>;

/** Stateful computation on a dedicated worker, with one store per generation. */
export function createProductionStripMeterWorkerRuntime(options: Readonly<{
	post: (response: ProductionStripMeterWorkerResponse) => void;
}>) {
	if (typeof options?.post !== 'function') throw new TypeError('A meter worker needs a response port.');
	let generation = 0;
	let store = createStore();
	return Object.freeze({
		handleMessage(value: unknown): void {
			const envelope = requestEnvelope(value);
			if (!envelope) return;
			const { requestId } = envelope;
			try {
				const request = normalizeRequest(value);
				if (request.generation < generation) throw new RangeError('The meter worker request generation is stale.');
				if (request.generation !== generation) {
					store = createStore();
					generation = request.generation;
				}
				for (const sample of request.samples) {
					store.update(sample.strip, {
						channelLabels: sample.channelLabels,
						channels: sample.channels,
					});
				}
				options.post({
					type: 'result', protocolVersion: PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION,
					generation, requestId, snapshot: store.snapshot(),
				});
			} catch (error) {
				options.post({
					type: 'error', protocolVersion: PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION,
					generation: envelope.generation, requestId, error: serializeError(error),
				});
			}
		},
	});
}

function createStore(): ReturnType<typeof createSessionStripMeterStore> {
	return createSessionStripMeterStore({
		maximumStrips: PRODUCTION_STRIP_METER_WORKER_MAXIMUM_STRIPS,
		maximumFramesPerUpdate: PRODUCTION_STRIP_METER_WORKER_MAXIMUM_FRAMES,
	});
}

function requestEnvelope(value: unknown): Readonly<{ generation: number; requestId: number }> | null {
	if (!value || typeof value !== 'object') return null;
	const request = value as Record<string, unknown>;
	if (!positiveInteger(request.generation) || !positiveInteger(request.requestId)) return null;
	return { generation: request.generation, requestId: request.requestId };
}

function normalizeRequest(value: unknown): ProductionStripMeterWorkerRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A meter worker request must be an object.');
	}
	const request = value as Partial<ProductionStripMeterWorkerRequest>;
	if (request.type !== 'sample' || request.protocolVersion !== PRODUCTION_STRIP_METER_WORKER_PROTOCOL_VERSION) {
		throw new TypeError('The meter worker protocol version or request type is invalid.');
	}
	if (!positiveInteger(request.generation) || !positiveInteger(request.requestId)) {
		throw new RangeError('Meter worker generation and request ID must be positive safe integers.');
	}
	if (!Array.isArray(request.samples)
		|| request.samples.length > PRODUCTION_STRIP_METER_WORKER_MAXIMUM_STRIPS) {
		throw new RangeError('A meter worker batch may contain at most 128 strips.');
	}
	return request as ProductionStripMeterWorkerRequest;
}

function positiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function serializeError(value: unknown): Readonly<{ name: string; message: string }> {
	const error = value instanceof Error ? value : new Error('Meter worker processing failed.');
	return Object.freeze({
		name: error.name === 'RangeError' || error.name === 'TypeError' ? error.name : 'Error',
		message: error.message.slice(0, 1_024),
	});
}
