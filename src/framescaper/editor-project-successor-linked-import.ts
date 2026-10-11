/* SPDX-License-Identifier: AGPL-3.0-only */
import { TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import { createScapeDigest, digestScapeBytes, scapeHex, verifyScapeAssetBytes } from '../common/editor/scape-archive-media.ts';
import { readScapeArchiveEnvelope, type ScapeArchiveEnvelope, type ScapeAssetDescriptor } from '../common/editor/scape-archive-envelope.ts';
import { withScapeArchiveReader } from '../common/editor/scape-archive-reader.ts';
import { copyScapeArchiveEntry } from '../common/editor/scape-archive-entry-copy.ts';
import { createScapeExportDestination } from '../common/editor/scape-export-destination.ts';
import { maximumScapeStoreArchiveBytes, resolveScapeBlobMaximumBytes } from '../common/editor/scape-export-estimate.ts';
import { aggregateScapeErrors, throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import { normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import { inspectFramescaperMigrationArchive, type FramescaperMigrationRecord } from './editor-project-successor-archive.ts';
import { createFramescaperScapeProjectAssetExtension } from './editor-scape-assets.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { createFramescaperLinkedAssetDescriptor, indexFramescaperLinkedAssets, MOTION_LINKED_ARCHIVE_ASSET_KIND } from './editor-project-successor-link-assets.ts';

export interface FramescaperLinkedArchiveImportTransaction {
	write(asset: MotionAsset, bytes: Uint8Array): Promise<void>;
	finish(asset: MotionAsset): Promise<void>;
	commit(record: FramescaperMigrationRecord): Promise<void>;
	rollback(reason: unknown): Promise<void>;
}
export interface FramescaperLinkedArchiveImportOptions {
	readonly begin: (project: FramescaperSuccessorProject) => Promise<FramescaperLinkedArchiveImportTransaction>;
	readonly signal?: AbortSignal; readonly maximumBaselineBlobBytes?: number; readonly maximumLinkedBytes?: number;
}

/** Private bodies become visible only with the authenticated Frame owner and its complete linked revision set. */
export async function importFramescaperLinkedSuccessorArchive(archive: Blob, options: FramescaperLinkedArchiveImportOptions): Promise<FramescaperMigrationRecord> {
	const { signal } = options; throwIfScapeAborted(signal);
	const extension = createFramescaperScapeProjectAssetExtension(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	return withScapeArchiveReader(archive, signal, async (entries) => {
		const envelope = await readScapeArchiveEnvelope(entries, {}, signal, [...extension.assetKinds, MOTION_LINKED_ARCHIVE_ASSET_KIND]);
		verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'linked project document');
		const project = normalizeFramescaperSuccessorProject(JSON.parse(envelope.projectText) as unknown);
		const assets = indexFramescaperLinkedAssets(project); assertInventory(envelope.manifest.assets, assets);
		const maximum = options.maximumLinkedBytes ?? 8 * 1024 * 1024 * 1024;
		if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64 * 1024 * 1024 * 1024
			|| assets.reduce((sum, asset) => sum + BigInt(asset.byteLength), 0n) > BigInt(maximum)) throw new RangeError('Linked archive exceeds its dependency byte budget.');
		const originalArchive = await retainBaseline(envelope, project, options.maximumBaselineBlobBytes, signal);
		const original = await inspectFramescaperMigrationArchive(originalArchive, signal);
		const record = { id: project.id, project, originalArchive, archiveDigest: original.archiveDigest };
		throwIfScapeAborted(signal); const transaction = await options.begin(project);
		try {
			for (const asset of assets) {
				throwIfScapeAborted(signal); const digest = createScapeDigest(); let size = 0;
				const entry = envelope.entryByName.get(createFramescaperLinkedAssetDescriptor(asset).entry)!;
				if (!entry.getData) throw new TypeError('Linked archive body is unreadable.');
				await entry.getData(new WritableStream<Uint8Array>({ async write(chunk) {
					throwIfScapeAborted(signal);
					if (!(chunk instanceof Uint8Array) || chunk.length > asset.byteLength - size) throw new RangeError('Linked archive body exceeds its length contract.');
					for (let offset = 0; offset < chunk.length; offset += 4 * 1024 * 1024) {
						throwIfScapeAborted(signal); const retained = chunk.slice(offset, offset + 4 * 1024 * 1024); size += retained.length; digest.update(retained); await transaction.write(asset, retained);
					}
				} }), { signal, strictness: 'strict' });
				throwIfScapeAborted(signal);
				if (size !== asset.byteLength || scapeHex(digest.digest()) !== asset.sha256) throw new RangeError(`Linked archive asset ${asset.id} digest or length changed.`);
				await transaction.finish(asset);
			}
			throwIfScapeAborted(signal); await transaction.commit(record); return record;
		} catch (error) {
			try { await transaction.rollback(error); } catch (cleanup) { throw aggregateScapeErrors(error, [cleanup], 'Linked archive import and private cleanup both failed.'); }
			throw error;
		}
	});
}
function assertInventory(descriptors: readonly ScapeAssetDescriptor[], assets: readonly MotionAsset[]): void {
	const linked = descriptors.filter(({ kind }) => kind === MOTION_LINKED_ARCHIVE_ASSET_KIND);
	if (linked.length !== assets.length) throw new RangeError('Linked archive dependency inventory is incomplete or contains unowned bodies.');
	for (const asset of assets) {
		const expected = createFramescaperLinkedAssetDescriptor(asset); const actual = linked.find(({ sourceId }) => sourceId === expected.sourceId);
		if (!actual || Object.keys(actual).length !== Object.keys(expected).length || Object.entries(expected).some(([key, value]) => actual[key] !== value)) throw new RangeError('Linked archive dependency descriptor differs from its immutable snapshot.');
	}
}
async function retainBaseline(envelope: ScapeArchiveEnvelope, project: FramescaperSuccessorProject, maximumBytes?: number, signal?: AbortSignal): Promise<Blob> {
	const { compositionLinks: _links, ...baseline } = project; const text = JSON.stringify({ ...baseline, schemaVersion: 1 }); const bytes = new TextEncoder().encode(text);
	const manifest = { ...envelope.manifest, project: { ...envelope.manifest.project, schemaVersion: 1, size: bytes.length, sha256: digestScapeBytes(bytes) }, assets: envelope.manifest.assets.filter(({ kind }) => kind !== MOTION_LINKED_ARCHIVE_ASSET_KIND) };
	const manifestText = JSON.stringify(manifest); const estimate = maximumScapeStoreArchiveBytes([{ filename: 'project.json', payloadBytes: bytes.length }, { filename: 'manifest.json', payloadBytes: new TextEncoder().encode(manifestText).length }, ...manifest.assets.map(({ entry, size }) => ({ filename: entry, payloadBytes: size }))]);
	if (estimate > resolveScapeBlobMaximumBytes(maximumBytes)) throw new RangeError('Linked import baseline custody exceeds Blob memory admission.');
	const destination = createScapeExportDestination(undefined, 'application/vnd.framescaper.scape+zip', estimate);
	const writer = new ZipWriter(destination.target, { level: 0, zip64: true, useWebWorkers: false, signal });
	try {
		await writer.add('project.json', new TextReader(text), { signal });
		for (const descriptor of manifest.assets) await copyScapeArchiveEntry(writer, envelope.entryByName.get(descriptor.entry)!, signal);
		await writer.add('manifest.json', new TextReader(manifestText), { signal }); const result = await destination.finish(writer, signal);
		if (!result) throw new Error('Linked import baseline custody did not produce a Blob.'); return result;
	} catch (error) { return destination.abort(writer, error); }
}
