/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared delivery description, result, host, and destination fixtures. */

import { createHash } from 'node:crypto';

import {
	createBoundedByteChunk,
	createBoundedPortMessage,
} from '../../src/common/editor/platform/bounded-transfer.ts';
import type { MediaByteWriterPort } from '../../src/common/editor/platform/media-stream-port.ts';
import type { RenderJobHostPort } from '../../src/common/editor/platform/render-job-port.ts';
import {
	SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE,
	createSoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryResultV1,
} from '../../src/common/editor/soundscaper-delivery-contract-v1.ts';

export const PROJECT = Object.freeze({
	projectId: 'album-project', projectRevision: 17, projectSha256: 'a'.repeat(64),
});

export function description() {
	return createSoundscaperDeliveryDescriptionV1({
		label: 'Album master', projectIdentity: PROJECT,
		plan: { format: 'wav', sampleRate: 48_000 },
		destinationGrantId: 'delivery-grant-01',
	});
}

export function result(
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

export function publicationFence(
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

export function successfulHost(
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

export type BoundDestination = Readonly<{
	destinationGrantId: string; fileName: string; writer: MediaByteWriterPort;
}>;

export function boundDestination(
	boundWriter: MediaByteWriterPort, destinationGrantId = 'delivery-grant-01', fileName = 'master.wav',
): BoundDestination {
	return Object.freeze({ destinationGrantId, fileName, writer: boundWriter });
}

export function validateExactResult(request: Readonly<{
	readonly plan: unknown;
	readonly result: SoundscaperDeliveryResultV1;
}>): void {
	const plan = request.plan as Readonly<{ sampleRate?: unknown }>;
	if (request.result.report.subject.sampleRate !== plan.sampleRate) {
		throw new Error('The delivery report semantics do not match the exact plan.');
	}
}

export function writer(order: string[], receiptBytes?: number): MediaByteWriterPort {
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
