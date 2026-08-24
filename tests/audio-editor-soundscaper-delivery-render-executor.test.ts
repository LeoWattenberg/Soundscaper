/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createBoundedByteChunk,
	createBoundedPortMessage,
} from '../src/common/editor/platform/bounded-transfer.ts';
import type { RenderJobHostPort } from '../src/common/editor/platform/render-job-port.ts';
import {
	SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE,
	type SoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryResultV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import {
	SOUNDSCAPER_DELIVERY_PROGRESS_MESSAGE_TYPE,
	executeSoundscaperDeliveryRenderJobV1,
} from '../src/common/editor/controller/soundscaper-persistent-delivery-adapter-v1.ts';
import {
	PROJECT,
	boundDestination,
	description,
	publicationFence,
	result,
	successfulHost,
	validateExactResult,
	writer,
	type BoundDestination,
} from './helpers/soundscaper-delivery-adapter-fixtures.ts';

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
