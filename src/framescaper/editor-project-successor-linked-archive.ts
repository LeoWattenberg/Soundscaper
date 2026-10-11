/* SPDX-License-Identifier: AGPL-3.0-only */
import { TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionAssetBody } from '../common/editor/motion-asset-body.ts';
import { createScapeDigest, digestScapeBytes, scapeHex } from '../common/editor/scape-archive-media.ts';
import { readScapeArchiveEnvelope, SCAPE_ARCHIVE_LIMITS } from '../common/editor/scape-archive-envelope.ts';
import { withScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { copyScapeArchiveEntry } from '../common/editor/scape-archive-entry-copy.ts';
import { createScapeExportDestination } from '../common/editor/scape-export-destination.ts';
import { maximumScapeStoreArchiveBytes, resolveScapeBlobMaximumBytes } from '../common/editor/scape-export-estimate.ts';
import { throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { inspectFramescaperMigrationArchive, type FramescaperMigrationRecord } from './editor-project-successor-archive.ts';
import { createFramescaperScapeProjectAssetExtension } from './editor-scape-assets.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { createFramescaperLinkedAssetDescriptor, indexFramescaperLinkedAssets } from './editor-project-successor-link-assets.ts';

export interface FramescaperLinkedArchiveOptions {
	readonly readAsset: (asset: MotionAsset, signal?: AbortSignal) => Promise<MotionAssetBody | null>;
	readonly signal?: AbortSignal; readonly writable?: WritableStream<Uint8Array>; readonly maximumBlobBytes?: number;
}

/** Assemble retained original baseline assets plus complete linked revisions. Edited baseline assembly remains a separate successor workflow. */
export async function exportFramescaperLinkedSuccessorArchive(record: FramescaperMigrationRecord, options: FramescaperLinkedArchiveOptions): Promise<Blob | null> {
	const { signal } = options; throwIfScapeAborted(signal); const project = normalizeFramescaperSuccessorProject(record.project);
	const original = await inspectFramescaperMigrationArchive(record.originalArchive, signal);
	if (record.id !== project.id || original.project.id !== project.id || record.archiveDigest !== original.archiveDigest) throw new RangeError('Linked archive original custody identity mismatch.');
	const baseline = Object.fromEntries(Object.entries(project).filter(([key]) => key !== 'compositionLinks'));
	if (JSON.stringify({ ...baseline, schemaVersion: 1 }) !== JSON.stringify(original.project)) throw new RangeError('Linked archive assembly requires unchanged baseline intent and original custody.');
	const ordered = indexFramescaperLinkedAssets(project);
	const descriptors = ordered.map(createFramescaperLinkedAssetDescriptor); const extension = createFramescaperScapeProjectAssetExtension(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	return withScapeProjectInput(record.originalArchive, signal, async (entries) => {
		const envelope = await readScapeArchiveEnvelope(entries, {}, signal, extension.assetKinds);
		const projectText = JSON.stringify(project); const projectBytes = new TextEncoder().encode(projectText);
		const manifest = { ...envelope.manifest, project: { ...envelope.manifest.project, schemaVersion: 2, size: projectBytes.length, sha256: digestScapeBytes(projectBytes) }, assets: [...envelope.manifest.assets, ...descriptors] };
		if (new Set(manifest.assets.map((asset) => asset.sourceId)).size !== manifest.assets.length || new Set(manifest.assets.map((asset) => asset.entry)).size !== manifest.assets.length) throw new RangeError('Linked archive asset ownership collides with its baseline.');
		const manifestText = JSON.stringify(manifest); const manifestBytes = new TextEncoder().encode(manifestText).length;
		if (projectBytes.length > SCAPE_ARCHIVE_LIMITS.maximumProjectBytes || manifestBytes > SCAPE_ARCHIVE_LIMITS.maximumManifestBytes) throw new RangeError('Linked archive metadata exceeds its byte budget.');
		const inventory = [{ filename: 'project.json', payloadBytes: projectBytes.length }, { filename: 'manifest.json', payloadBytes: manifestBytes }, ...manifest.assets.map((asset) => ({ filename: asset.entry, payloadBytes: asset.size }))];
		if (inventory.reduce((sum, entry) => sum + BigInt(entry.payloadBytes), 0n) > BigInt(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes)) throw new RangeError('Linked archive exceeds its expanded-byte budget.');
		const maximum = maximumScapeStoreArchiveBytes(inventory);
		if (!options.writable && maximum > resolveScapeBlobMaximumBytes(options.maximumBlobBytes)) throw new RangeError('Linked archive exceeds Blob memory admission; choose a streaming destination.');
		const destination = createScapeExportDestination(options.writable, 'application/vnd.framescaper.scape+zip', maximum);
		const writer = new ZipWriter(destination.target, { level: 0, zip64: true, dataDescriptor: true, dataDescriptorSignature: true, extendedTimestamp: true, useWebWorkers: false, signal });
		try {
			await writer.add('project.json', new TextReader(projectText), { signal });
			for (const asset of envelope.manifest.assets) await copyScapeArchiveEntry(writer, envelope.entryByName.get(asset.entry)!, signal);
			for (const asset of ordered) {
				throwIfScapeAborted(signal); const body = await options.readAsset(asset, signal); throwIfScapeAborted(signal);
				if (!body || body.size !== asset.byteLength) throw new RangeError(`Linked archive asset ${asset.id} is missing or has a different size.`);
				const digest = createScapeDigest(); let size = 0;
				const stream = body.stream().pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
					throwIfScapeAborted(signal);
					if (!(chunk instanceof Uint8Array) || !chunk.length || chunk.length > 4 * 1024 * 1024 || chunk.length > asset.byteLength - size) throw new RangeError(`Linked archive asset ${asset.id} exceeds its chunk/length contract.`);
					const retained = chunk.slice(); size += retained.length; digest.update(retained); controller.enqueue(retained);
				} }), { signal });
				await writer.add(createFramescaperLinkedAssetDescriptor(asset).entry, stream, { signal });
				if (size !== asset.byteLength || scapeHex(digest.digest()) !== asset.sha256) throw new RangeError(`Linked archive asset ${asset.id} digest or length changed.`);
			}
			await writer.add('manifest.json', new TextReader(manifestText), { signal }); return await destination.finish(writer, signal);
		} catch (error) { return destination.abort(writer, error); }
	});
}
