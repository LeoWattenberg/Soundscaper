/* SPDX-License-Identifier: AGPL-3.0-only */

/** Candidate production ports over the pathless, main-owned desktop import authority. */

import {
	NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES,
} from '../common/editor/native-media-image-sequence-pack-v25.ts';
import type {
	NativeMediaImageSequenceInventoryReferenceV25,
	NativeMediaImageSequenceSourcePackReferenceV25,
	NativeMediaImageSequenceSourcePackWriterV25,
} from '../common/editor/native-media-image-sequence-v25.ts';
import type {
	FramescaperImageSequenceImportPortsV25,
	FramescaperImageSequenceNativeAdmissionRequestV25,
} from './editor-native-image-sequence-import-v25.ts';

const TRANSACTION_ID = /^[a-f0-9]{40}$/u;

export interface FramescaperNativeImageSequenceImportRendererPortV25 {
	imageSequenceImport(request: unknown): Promise<unknown>;
	readImageSequenceImportBody(request: Readonly<{
		transactionId: string;
		asset: 'pack' | 'inventory';
		offset: number;
		length: number;
	}>): Promise<Uint8Array>;
	writeImageSequenceImportChunk(request: Readonly<{
		transactionId: string;
		asset: 'pack' | 'inventory';
		offset: number;
		bytes: Uint8Array;
	}>): Promise<unknown>;
}

export interface FramescaperImageSequenceProductionPortsOptionsV25 {
	readonly bridge: FramescaperNativeImageSequenceImportRendererPortV25 & Readonly<{
		capabilities(): Promise<unknown>;
	}>;
	readonly candidateGeneration: 25 | 26 | 28;
	readonly projectId: string;
	readonly projectRevision: number;
}

export interface FramescaperImageSequenceProductionPortsV25
	extends FramescaperImageSequenceImportPortsV25 {
	readCommittedBody(request: Readonly<{
		asset: 'pack' | 'inventory';
		reference: NativeMediaImageSequenceInventoryReferenceV25
			| NativeMediaImageSequenceSourcePackReferenceV25;
		offset: number;
		length: number;
	}>): Promise<Uint8Array>;
}

