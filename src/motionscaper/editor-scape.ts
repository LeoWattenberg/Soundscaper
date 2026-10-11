/* SPDX-License-Identifier: AGPL-3.0-only */

import { TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { MOTION_ARCHIVE_ASSET_KINDS as ASSET_KINDS, motionArchiveAssetEntry as assetEntry, motionArchiveAssetDescriptor as assetDescriptor, validateMotionArchiveAssetClosure as validateAssetClosure } from '../common/editor/motion-archive-contract.ts';
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionAssetBody } from '../common/editor/motion-asset-body.ts';
import {
	aggregateScapeErrors, throwIfScapeAborted,
} from '../common/editor/scape-abort.ts';
import {
	readScapeArchiveEnvelope, SCAPE_ARCHIVE_LIMITS, SCAPE_FORMAT, SCAPE_FORMAT_VERSION,
	SCAPE_MANIFEST_ENTRY, SCAPE_PROJECT_ENTRY, type ScapeManifest,
} from '../common/editor/scape-archive-envelope.ts';
import {
	createScapeDigest, digestScapeBytes, scapeBytesStream,
	scapeHashingStream, scapeHex, verifyScapeAssetBytes,
} from '../common/editor/scape-archive-media.ts';
import { createScapeExportDestination } from '../common/editor/scape-export-destination.ts';
import { maximumScapeStoreArchiveBytes, resolveScapeBlobMaximumBytes } from '../common/editor/scape-export-estimate.ts';
import { SCAPE_MIME_TYPE } from '../common/editor/scape-project-format.ts';
import { withScapeProjectInput, type ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { classifyProjectSchemaIdentity, type ProjectSchemaIdentity } from '../common/editor/project-schema-identity.ts';
import type { MotionscaperProject } from './editor-project.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';

const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
const ENCODER = new TextEncoder();

export interface MotionArchiveExportOptions {
	readonly writable?: WritableStream<Uint8Array>;
	readonly maximumBlobBytes?: number;
	readonly signal?: AbortSignal;
}

/** A private staging transaction; commit alone makes a complete project visible. */
export interface MotionArchiveImportTransaction {
	writeAssetChunk(asset: MotionAsset, bytes: Uint8Array): PromiseLike<void>;
	finishAsset(asset: MotionAsset): PromiseLike<void>;
	commit(project: MotionscaperProject): PromiseLike<void>;
	rollback(): PromiseLike<void>;
}

export type MotionArchiveOpenResult =
	| Readonly<{ kind: 'current'; project: MotionscaperProject }>
	| Readonly<{ kind: 'opaque'; identity: Readonly<ProjectSchemaIdentity>; archive: ScapeProjectInput }>;

type ReadAsset = (asset: MotionAsset, signal?: AbortSignal) => PromiseLike<MotionAssetBody | null> | MotionAssetBody | null;

/** Write the owned scene unchanged into Scape format 1, with its entire declared asset closure. */
export async function exportMotionscaperArchive(
	value: unknown,
	readAsset: ReadAsset,
	options: MotionArchiveExportOptions = {},
): Promise<Blob | null> {
	const { signal } = options;
	throwIfScapeAborted(signal);
	const project = normalizeMotionscaperProject(value);
	const projectBytes = ENCODER.encode(JSON.stringify(project));
	const manifest: ScapeManifest = {
		format: SCAPE_FORMAT, formatVersion: SCAPE_FORMAT_VERSION,
		project: {
			entry: SCAPE_PROJECT_ENTRY, schemaFamily: 'motionscaper', schemaVersion: 1,
			size: projectBytes.byteLength, sha256: digestScapeBytes(projectBytes), mimeType: 'application/json',
		},
		assets: project.assets.map(assetDescriptor),
	};
	const manifestText = JSON.stringify(manifest);
	const manifestBytes = ENCODER.encode(manifestText).byteLength;
	if (projectBytes.byteLength > SCAPE_ARCHIVE_LIMITS.maximumProjectBytes
		|| manifestBytes > SCAPE_ARCHIVE_LIMITS.maximumManifestBytes) {
		throw new RangeError('Motion archive metadata exceeds the Scape limits.');
	}
	const entries = [
		{ filename: SCAPE_PROJECT_ENTRY, payloadBytes: projectBytes.byteLength },
		{ filename: SCAPE_MANIFEST_ENTRY, payloadBytes: manifestBytes },
		...manifest.assets.map((asset) => ({ filename: asset.entry, payloadBytes: asset.size })),
	];
	if (entries.reduce((sum, entry) => sum + BigInt(entry.payloadBytes), 0n)
		> BigInt(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes)) {
		throw new RangeError('Motion archive exceeds the Scape expansion limit.');
	}
	const maximumBytes = maximumScapeStoreArchiveBytes(entries);
	if (!options.writable && maximumBytes > resolveScapeBlobMaximumBytes(options.maximumBlobBytes)) {
		throw new RangeError('Motion archive exceeds Blob memory admission; choose a streaming destination.');
	}
	const destination = createScapeExportDestination(options.writable, SCAPE_MIME_TYPE, maximumBytes);
	const writer = new ZipWriter(destination.target, {
		level: 0, zip64: true, dataDescriptor: true, dataDescriptorSignature: true,
		extendedTimestamp: true, useWebWorkers: false, signal,
	});
	try {
		await writer.add(SCAPE_PROJECT_ENTRY, scapeBytesStream(projectBytes), { level: 0, zip64: true, signal });
		for (const asset of project.assets) {
			throwIfScapeAborted(signal);
			const body = await readAsset(asset, signal);
			throwIfScapeAborted(signal);
			if (!body || typeof body.stream !== 'function') throw new Error(`Motion asset ${asset.id} is unavailable.`);
			if (body.size !== asset.byteLength) throw new RangeError(`Motion asset ${asset.id} byte length changed.`);
			const digest = createScapeDigest();
			let size = 0;
			const bounded = body.stream().pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					if (!(chunk instanceof Uint8Array) || chunk.byteLength > asset.byteLength - size) {
						throw new RangeError(`Motion asset ${asset.id} emitted more bytes than declared.`);
					}
					size += chunk.byteLength;
					controller.enqueue(chunk);
				},
			}));
			await writer.add(assetEntry(asset), scapeHashingStream(bounded, digest, signal), { level: 0, zip64: true, signal });
			if (size !== asset.byteLength || scapeHex(digest.digest()) !== asset.sha256) {
				throw new RangeError(`Motion asset ${asset.id} digest or byte length changed.`);
			}
		}
		await writer.add(SCAPE_MANIFEST_ENTRY, new TextReader(manifestText), { level: 0, zip64: true, signal });
		return await destination.finish(writer, signal);
	} catch (error) {
		return await destination.abort(writer, error);
	}
}

