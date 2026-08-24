/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createBoundedByteChunk,
	createBoundedPortMessage,
} from '../src/common/editor/platform/bounded-transfer.ts';
import type { MediaByteWriterPort } from '../src/common/editor/platform/media-stream-port.ts';
import type { PersistentRenderQueuePortV1 } from '../src/common/editor/platform/persistent-render-queue-port.ts';
import type { RenderJobHostPort } from '../src/common/editor/platform/render-job-port.ts';
import {
	SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE,
	createSoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryResultV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import {
	SOUNDSCAPER_DELIVERY_PROGRESS_MESSAGE_TYPE,
	createSoundscaperPersistentDeliveryQueueAdapterV1,
	executeSoundscaperDeliveryRenderJobV1,
} from '../src/common/editor/controller/soundscaper-persistent-delivery-adapter-v1.ts';

const PROJECT = Object.freeze({
	projectId: 'album-project', projectRevision: 17, projectSha256: 'a'.repeat(64),
});

function description() {
	return createSoundscaperDeliveryDescriptionV1({
		label: 'Album master', projectIdentity: PROJECT,
		plan: { format: 'wav', sampleRate: 48_000 },
		destinationGrantId: 'delivery-grant-01',
	});
}

function result(
	expected: SoundscaperDeliveryDescriptionV1,
	byteLength = 4,
	sha256 = createHash('sha256').update(new Uint8Array([1, 2, 3, 4])).digest('hex'),
	fileName = 'master.wav',
	reportSampleRate = 48_000,
): SoundscaperDeliveryResultV1 {
	return {
		kind: 'soundscaper-delivery-result', version: 1,
		projectIdentity: PROJECT, planFingerprint: expected.planFingerprint,
		publication: { fileName, byteLength, sha256 },
		report: {
			schemaVersion: 1, format: 'delivery', direction: 'export',
			subject: {
				format: 'wav', container: 'riff', codec: 'pcm-s24le', sampleRate: reportSampleRate,
				channelCount: 2, lossless: true,
			},
			items: [], counts: { preserved: 0, converted: 0, missing: 0, omitted: 0 },
		},
	};
}

test('the persistent adapter bounds descriptions and validates summaries and events', async () => {
	const calls: Array<readonly [string, unknown]> = [];
	const queue: PersistentRenderQueuePortV1<SoundscaperDeliveryDescriptionV1, unknown, unknown> = {
		enqueue: async (request) => {
			calls.push(['enqueue', request]);
			return createBoundedPortMessage('queue-summary-v1', { jobId: 'job-01', state: 'queued' }, {
				sequence: 9, maximumEncodedBytes: 1_024,
			});
		},
		list: async (request) => {
			calls.push(['list', request]);
			return createBoundedPortMessage('queue-list-v1', [{ jobId: 'job-01', state: 'queued' }], {
				sequence: 10, maximumEncodedBytes: 1_024,
			});
		},
		events: async (request) => {
			calls.push(['events', request]);
			return createBoundedPortMessage('queue-event-v1', { type: 'changed', jobId: 'job-01' }, {
				sequence: 11, maximumEncodedBytes: 1_024,
			});
		},
		reorder: async (request) => { calls.push(['reorder', request]); },
		pause: async (request) => { calls.push(['pause', request]); },
		resume: async (request) => { calls.push(['resume', request]); },
		cancel: async (request) => { calls.push(['cancel', request]); },
		retry: async (request) => { calls.push(['retry', request]); },
	};
	const adapter = createSoundscaperPersistentDeliveryQueueAdapterV1({
		queue,
		summaryMessageType: 'queue-summary-v1',
		listMessageType: 'queue-list-v1',
		eventMessageType: 'queue-event-v1',
		validateSummary: (value) => {
			const row = value as { jobId?: unknown; state?: unknown };
			if (typeof row?.jobId !== 'string' || row.state !== 'queued') throw new TypeError('bad summary');
			return Object.freeze({ jobId: row.jobId, state: row.state });
		},
		validateEvent: (value) => {
			const row = value as { type?: unknown; jobId?: unknown };
			if (row?.type !== 'changed' || typeof row.jobId !== 'string') throw new TypeError('bad event');
			return Object.freeze({ type: row.type, jobId: row.jobId });
		},
	});
	const controller = new AbortController();
	assert.deepEqual(await adapter.enqueue({ description: description(), signal: controller.signal }), {
		jobId: 'job-01', state: 'queued',
	});
	assert.deepEqual(await adapter.list({ limit: 25, cursor: 'page-2', signal: controller.signal }), [{
		jobId: 'job-01', state: 'queued',
	}]);
	assert.deepEqual(await adapter.events({ signal: controller.signal }), {
		type: 'changed', jobId: 'job-01',
	});
	await adapter.reorder({ jobId: 'job-01', position: 3, signal: controller.signal });
	await adapter.pause({ jobId: 'job-01', signal: controller.signal });
	await adapter.resume({ jobId: 'job-01', signal: controller.signal });
	await adapter.cancel({ jobId: 'job-01', signal: controller.signal });
	await adapter.retry({ jobId: 'job-01', signal: controller.signal });

	const enqueueCall = calls[0]?.[1] as { description?: { type?: string; payload?: unknown }; signal?: AbortSignal };
	assert.equal(enqueueCall.description?.type, 'soundscaper-delivery-description-v1');
	assert.deepEqual(enqueueCall.description?.payload, description());
	assert.equal(enqueueCall.signal, controller.signal);
	assert.deepEqual(calls.slice(3).map(([name]) => name), ['reorder', 'pause', 'resume', 'cancel', 'retry']);
});

test('the persistent adapter refuses malformed port messages and unbounded requests', async () => {
	const message = createBoundedPortMessage('wrong-type', { jobId: 'job-01' }, {
		sequence: 0, maximumEncodedBytes: 1_024,
	});
	const queue = {
		enqueue: async () => message,
		list: async () => createBoundedPortMessage('queue-list-v1', [], { sequence: 0, maximumEncodedBytes: 64 }),
		events: async () => null,
		reorder: async () => undefined, pause: async () => undefined, resume: async () => undefined,
		cancel: async () => undefined, retry: async () => undefined,
	} satisfies PersistentRenderQueuePortV1<SoundscaperDeliveryDescriptionV1, unknown, unknown>;
	const adapter = createSoundscaperPersistentDeliveryQueueAdapterV1({
		queue, summaryMessageType: 'queue-summary-v1', listMessageType: 'queue-list-v1',
		eventMessageType: 'queue-event-v1', validateSummary: (value) => value,
		validateEvent: (value) => value,
	});
	const signal = new AbortController().signal;
	await assert.rejects(adapter.enqueue({ description: description(), signal }), /message type/iu);
	await assert.rejects(adapter.list({ limit: 0, signal }), /page limit/iu);
	await assert.rejects(adapter.pause({ jobId: '../job', signal }), /job id/iu);
	await assert.rejects(adapter.reorder({ jobId: 'job-01', position: -1, signal }), /position/iu);

	// The transport envelope is a closed shape like every other surface of this
	// contract: an extra field refuses instead of being re-encoded away.
	const decorated = createSoundscaperPersistentDeliveryQueueAdapterV1({
		queue: {
			...queue,
			list: async () => Object.freeze({
				...createBoundedPortMessage('queue-list-v1', [], { sequence: 0, maximumEncodedBytes: 64 }),
				extra: true,
			}) as never,
		},
		summaryMessageType: 'queue-summary-v1', listMessageType: 'queue-list-v1',
		eventMessageType: 'queue-event-v1', validateSummary: (value) => value,
		validateEvent: (value) => value,
	});
	await assert.rejects(decorated.list({ limit: 1, signal }), /unsupported message fields/iu);
});

test('persistent queue event envelopes must advance monotonically', async () => {
	const adapter = queueAdapterWithEvents([
		createBoundedPortMessage('queue-event-v1', { type: 'changed' }, {
			sequence: 7, maximumEncodedBytes: 1_024,
		}),
		createBoundedPortMessage('queue-event-v1', { type: 'changed' }, {
			sequence: 7, maximumEncodedBytes: 1_024,
		}),
	]);
	const signal = new AbortController().signal;
	assert.deepEqual(await adapter.events({ signal }), { type: 'changed' });
	await assert.rejects(adapter.events({ signal }), /event sequence must increase/iu);

	// The port scopes sequences to one subscription: after the stream ends with
	// null, a re-subscribed binding numbers from zero again, and the adapter
	// must admit that instead of staying wedged on the old floor.
	const resubscribed = queueAdapterWithEvents([
		createBoundedPortMessage('queue-event-v1', { type: 'changed' }, {
			sequence: 5, maximumEncodedBytes: 1_024,
		}),
		null as never,
		createBoundedPortMessage('queue-event-v1', { type: 'restarted' }, {
			sequence: 0, maximumEncodedBytes: 1_024,
		}),
	]);
	assert.deepEqual(await resubscribed.events({ signal }), { type: 'changed' });
	assert.equal(await resubscribed.events({ signal }), null);
	assert.deepEqual(await resubscribed.events({ signal }), { type: 'restarted' });
});

test('persistent queue messages are structurally budgeted before JSON re-encoding', async () => {
	const adapter = queueAdapterWithEvents([
		createBoundedPortMessage('queue-event-v1', {
			type: 'changed', values: Array.from({ length: 9_000 }, () => null),
		}, { sequence: 1, maximumEncodedBytes: 64 * 1_024 }),
	]);
	await assert.rejects(
		adapter.events({ signal: new AbortController().signal }),
		/structural node budget/iu,
	);
});

test('the render adapter seals and verifies a result before it alone commits publication', async () => {
	const expected = description();
	const order: string[] = [];
	const destination = boundDestination(writer(order));
	const host: RenderJobHostPort<SoundscaperDeliveryDescriptionV1, unknown, SoundscaperDeliveryResultV1> = {
		open: async ({ request, destination: guarded, signal }) => {
			order.push('open');
			assert.equal(request.payload.planFingerprint, expected.planFingerprint);
			await guarded.write({
				signal,
				chunk: createBoundedByteChunk(new Uint8Array([1, 2, 3, 4]), {
					sequence: 0, maximumByteLength: 4, final: true,
				}),
			});
			let read = false;
			return {
				read: async () => {
					if (read) return null;
					read = true;
					order.push('progress');
					return createBoundedPortMessage(SOUNDSCAPER_DELIVERY_PROGRESS_MESSAGE_TYPE, {
						completed: 4, total: 4,
					}, { sequence: 0, maximumEncodedBytes: 256 });
				},
				result: async () => {
					order.push('result');
					return createBoundedPortMessage(SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE, result(expected), {
						sequence: 1, maximumEncodedBytes: 4_096,
					});
				},
				cancel: async () => { order.push('cancel'); },
			};
		},
	};
	const progress: unknown[] = [];
	const execution = await executeSoundscaperDeliveryRenderJobV1({
		host, destination, description: expected, signal: new AbortController().signal,
		currentAuthority: () => {
			order.push('authority');
			return { projectIdentity: PROJECT, planFingerprint: expected.planFingerprint };
		},
		acquirePublicationFence: publicationFence(expected, () => { order.push('fence'); }),
		validateExactResult,
		validateProgress: (value) => value as { completed: number; total: number },
		onProgress: (value) => { progress.push(value); },
	});

	assert.deepEqual(order, ['authority', 'open', 'write', 'progress', 'result', 'fence', 'commit']);
	assert.deepEqual(progress, [{ completed: 4, total: 4 }]);
	assert.equal(execution.receipt.bytesWritten, 4);
	assert.equal(Object.isFrozen(execution.result.report), true);
	assert.equal(Object.isFrozen(execution), true);
});

test('progress and result sequences must advance through the executor', async () => {
	// A replayed or reordered envelope is refused, not re-applied: the render
	// host owns one strictly increasing sequence across progress and result.
	const staleProgress = (sequences: readonly number[], resultSequence: number) => {
		const expected = description();
		const order: string[] = [];
		let reads = 0;
		const host: RenderJobHostPort<
			SoundscaperDeliveryDescriptionV1, unknown, SoundscaperDeliveryResultV1
		> = {
			open: async ({ destination: guarded, signal }) => {
				await guarded.write({
					signal,
					chunk: createBoundedByteChunk(new Uint8Array([1, 2, 3, 4]), {
						sequence: 0, maximumByteLength: 4, final: true,
					}),
				});
				return {
					read: async () => (reads < sequences.length
						? createBoundedPortMessage(SOUNDSCAPER_DELIVERY_PROGRESS_MESSAGE_TYPE, {
							completed: 1, total: 4,
						}, { sequence: sequences[reads++]!, maximumEncodedBytes: 256 })
						: null),
					result: async () => createBoundedPortMessage(
						SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE, result(expected),
						{ sequence: resultSequence, maximumEncodedBytes: 4_096 },
					),
					cancel: async () => { order.push('cancel'); },
				};
			},
		};
		return executeSoundscaperDeliveryRenderJobV1({
			host, destination: boundDestination(writer(order)), description: expected,
			signal: new AbortController().signal,
			currentAuthority: () => ({
				projectIdentity: PROJECT, planFingerprint: expected.planFingerprint,
			}),
			acquirePublicationFence: publicationFence(expected, () => undefined),
			validateExactResult,
		});
	};
	await assert.rejects(
		staleProgress([2, 2], 3),
		/progress message sequences must increase/iu,
	);
	await assert.rejects(
		staleProgress([2], 2),
		/result sequence must follow its progress/iu,
	);
	await assert.doesNotReject(staleProgress([2], 3));
});

test('the caller-owned publication fence is single-use', async () => {
	const { validateSoundscaperDeliveryPublicationFenceV1, validateSoundscaperDeliveryDestinationV1 } = await import(
		'../src/common/editor/controller/soundscaper-delivery-publication-v1.ts');
	const expected = description();
	const output = result(expected);
	const destination = validateSoundscaperDeliveryDestinationV1(
		boundDestination(writer([])), expected,
	);
	let commits = 0;
	const fence = validateSoundscaperDeliveryPublicationFenceV1({
		authority: { projectIdentity: PROJECT, planFingerprint: expected.planFingerprint },
		destinationGrantId: expected.destinationGrantId,
		fileName: output.publication.fileName,
		commit: () => { commits += 1; },
	}, expected, output, destination);
	const request = Object.freeze({
		description: expected, result: output, destination,
		signal: new AbortController().signal,
	});
	fence.commit(request);
	assert.equal(commits, 1);
	assert.throws(() => fence.commit(request), /already consumed/iu);
	assert.equal(commits, 1);
});

test('a project edit during rendering aborts staging and never commits stale bytes', async () => {
	const expected = description();
	const order: string[] = [];
	const destination = boundDestination(writer(order));
	const host: RenderJobHostPort<SoundscaperDeliveryDescriptionV1, unknown, SoundscaperDeliveryResultV1> = {
		open: async ({ destination: guarded, signal }) => {
			await guarded.write({
				signal,
				chunk: createBoundedByteChunk(new Uint8Array([1, 2, 3, 4]), {
					sequence: 0, maximumByteLength: 4, final: true,
				}),
			});
			return {
				read: async () => null,
				result: async () => createBoundedPortMessage(
					SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE, result(expected),
					{ sequence: 0, maximumEncodedBytes: 4_096 },
				),
				cancel: async () => { order.push('cancel'); },
			};
		},
	};
	await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
		host, destination, description: expected, signal: new AbortController().signal,
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: () => ({
			authority: {
				projectIdentity: { ...PROJECT, projectRevision: 18 },
				planFingerprint: expected.planFingerprint,
			},
			destinationGrantId: expected.destinationGrantId,
			fileName: destination.fileName,
			commit: async () => { throw new Error('unreachable'); },
		}),
		validateExactResult,
	}), /project changed/iu);
	assert.deepEqual(order, ['write', 'cancel', 'abort']);
});

