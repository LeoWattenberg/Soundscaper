/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Port adapters for durable Soundscaper delivery.
 *
 * The queue adapter only describes and steers work. The render adapter is the
 * execution boundary: it drains the existing RenderJobHostPort, authenticates
 * the project and exact plan before and after rendering, seals the result, and
 * only then commits the caller-owned destination.
 */

import {
	PLATFORM_TRANSFER_HARD_LIMITS,
	createBoundedPortMessage,
	type BoundedPortMessage,
} from '../platform/bounded-transfer.ts';
import { assertBoundedJsonStructureV1 } from '../bounded-json-structure-v1.ts';
import type { MediaWriteReceipt } from '../platform/media-stream-port.ts';
import type { PersistentRenderQueuePortV1 } from '../platform/persistent-render-queue-port.ts';
import type { RenderJobHostPort, RenderJobPort } from '../platform/render-job-port.ts';
import {
	SOUNDSCAPER_DELIVERY_DESCRIPTION_MESSAGE_TYPE,
	SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE,
	assertSoundscaperDeliveryCurrentV1,
	parseSoundscaperDeliveryPlanV1,
	validateSoundscaperDeliveryDescriptionV1,
	validateSoundscaperDeliveryResultV1,
	type SoundscaperDeliveryCurrentAuthorityV1,
	type SoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryResultV1,
} from '../soundscaper-delivery-contract-v1.ts';
import {
	assertSoundscaperDeliveryPublicationDestinationV1,
	createSoundscaperDeliveryPublicationGuardV1,
	validateSoundscaperDeliveryDestinationV1,
	validateSoundscaperDeliveryPublicationFenceV1,
	type SoundscaperDeliveryDestinationV1,
	type SoundscaperDeliveryPublicationFenceV1,
} from './soundscaper-delivery-publication-v1.ts';

export type {
	SoundscaperDeliveryDestinationV1,
	SoundscaperDeliveryPublicationFenceV1,
} from './soundscaper-delivery-publication-v1.ts';

export const SOUNDSCAPER_DELIVERY_PROGRESS_MESSAGE_TYPE =
	'soundscaper-delivery-progress-v1' as const;

export interface SoundscaperPersistentDeliveryQueueAdapterOptionsV1<Summary, Event> {
	readonly queue: PersistentRenderQueuePortV1<SoundscaperDeliveryDescriptionV1, unknown, unknown>;
	readonly summaryMessageType: string;
	readonly listMessageType: string;
	readonly eventMessageType: string;
	readonly validateSummary: (value: unknown) => Summary;
	readonly validateEvent: (value: unknown) => Event;
}

export interface SoundscaperPersistentDeliveryQueueAdapterV1<Summary, Event> {
	enqueue(request: Readonly<{
		readonly description: SoundscaperDeliveryDescriptionV1 | unknown;
		readonly signal: AbortSignal;
	}>): Promise<Summary>;
	list(request: Readonly<{
		readonly limit: number;
		readonly cursor?: string;
		readonly signal: AbortSignal;
	}>): Promise<readonly Summary[]>;
	events(request: Readonly<{ readonly signal: AbortSignal }>): Promise<Event | null>;
	reorder(request: Readonly<{
		readonly jobId: string;
		readonly position: number;
		readonly signal: AbortSignal;
	}>): Promise<void>;
	pause(request: Readonly<{ readonly jobId: string; readonly signal: AbortSignal }>): Promise<void>;
	resume(request: Readonly<{ readonly jobId: string; readonly signal: AbortSignal }>): Promise<void>;
	cancel(request: Readonly<{ readonly jobId: string; readonly signal: AbortSignal }>): Promise<void>;
	retry(request: Readonly<{ readonly jobId: string; readonly signal: AbortSignal }>): Promise<void>;
}

export interface SoundscaperDeliveryRenderExecutionV1 {
	readonly result: SoundscaperDeliveryResultV1;
	readonly receipt: Readonly<MediaWriteReceipt>;
}

