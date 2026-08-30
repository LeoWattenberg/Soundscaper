/* SPDX-License-Identifier: AGPL-3.0-only */

import { ReviewedEffectError, reviewedEffectError } from './errors.ts';
import {
	ReviewedEffectWasmRuntime,
	loadReviewedEffectPackage,
	type ReviewedEffectProcessRequest,
} from './runtime.ts';

export const REVIEWED_EFFECT_WORKER_REQUEST = 'reviewed-effect-process/v1' as const;
export const REVIEWED_EFFECT_WORKER_PREPARE = 'reviewed-effect-prepare/v1' as const;

export type ReviewedEffectWorkerResponse = Readonly<{
	type: 'ready';
	requestId: string;
	packageKey: string;
}> | Readonly<{
	type: 'result';
	requestId: string;
	packageKey: string;
	channels: readonly Float32Array[];
}> | Readonly<{
	type: 'error';
	requestId: string | null;
	error: Readonly<{ name: string; code: string; message: string }>;
}>;

const PREPARE_KEYS = new Set(['type', 'requestId', 'package']);
const PROCESS_KEYS = new Set(['type', 'requestId', 'sampleRate', 'channels', 'parameters']);

export interface ReviewedEffectWorkerRuntime {
	execute(value: unknown): Promise<ReviewedEffectWorkerResponse>;
}

type PreparedRuntime = Readonly<{
	requestId: string;
	packageKey: string;
	runtime: ReviewedEffectWasmRuntime;
}>;

/** Create the single-use, two-phase runtime owned by one terminating worker. */
export function createReviewedEffectWorkerRuntime(): ReviewedEffectWorkerRuntime {
	let prepared: PreparedRuntime | null = null;
	return Object.freeze({
		async execute(value: unknown): Promise<ReviewedEffectWorkerResponse> {
			let requestId: string | null = null;
			try {
				const type = closedRecordType(value);
				if (type === REVIEWED_EFFECT_WORKER_PREPARE) {
					const request = closedRecord(value, PREPARE_KEYS, 'reviewed effect worker preparation');
					requestId = boundedRequestId(request.requestId);
					if (prepared !== null) {
						throw reviewedEffectError('WORKER_PROTOCOL', 'Reviewed effect worker is already prepared.');
					}
					const loadedPackage = await loadReviewedEffectPackage(request.package);
					prepared = Object.freeze({
						requestId,
						packageKey: loadedPackage.key,
						runtime: new ReviewedEffectWasmRuntime(loadedPackage),
					});
					return Object.freeze({ type: 'ready', requestId, packageKey: loadedPackage.key });
				}
				if (type !== REVIEWED_EFFECT_WORKER_REQUEST) {
					throw reviewedEffectError('WORKER_PROTOCOL', 'Reviewed effect worker request type is unsupported.');
				}
				const request = closedRecord(value, PROCESS_KEYS, 'reviewed effect worker request');
				requestId = boundedRequestId(request.requestId);
				if (prepared === null || prepared.requestId !== requestId) {
					throw reviewedEffectError('WORKER_PROTOCOL', 'Reviewed effect worker was not prepared for this request.');
				}
				if (!Array.isArray(request.channels)) {
					throw reviewedEffectError('INPUT_LIMIT', 'Reviewed effect worker channels must be an array.');
				}
				const channels = request.channels.map((channel) => {
					if (!(channel instanceof Float32Array)) {
						throw reviewedEffectError('INPUT_LIMIT', 'Reviewed effect worker channels must contain Float32Array values.');
					}
					return channel;
				});
				const admitted = prepared;
				prepared = null;
				const result = admitted.runtime.process({
					sampleRate: request.sampleRate as number,
					channels,
					parameters: request.parameters as ReviewedEffectProcessRequest['parameters'],
				});
				return Object.freeze({
					type: 'result',
					requestId,
					packageKey: admitted.packageKey,
					channels: result,
				});
			} catch (error) {
				return Object.freeze({
					type: 'error',
					requestId,
					error: serializeError(error),
				});
			}
		},
	});
}

function closedRecordType(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw reviewedEffectError('WORKER_PROTOCOL', 'reviewed effect worker request must be an object.');
	}
	return Object.getOwnPropertyDescriptor(value, 'type')?.value;
}

export function reviewedEffectResponseTransferables(
	response: ReviewedEffectWorkerResponse,
): readonly ArrayBuffer[] {
	if (response.type !== 'result') return Object.freeze([]);
	return Object.freeze(response.channels.map((channel) => channel.buffer as ArrayBuffer));
}

function closedRecord(value: unknown, keys: ReadonlySet<string>, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw reviewedEffectError('WORKER_PROTOCOL', `${name} must be an object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw reviewedEffectError('WORKER_PROTOCOL', `${name} must be a plain object.`);
	}
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.length !== keys.size) {
		throw reviewedEffectError('WORKER_PROTOCOL', `${name} must contain exactly its closed schema fields.`);
	}
	for (const key of ownKeys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (typeof key !== 'string' || !keys.has(key) || !descriptor?.enumerable
			|| !Object.hasOwn(descriptor, 'value')) {
			throw reviewedEffectError('WORKER_PROTOCOL', `Unknown or invalid ${name} field: ${String(key)}.`);
		}
	}
	return value as Record<string, unknown>;
}

function boundedRequestId(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 160 || value.trim() !== value) {
		throw reviewedEffectError('WORKER_PROTOCOL', 'A bounded reviewed effect worker request id is required.');
	}
	return value;
}

function serializeError(error: unknown): Readonly<{ name: string; code: string; message: string }> {
	const normalized = error instanceof ReviewedEffectError
		? error
		: reviewedEffectError(
			'PROCESSING_FAILED',
			error instanceof Error ? error.message : 'Reviewed effect processing failed.',
			error,
		);
	return Object.freeze({ name: normalized.name, code: normalized.code, message: normalized.message });
}