test('the render host cannot bypass report validation by committing its writer', async () => {
	const expected = description();
	const order: string[] = [];
	const destination = boundDestination(writer(order));
	const host: RenderJobHostPort<SoundscaperDeliveryDescriptionV1, unknown, SoundscaperDeliveryResultV1> = {
		open: async ({ destination: guarded, signal }) => ({
			read: async () => null,
			result: async () => {
				await guarded.commit({ signal });
				throw new Error('unreachable');
			},
			cancel: async () => { order.push('cancel'); },
		}),
	};
	await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
		host, destination, description: expected, signal: new AbortController().signal,
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: publicationFence(expected),
		validateExactResult,
	}), /must not commit/iu);
	assert.deepEqual(order, ['cancel', 'abort']);
});

test('publication refuses a result whose digest does not authenticate the staged bytes', async () => {
	const expected = description();
	const order: string[] = [];
	const destination = boundDestination(writer(order));
	const host: RenderJobHostPort<SoundscaperDeliveryDescriptionV1, unknown, SoundscaperDeliveryResultV1> = {
		open: async ({ destination: guarded, signal }) => {
			await guarded.write({
				signal,
				chunk: createBoundedByteChunk(new Uint8Array([1, 2, 3, 4]), {
					sequence: 0, maximumByteLength: 4, final: true,
				}),
			});
			return {
				read: async () => null,
				result: async () => createBoundedPortMessage(
					SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE,
					result(expected, 4, 'd'.repeat(64)),
					{ sequence: 0, maximumEncodedBytes: 4_096 },
				),
				cancel: async () => { order.push('cancel'); },
			};
		},
	};
	await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
		host, destination, description: expected, signal: new AbortController().signal,
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: publicationFence(expected),
		validateExactResult,
	}), /digest disagrees/iu);
	assert.deepEqual(order, ['write', 'cancel', 'abort']);
});