export interface SoundscaperDeliveryRenderJobOptionsV1<Progress> {
	readonly host: RenderJobHostPort<SoundscaperDeliveryDescriptionV1, unknown, SoundscaperDeliveryResultV1>;
	readonly destination: SoundscaperDeliveryDestinationV1 | unknown;
	readonly description: SoundscaperDeliveryDescriptionV1 | unknown;
	readonly signal: AbortSignal;
	readonly currentAuthority: (request: Readonly<{
		readonly description: SoundscaperDeliveryDescriptionV1;
		readonly signal: AbortSignal;
	}>) => PromiseLike<SoundscaperDeliveryCurrentAuthorityV1 | unknown>
		| SoundscaperDeliveryCurrentAuthorityV1 | unknown;
	readonly acquirePublicationFence: (request: Readonly<{
		readonly description: SoundscaperDeliveryDescriptionV1;
		readonly result: SoundscaperDeliveryResultV1;
		readonly destination: SoundscaperDeliveryDestinationV1;
		readonly signal: AbortSignal;
	}>) => PromiseLike<SoundscaperDeliveryPublicationFenceV1 | unknown>
		| SoundscaperDeliveryPublicationFenceV1 | unknown;
	readonly validateExactResult: (request: Readonly<{
		readonly description: SoundscaperDeliveryDescriptionV1;
		readonly plan: unknown;
		readonly result: SoundscaperDeliveryResultV1;
		readonly signal: AbortSignal;
	}>) => PromiseLike<void> | void;
	readonly validateProgress?: (value: unknown) => Progress;
	readonly onProgress?: (progress: Progress) => PromiseLike<void> | void;
}

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const MAXIMUM_QUEUE_PAGE_SIZE = 1_000;
const MAXIMUM_CURSOR_BYTES = 1_024;

/** Bind the exact delivery description to the already-owned durable queue port. */
export function createSoundscaperPersistentDeliveryQueueAdapterV1<Summary, Event>(
	options: SoundscaperPersistentDeliveryQueueAdapterOptionsV1<Summary, Event>,
): SoundscaperPersistentDeliveryQueueAdapterV1<Summary, Event> {
	if (!options?.queue || typeof options.queue !== 'object') {
		throw new TypeError('A Soundscaper persistent delivery queue port is required.');
	}
	for (const method of ['enqueue', 'list', 'events', 'reorder', 'pause', 'resume', 'cancel', 'retry'] as const) {
		if (typeof options.queue[method] !== 'function') {
			throw new TypeError(`The Soundscaper persistent delivery queue port requires ${method}.`);
		}
	}
	const summaryMessageType = messageType(options.summaryMessageType, 'summary');
	const listMessageType = messageType(options.listMessageType, 'list');
	const eventMessageType = messageType(options.eventMessageType, 'event');
	if (typeof options.validateSummary !== 'function' || typeof options.validateEvent !== 'function') {
		throw new TypeError('Soundscaper persistent delivery queue validators are required.');
	}
	let requestSequence = 0;
	let lastEventSequence = -1;
	const queue = options.queue;
	const jobRequest = (request: Readonly<{ jobId: string; signal: AbortSignal }>) => Object.freeze({
		jobId: jobId(request?.jobId),
		signal: operationSignal(request?.signal),
	});

	const adapter: SoundscaperPersistentDeliveryQueueAdapterV1<Summary, Event> = {
		enqueue: async (request) => {
			const signal = operationSignal(request?.signal);
			throwIfAborted(signal);
			const description = validateSoundscaperDeliveryDescriptionV1(request?.description);
			const response = await queue.enqueue({
				description: createBoundedPortMessage(
					SOUNDSCAPER_DELIVERY_DESCRIPTION_MESSAGE_TYPE,
					description,
					{
						sequence: requestSequence++,
						maximumEncodedBytes: PLATFORM_TRANSFER_HARD_LIMITS.messageBytes,
					},
				),
				signal,
			});
			return options.validateSummary(messagePayload(response, summaryMessageType, 'queue summary'));
		},
		list: async (request) => {
			const signal = operationSignal(request?.signal);
			throwIfAborted(signal);
			if (!Number.isSafeInteger(request?.limit) || request.limit < 1
				|| request.limit > MAXIMUM_QUEUE_PAGE_SIZE) {
				throw new RangeError('A persistent delivery queue page limit must be between 1 and 1000.');
			}
			const cursor = request.cursor === undefined ? undefined : boundedCursor(request.cursor);
			const response = await queue.list({ limit: request.limit, ...(cursor ? { cursor } : {}), signal });
			const payload = messagePayload(response, listMessageType, 'queue list');
			if (!Array.isArray(payload) || payload.length > request.limit) {
				throw new RangeError('The persistent delivery queue returned an invalid page.');
			}
			return Object.freeze(payload.map((entry) => options.validateSummary(entry)));
		},
		events: async (request) => {
			const signal = operationSignal(request?.signal);
			throwIfAborted(signal);
			const response = await queue.events({ signal });
			if (response === null) return null;
			const envelope = normalizedMessage(response, eventMessageType, 'queue event');
			if (envelope.sequence <= lastEventSequence) {
				throw new TypeError('The Soundscaper delivery queue event sequence must increase.');
			}
			const event = options.validateEvent(envelope.payload);
			lastEventSequence = envelope.sequence;
			return event;
		},
		reorder: async (request) => {
			if (!Number.isSafeInteger(request?.position) || request.position < 0) {
				throw new RangeError('A persistent delivery queue position must be a non-negative safe integer.');
			}
			await queue.reorder({ ...jobRequest(request), position: request.position });
		},
		pause: async (request) => { await queue.pause(jobRequest(request)); },
		resume: async (request) => { await queue.resume(jobRequest(request)); },
		cancel: async (request) => { await queue.cancel(jobRequest(request)); },
		retry: async (request) => { await queue.retry(jobRequest(request)); },
	};
	return Object.freeze(adapter);
}