/** Stage verified bodies with backpressure, close the archive, then publish once. */
export async function importMotionscaperArchive(
	input: ScapeProjectInput,
	begin: (project: MotionscaperProject) => PromiseLike<MotionArchiveImportTransaction> | MotionArchiveImportTransaction,
	signal?: AbortSignal,
): Promise<MotionArchiveOpenResult> {
	let transaction: MotionArchiveImportTransaction | null = null;
	try {
		const result = await withScapeProjectInput<MotionArchiveOpenResult>(input, signal, async (entries) => {
			const envelope = await readScapeArchiveEnvelope(entries, {}, signal, ASSET_KINDS);
			verifyScapeAssetBytes(ENCODER.encode(envelope.projectText), envelope.manifest.project, 'motion project document');
			const document: unknown = JSON.parse(envelope.projectText);
			const classified = classifyProjectSchemaIdentity(document, 'motionscaper');
			if (classified.disposition !== 'current') {
				return Object.freeze({ kind: 'opaque', identity: classified.identity, archive: input });
			}
			const project = normalizeMotionscaperProject(document);
			validateAssetClosure(project, envelope.manifest.assets);
			throwIfScapeAborted(signal);
			const staging = await begin(project);
			transaction = staging;
			assertTransaction(staging);
			for (const asset of project.assets) {
				throwIfScapeAborted(signal);
				const entry = envelope.entryByName.get(assetEntry(asset));
				if (!entry?.getData) throw new TypeError(`Motion asset ${asset.id} has no readable archive body.`);
				const digest = createScapeDigest();
				let size = 0;
				let writeFailure: unknown;
				const writable = new WritableStream<Uint8Array>({
					async write(chunk) {
						throwIfScapeAborted(signal);
						if (!(chunk instanceof Uint8Array) || chunk.byteLength > asset.byteLength - size) {
							throw new RangeError(`Motion asset ${asset.id} exceeds its declared byte length.`);
						}
						envelope.expandedByteBudget.consume(chunk.byteLength, `motion asset ${asset.id}`);
						digest.update(chunk);
						size += chunk.byteLength;
						for (let offset = 0; offset < chunk.byteLength; offset += MAXIMUM_CHUNK_BYTES) {
							try { await staging.writeAssetChunk(asset, chunk.subarray(offset, offset + MAXIMUM_CHUNK_BYTES)); }
							catch (error) { writeFailure = error; throw error; }
							throwIfScapeAborted(signal);
						}
					},
				});
				try { await entry.getData(writable, { signal, strictness: 'strict', checkOverlappingEntry: true }); }
				catch (error) { throw writeFailure ?? error; }
				throwIfScapeAborted(signal);
				if (size !== asset.byteLength || scapeHex(digest.digest()) !== asset.sha256) {
					throw new RangeError(`Motion asset ${asset.id} digest or size does not match its contract.`);
				}
				await staging.finishAsset(asset);
			}
			return Object.freeze({ kind: 'current', project });
		});
		throwIfScapeAborted(signal);
		if (result.kind === 'current') {
			if (!transaction) throw new TypeError('Motion archive import has no staging transaction.');
			await (transaction as MotionArchiveImportTransaction).commit(result.project);
		}
		return result;
	} catch (error) {
		if (transaction) {
			try { await (transaction as MotionArchiveImportTransaction).rollback(); }
			catch (cleanup) { throw aggregateScapeErrors(error, [cleanup], 'Motion import and rollback failed.'); }
		}
		throw error;
	}
}

function assertTransaction(value: MotionArchiveImportTransaction): void {
	if (!value || ['writeAssetChunk', 'finishAsset', 'commit', 'rollback'].some(
		(key) => typeof value[key as keyof MotionArchiveImportTransaction] !== 'function',
	)) throw new TypeError('A complete motion archive staging transaction is required.');
}