test('a render host cannot abort staging and then return a successful result', async () => {
	const expected = description();
	const order: string[] = [];
	const destination = boundDestination(writer(order));
	const host: RenderJobHostPort<SoundscaperDeliveryDescriptionV1, unknown, SoundscaperDeliveryResultV1> = {
		open: async ({ destination: guarded, signal }) => {
			await guarded.write({
				signal,
				chunk: createBoundedByteChunk(new Uint8Array([1, 2, 3, 4]), {
					sequence: 0, maximumByteLength: 4, final: true,
				}),
			});
			return {
				read: async () => null,
				result: async () => {
					await guarded.abort({ signal, reason: new Error('host aborted') });
					return createBoundedPortMessage(
						SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE, result(expected),
						{ sequence: 0, maximumEncodedBytes: 4_096 },
					);
				},
				cancel: async () => { order.push('cancel'); },
			};
		},
	};
	await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
		host, destination, description: expected, signal: new AbortController().signal,
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: publicationFence(expected),
		validateExactResult,
	}), /staging writer is closed/iu);
	assert.deepEqual(order, ['write', 'abort', 'cancel']);
});

test('the caller-owned publication fence closes the project-revision TOCTOU', async () => {
	const expected = description();
	const order: string[] = [];
	const destination = boundDestination(writer(order));
	let currentRevision = PROJECT.projectRevision;
	const host = successfulHost(expected, order);
	await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
		host, destination, description: expected, signal: new AbortController().signal,
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: () => {
			const leasedRevision = currentRevision;
			currentRevision += 1;
			return {
				authority: { projectIdentity: PROJECT, planFingerprint: expected.planFingerprint },
				destinationGrantId: expected.destinationGrantId,
				fileName: destination.fileName,
				commit: async ({ destination: fencedDestination, signal }: {
					destination: BoundDestination; signal: AbortSignal;
				}) => {
					if (currentRevision !== leasedRevision) throw new Error('The publication fence is stale.');
					await fencedDestination.writer.commit({ signal });
				},
			};
		},
		validateExactResult,
	}), /publication fence is stale/iu);
	assert.deepEqual(order, ['write', 'cancel', 'abort']);
});