/**
 * Execute one admitted job without giving the host publication authority.
 * Report/result/byte validation closes staging first; the caller-owned fence
 * then couples the final currentness decision with the real writer's commit.
 */
export async function executeSoundscaperDeliveryRenderJobV1<Progress = unknown>(
	options: SoundscaperDeliveryRenderJobOptionsV1<Progress>,
): Promise<SoundscaperDeliveryRenderExecutionV1> {
	if (!options?.host || typeof options.host.open !== 'function') {
		throw new TypeError('A Soundscaper delivery render job host is required.');
	}
	if (typeof options.currentAuthority !== 'function') {
		throw new TypeError('A Soundscaper delivery current-authority resolver is required.');
	}
	if (typeof options.acquirePublicationFence !== 'function') {
		throw new TypeError('A Soundscaper delivery publication-fence resolver is required.');
	}
	if (typeof options.validateExactResult !== 'function') {
		throw new TypeError('A Soundscaper delivery exact-result validator is required.');
	}
	const signal = operationSignal(options.signal);
	throwIfAborted(signal);
	const description = validateSoundscaperDeliveryDescriptionV1(options.description);
	const destination = validateSoundscaperDeliveryDestinationV1(options.destination, description);
	const guarded = createSoundscaperDeliveryPublicationGuardV1(destination.writer);
	let job: RenderJobPort<unknown, SoundscaperDeliveryResultV1> | null = null;
	let committed = false;
	try {
		await assertCurrent(options.currentAuthority, description, signal);
		job = await options.host.open({
			request: createBoundedPortMessage(
				SOUNDSCAPER_DELIVERY_DESCRIPTION_MESSAGE_TYPE,
				description,
				{ sequence: 0, maximumEncodedBytes: PLATFORM_TRANSFER_HARD_LIMITS.messageBytes },
			),
			destination: guarded.writer,
			signal,
		});
		assertJob(job);
		let lastSequence = -1;
		for (;;) {
			const message = await job.read({ signal });
			if (message === null) break;
			const envelope = normalizedMessage(message, SOUNDSCAPER_DELIVERY_PROGRESS_MESSAGE_TYPE, 'render progress');
			if (envelope.sequence <= lastSequence) {
				throw new TypeError('Soundscaper delivery progress message sequences must increase.');
			}
			lastSequence = envelope.sequence;
			const progress = options.validateProgress
				? options.validateProgress(envelope.payload)
				: envelope.payload as Progress;
			if (options.onProgress) await options.onProgress(progress);
		}
		const resultEnvelope = normalizedMessage(
			await job.result({ signal }),
			SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE,
			'render result',
		);
		if (resultEnvelope.sequence <= lastSequence) {
			throw new TypeError('The Soundscaper delivery result sequence must follow its progress.');
		}
		const result = validateSoundscaperDeliveryResultV1(resultEnvelope.payload, description);
		assertSoundscaperDeliveryPublicationDestinationV1(result, destination);
		await options.validateExactResult(Object.freeze({
			description,
			plan: parseSoundscaperDeliveryPlanV1(description),
			result,
			signal,
		}));
		throwIfAborted(signal);
		guarded.claimPublication(result.publication);
		throwIfAborted(signal);
		const fence = validateSoundscaperDeliveryPublicationFenceV1(
			await options.acquirePublicationFence(Object.freeze({ description, result, destination, signal })),
			description,
			result,
			destination,
		);
		throwIfAborted(signal);
		guarded.assertPublicationReady();
		const receipt = Object.freeze({ bytesWritten: result.publication.byteLength });
		await fence.commit(Object.freeze({ description, result, destination, signal }));
		committed = true;
		return Object.freeze({ result, receipt });
	} catch (error) {
		const failures: unknown[] = [];
		const cleanupSignal = new AbortController().signal;
		if (job !== null) {
			try { await job.cancel({ signal: cleanupSignal, reason: error }); }
			catch (cleanupError) { failures.push(cleanupError); }
		}
		if (!committed && !guarded.aborted()) {
			try { await destination.writer.abort({ signal: cleanupSignal, reason: error }); }
			catch (cleanupError) { failures.push(cleanupError); }
		}
		if (failures.length > 0) {
			throw new AggregateError([error, ...failures], 'Soundscaper delivery and staging cleanup failed.', {
				cause: error,
			});
		}
		throw error;
	}
}

