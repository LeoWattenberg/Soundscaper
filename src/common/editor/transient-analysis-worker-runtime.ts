/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	detectPcmTransients,
	type DetectPcmTransientsOptions,
	type TransientAnalysisResult,
} from './transient-analysis.ts';

export const TRANSIENT_ANALYSIS_WORKER_REQUEST = 'transient-analysis/v1' as const;

export type TransientAnalysisWorkerResponse = Readonly<{
	type: 'result';
	requestId: string;
	result: Readonly<TransientAnalysisResult>;
}> | Readonly<{
	type: 'error';
	requestId: string | null;
	error: Readonly<{ name: string; message: string }>;
}>;

const REQUEST_KEYS = new Set(['type', 'requestId', 'channels', 'options']);
const OPTION_KEYS = new Set(['sourceStartFrame', 'channelPolicy', 'parameters']);

/** Execute one closed, stateless detector request inside a dedicated worker. */
export function executeTransientAnalysisWorkerRequest(
	value: unknown,
): TransientAnalysisWorkerResponse {
	let requestId: string | null = null;
	try {
		const request = closedRecord(value, REQUEST_KEYS, 'transient analysis worker request');
		requestId = boundedId(request.requestId);
		if (request.type !== TRANSIENT_ANALYSIS_WORKER_REQUEST) {
			throw new TypeError('The transient analysis worker request type is unsupported.');
		}
		if (!Array.isArray(request.channels)) {
			throw new TypeError('Transient analysis worker channels must be an array.');
		}
		const channels = request.channels.map((channel) => {
			if (!(channel instanceof Float32Array)) {
				throw new TypeError('Transient analysis worker channels must be Float32Array values.');
			}
			return channel;
		});
		const options = normalizeOptions(request.options);
		return Object.freeze({
			type: 'result',
			requestId,
			result: detectPcmTransients(channels, options),
		});
	} catch (error) {
		return Object.freeze({
			type: 'error',
			requestId,
			error: safeError(error),
		});
	}
}

function normalizeOptions(value: unknown): Readonly<DetectPcmTransientsOptions> {
	const candidate = closedRecord(value ?? {}, OPTION_KEYS, 'transient analysis worker options');
	return Object.freeze({
		...(candidate.sourceStartFrame === undefined ? {} : { sourceStartFrame: candidate.sourceStartFrame as number }),
		...(candidate.channelPolicy === undefined ? {} : {
			channelPolicy: candidate.channelPolicy as DetectPcmTransientsOptions['channelPolicy'],
		}),
		...(candidate.parameters === undefined ? {} : {
			parameters: candidate.parameters as DetectPcmTransientsOptions['parameters'],
		}),
	});
}

function closedRecord(
	value: unknown,
	keys: ReadonlySet<string>,
	name: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object.`);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !keys.has(key)) throw new RangeError(`Unknown ${name} field: ${String(key)}.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} fields must be enumerable data properties.`);
		}
	}
	return value as Record<string, unknown>;
}

function boundedId(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 160 || value.trim() !== value) {
		throw new TypeError('A bounded transient analysis worker request id is required.');
	}
	return value;
}

function safeError(error: unknown): Readonly<{ name: string; message: string }> {
	return Object.freeze({
		name: error instanceof Error ? error.name : 'Error',
		message: error instanceof Error ? error.message : String(error),
	});
}