test('post-commit receipt metadata cannot retroactively turn a publication into failure', async () => {
	const expected = description();
	const order: string[] = [];
	const destination = boundDestination(writer(order, 999));
	const execution = await executeSoundscaperDeliveryRenderJobV1({
		host: successfulHost(expected, order),
		destination, description: expected, signal: new AbortController().signal,
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: publicationFence(expected),
		validateExactResult,
	});
	assert.deepEqual(execution.receipt, { bytesWritten: 4 });
	assert.deepEqual(order, ['write', 'commit']);
});

test('staging requires contiguous byte-chunk sequences beginning at zero', async () => {
	const expected = description();
	const order: string[] = [];
	const destination = boundDestination(writer(order));
	const host: RenderJobHostPort<SoundscaperDeliveryDescriptionV1, unknown, SoundscaperDeliveryResultV1> = {
		open: async ({ destination: guarded, signal }) => {
			await guarded.write({
				signal,
				chunk: createBoundedByteChunk(new Uint8Array([1, 2, 3, 4]), {
					sequence: 1, maximumByteLength: 4, final: true,
				}),
			});
			throw new Error('unreachable');
		},
	};
	await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
		host, destination, description: expected, signal: new AbortController().signal,
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: publicationFence(expected),
		validateExactResult,
	}), /chunk sequence/iu);
	assert.deepEqual(order, ['abort']);
});