async function assertCurrent(
	resolver: SoundscaperDeliveryRenderJobOptionsV1<unknown>['currentAuthority'],
	description: SoundscaperDeliveryDescriptionV1,
	signal: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	const current = await resolver(Object.freeze({ description, signal }));
	throwIfAborted(signal);
	assertSoundscaperDeliveryCurrentV1(description, current);
}

const MESSAGE_FIELDS = Object.freeze([
	'kind', 'type', 'sequence', 'payload', 'encodedByteLength', 'maximumEncodedBytes',
]);

function messagePayload(value: unknown, expectedType: string, label: string): unknown {
	return normalizedMessage(value, expectedType, label).payload;
}

function normalizedMessage(
	value: unknown,
	expectedType: string,
	label: string,
): BoundedPortMessage<unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The Soundscaper ${label} must be a bounded port message.`);
	}
	const row = value as Record<string, unknown>;
	// The envelope is a closed shape like every other surface of this contract:
	// an unknown extra field refuses rather than being silently re-encoded away.
	// Symbol keys stay admitted — the local factory brands its messages with a
	// private symbol, and no symbol survives a real port crossing.
	const named = Reflect.ownKeys(row).filter((key): key is string => typeof key === 'string');
	if (named.length !== MESSAGE_FIELDS.length || named.some((key) => !MESSAGE_FIELDS.includes(key))) {
		throw new TypeError(`The Soundscaper ${label} has unsupported message fields.`);
	}
	const kind = ownValue(row, 'kind', label);
	const type = ownValue(row, 'type', label);
	const sequence = ownValue(row, 'sequence', label);
	const payload = ownValue(row, 'payload', label);
	const encodedByteLength = ownValue(row, 'encodedByteLength', label);
	const maximumEncodedBytes = ownValue(row, 'maximumEncodedBytes', label);
	if (kind !== 'message' || type !== expectedType) {
		throw new TypeError(`The Soundscaper ${label} has the wrong message type.`);
	}
	if (!Number.isSafeInteger(sequence) || Number(sequence) < 0
		|| !Number.isSafeInteger(encodedByteLength) || Number(encodedByteLength) < 1
		|| !Number.isSafeInteger(maximumEncodedBytes) || Number(maximumEncodedBytes) < 1) {
		throw new RangeError(`The Soundscaper ${label} has invalid message bounds.`);
	}
	assertBoundedJsonStructureV1(payload);
	const normalized = createBoundedPortMessage(String(type), payload, {
		sequence: Number(sequence), maximumEncodedBytes: Number(maximumEncodedBytes),
	});
	if (normalized.encodedByteLength !== encodedByteLength) {
		throw new RangeError(`The Soundscaper ${label} misstated its encoded byte length.`);
	}
	return normalized;
}

function ownValue(row: Record<string, unknown>, field: string, label: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(row, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`The Soundscaper ${label}.${field} must be an own data property.`);
	}
	return descriptor.value;
}

function assertJob(value: unknown): asserts value is RenderJobPort<unknown, SoundscaperDeliveryResultV1> {
	if (!value || typeof value !== 'object') throw new TypeError('The Soundscaper delivery host returned no job.');
	const job = value as Record<string, unknown>;
	if (typeof job.read !== 'function' || typeof job.result !== 'function' || typeof job.cancel !== 'function') {
		throw new TypeError('The Soundscaper delivery host returned an invalid job.');
	}
}

function messageType(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > 256) {
		throw new TypeError(`A bounded Soundscaper queue ${label} message type is required.`);
	}
	return value;
}

function jobId(value: unknown): string {
	if (typeof value !== 'string' || !JOB_ID.test(value)) {
		throw new TypeError('A bounded opaque Soundscaper delivery job id is required.');
	}
	return value;
}

function boundedCursor(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value !== value.trim()
		|| new TextEncoder().encode(value).byteLength > MAXIMUM_CURSOR_BYTES) {
		throw new TypeError('A bounded persistent delivery queue cursor is required.');
	}
	return value;
}

function operationSignal(value: unknown): AbortSignal {
	if (!value || typeof value !== 'object' || typeof (value as AbortSignal).aborted !== 'boolean'
		|| typeof (value as AbortSignal).addEventListener !== 'function') {
		throw new TypeError('A Soundscaper delivery operation requires an AbortSignal.');
	}
	return value as AbortSignal;
}

function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
	throw new DOMException('The Soundscaper delivery operation was aborted.', 'AbortError');
}