/** One factory instance owns one import transaction and cannot be replayed. */
export function createFramescaperImageSequenceProductionPortsV25(
	options: FramescaperImageSequenceProductionPortsOptionsV25,
): FramescaperImageSequenceProductionPortsV25 {
	let transactionId: string | null = null;
	let packReference: NativeMediaImageSequenceSourcePackReferenceV25 | null = null;
	let inventoryReference: NativeMediaImageSequenceInventoryReferenceV25 | null = null;
	let disposed = false;
	let writerCreated = false;
	let admittedSourceId: string | null = null;

	const control = (request: unknown): Promise<unknown> => options.bridge.imageSequenceImport(request);
	const discard = async (): Promise<void> => {
		if (disposed || transactionId === null) return;
		disposed = true;
		await control({ operation: 'discard', transactionId });
	};
	return Object.freeze({
		capabilities: () => options.bridge.capabilities(),
		async readCommittedBody(request: Parameters<FramescaperImageSequenceProductionPortsV25['readCommittedBody']>[0]) {
			const id = activeTransaction(transactionId, disposed);
			const reference = request.asset === 'pack' ? packReference : inventoryReference;
			if (reference === null || JSON.stringify(reference) !== JSON.stringify(request.reference)) {
				throw new Error('The image-sequence body read does not name this committed transaction asset.');
			}
			return options.bridge.readImageSequenceImportBody({
				transactionId: id, asset: request.asset,
				offset: request.offset, length: request.length,
			});
		},
		async createSourcePackWriter(): Promise<NativeMediaImageSequenceSourcePackWriterV25> {
			if (writerCreated || disposed) throw new Error('The candidate image-sequence writer is single-use.');
			writerCreated = true;
			const response = record(await control({
				operation: 'begin', candidateGeneration: options.candidateGeneration,
				projectId: options.projectId, projectRevision: options.projectRevision,
			}), ['operation', 'transactionId'], 'image-sequence begin response');
			if (response.operation !== 'begun' || typeof response.transactionId !== 'string'
				|| !TRANSACTION_ID.test(response.transactionId)) {
				throw new Error('Main returned an invalid image-sequence transaction identity.');
			}
			transactionId = response.transactionId;
			let offset = 0;
			let committed = false;
			return Object.freeze({
				async write(bytes: Uint8Array): Promise<void> {
					if (committed || disposed || transactionId === null) throw new Error('The source-pack writer is closed.');
					await writeChunks(options.bridge, transactionId, 'pack', bytes, offset);
					offset += bytes.byteLength;
				},
				async commit(reference: NativeMediaImageSequenceSourcePackReferenceV25): Promise<void> {
					if (committed || disposed || transactionId === null) throw new Error('The source-pack writer is closed.');
					await control({ operation: 'commit', transactionId, asset: 'pack', reference });
					packReference = reference;
					committed = true;
				},
				discard,
			});
		},
		async publishInventory(
			bytes: Uint8Array,
			reference: NativeMediaImageSequenceInventoryReferenceV25,
		): Promise<void> {
			const id = activeTransaction(transactionId, disposed);
			await writeChunks(options.bridge, id, 'inventory', bytes, 0);
			await control({ operation: 'commit', transactionId: id, asset: 'inventory', reference });
			inventoryReference = reference;
		},
		cleanupInventory: async () => discard(),
		async admit(request: FramescaperImageSequenceNativeAdmissionRequestV25): Promise<unknown> {
			const id = activeTransaction(transactionId, disposed);
			if (!packReference || !inventoryReference) throw new Error('Both durable sequence assets must be committed.');
			const response = record(await control({ operation: 'admit', transactionId: id, admission: request }),
				['operation', 'transactionId', 'result'], 'image-sequence admission response');
			if (response.operation !== 'admitted' || response.transactionId !== id) {
				throw new Error('Main returned admission for another image-sequence transaction.');
			}
			admittedSourceId = request.sourceId;
			return response.result;
		},
		async complete(request: FramescaperImageSequenceNativeAdmissionRequestV25): Promise<void> {
			const id = activeTransaction(transactionId, disposed);
			if (!packReference || !inventoryReference || admittedSourceId !== request.sourceId) {
				throw new Error('The candidate image sequence is not ready for durable settlement.');
			}
			const response = record(await control({
				operation: 'complete', transactionId: id, sourceId: request.sourceId,
				inventorySha256: inventoryReference.sha256,
				sourcePackSha256: packReference.sha256,
			}), ['operation', 'transactionId'], 'image-sequence completion response');
			if (response.operation !== 'completed' || response.transactionId !== id) {
				throw new Error('Main did not settle the exact image-sequence transaction.');
			}
			disposed = true;
		},
	});
}

async function writeChunks(
	bridge: FramescaperNativeImageSequenceImportRendererPortV25,
	transactionId: string,
	asset: 'pack' | 'inventory',
	bytesValue: Uint8Array,
	initialOffset: number,
): Promise<void> {
	if (!(bytesValue instanceof Uint8Array) || bytesValue.byteLength < 1) {
		throw new TypeError('Candidate image-sequence publication requires non-empty bytes.');
	}
	for (let consumed = 0; consumed < bytesValue.byteLength;) {
		const end = Math.min(
			bytesValue.byteLength, consumed + NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES,
		);
		await bridge.writeImageSequenceImportChunk({
			transactionId, asset, offset: initialOffset + consumed,
			bytes: bytesValue.slice(consumed, end),
		});
		consumed = end;
	}
}

function activeTransaction(value: string | null, disposed: boolean): string {
	if (disposed || value === null) throw new Error('The image-sequence transaction is not active.');
	return value;
}

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== keys.length
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !keys.includes(key))) {
		throw new TypeError(`The ${label} is not an exact record.`);
	}
	return value as Record<string, unknown>;
}