test('staging requires exactly one final byte chunk before publication', async () => {
	const expected = description();
	const order: string[] = [];
	const destination = boundDestination(writer(order));
	const host = successfulHost(expected, order, false);
	await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
		host, destination, description: expected, signal: new AbortController().signal,
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: publicationFence(expected),
		validateExactResult,
	}), /final byte chunk/iu);
	assert.deepEqual(order, ['write', 'cancel', 'abort']);
});

test('the destination writer is bound to the description grant before rendering', async () => {
	const expected = description();
	const order: string[] = [];
	await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
		host: successfulHost(expected, order),
		destination: boundDestination(writer(order), 'different-grant-01'),
		description: expected,
		signal: new AbortController().signal,
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: publicationFence(expected),
		validateExactResult,
	}), /destination grant/iu);
	assert.deepEqual(order, []);
});

test('publication and its revision fence must name the destination file exactly', async () => {
	const expected = description();
	const digest = createHash('sha256').update(new Uint8Array([1, 2, 3, 4])).digest('hex');
	const output = result(expected, 4, digest, 'different.wav');
	const order: string[] = [];
	await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
		host: successfulHost(expected, order, true, output),
		destination: boundDestination(writer(order)),
		description: expected,
		signal: new AbortController().signal,
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: publicationFence(expected),
		validateExactResult,
	}), /publication file name/iu);
	assert.deepEqual(order, ['write', 'cancel', 'abort']);

	const fenceOrder: string[] = [];
	await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
		host: successfulHost(expected, fenceOrder),
		destination: boundDestination(writer(fenceOrder)),
		description: expected,
		signal: new AbortController().signal,
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: publicationFence(expected, undefined, 'wrong.wav'),
		validateExactResult,
	}), /fence file name/iu);
	assert.deepEqual(fenceOrder, ['write', 'cancel', 'abort']);
});

test('an injected exact-plan validator binds report semantics before publication', async () => {
	const expected = description();
	const digest = createHash('sha256').update(new Uint8Array([1, 2, 3, 4])).digest('hex');
	const output = result(expected, 4, digest, 'master.wav', 44_100);
	const order: string[] = [];
	await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
		host: successfulHost(expected, order, true, output),
		destination: boundDestination(writer(order)),
		description: expected,
		signal: new AbortController().signal,
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: publicationFence(expected),
		validateExactResult,
	}), /report semantics.*exact plan/iu);
	assert.deepEqual(order, ['write', 'cancel', 'abort']);
});

function publicationFence(
	expected: SoundscaperDeliveryDescriptionV1,
	onAcquire?: () => void,
	fileName = 'master.wav',
) {
	return () => {
		onAcquire?.();
		return {
			authority: { projectIdentity: PROJECT, planFingerprint: expected.planFingerprint },
			destinationGrantId: expected.destinationGrantId,
			fileName,
			commit: async ({ destination, signal }: {
				destination: BoundDestination; signal: AbortSignal;
			}) => { await destination.writer.commit({ signal }); },
		};
	};
}

function successfulHost(
	expected: SoundscaperDeliveryDescriptionV1, order: string[], final = true, output = result(expected),
): RenderJobHostPort<SoundscaperDeliveryDescriptionV1, unknown, SoundscaperDeliveryResultV1> {
	return {
		open: async ({ destination, signal }) => {
			await destination.write({
				signal,
				chunk: createBoundedByteChunk(new Uint8Array([1, 2, 3, 4]), {
					sequence: 0, maximumByteLength: 4, final,
				}),
			});
			return {
				read: async () => null,
				result: async () => createBoundedPortMessage(
					SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE, output,
					{ sequence: 0, maximumEncodedBytes: 4_096 },
				),
				cancel: async () => { order.push('cancel'); },
			};
		},
	};
}

type BoundDestination = Readonly<{
	destinationGrantId: string; fileName: string; writer: MediaByteWriterPort;
}>;

function boundDestination(
	boundWriter: MediaByteWriterPort, destinationGrantId = 'delivery-grant-01', fileName = 'master.wav',
): BoundDestination {
	return Object.freeze({ destinationGrantId, fileName, writer: boundWriter });
}

function validateExactResult(request: Readonly<{
	readonly plan: unknown;
	readonly result: SoundscaperDeliveryResultV1;
}>): void {
	const plan = request.plan as Readonly<{ sampleRate?: unknown }>;
	if (request.result.report.subject.sampleRate !== plan.sampleRate) {
		throw new Error('The delivery report semantics do not match the exact plan.');
	}
}

function queueAdapterWithEvents(
	events: readonly ReturnType<typeof createBoundedPortMessage>[],
) {
	let eventIndex = 0;
	const queue: PersistentRenderQueuePortV1<SoundscaperDeliveryDescriptionV1, unknown, unknown> = {
		enqueue: async () => createBoundedPortMessage('queue-summary-v1', {}, {
			sequence: 0, maximumEncodedBytes: 1_024,
		}),
		list: async () => createBoundedPortMessage('queue-list-v1', [], {
			sequence: 0, maximumEncodedBytes: 1_024,
		}),
		events: async () => events[eventIndex++] ?? null,
		reorder: async () => undefined, pause: async () => undefined,
		resume: async () => undefined, cancel: async () => undefined, retry: async () => undefined,
	};
	return createSoundscaperPersistentDeliveryQueueAdapterV1({
		queue,
		summaryMessageType: 'queue-summary-v1',
		listMessageType: 'queue-list-v1',
		eventMessageType: 'queue-event-v1',
		validateSummary: (value) => value, validateEvent: (value) => value,
	});
}

function writer(order: string[], receiptBytes?: number): MediaByteWriterPort {
	let bytesWritten = 0;
	return {
		maximumChunkBytes: 16,
		get bytesWritten() { return bytesWritten; },
		write: async ({ chunk }) => {
			order.push('write');
			bytesWritten += chunk.byteLength;
		},
		commit: async () => {
			order.push('commit');
			return Object.freeze({ bytesWritten: receiptBytes ?? bytesWritten });
		},
		abort: async () => { order.push('abort'); },
	};
}
