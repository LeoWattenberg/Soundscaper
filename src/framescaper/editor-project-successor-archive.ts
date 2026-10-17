/* SPDX-License-Identifier: AGPL-3.0-only */
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { withScapeProjectInput, type ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { createBlobScapeArchiveByteSource, assertScapeArchiveByteSource, readScapeArchiveByteRange } from '../common/editor/scape-archive-byte-source.ts';
import { copyScapeArchiveEntry } from '../common/editor/scape-archive-entry-copy.ts';
import { readScapeArchiveEnvelope, type ScapeArchiveEntry, type ScapeDescriptor } from '../common/editor/scape-archive-envelope.ts';
import { EXTERNAL_MEDIA_ENCODING } from '../common/editor/desktop-external-media.ts';
import { verifyScapeAssetBytes } from '../common/editor/scape-archive-media.ts';
import { indexScapeProjectAssets, indexScapeProjectTimingAssets } from '../common/editor/scape-project-assets.ts';
import { cloneFramescaperProject, type FramescaperProject } from './editor-project.ts';
import { createFramescaperScapeProjectAssetExtension } from './editor-scape-assets.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';

export interface FramescaperMigrationRecord {
	readonly id: string; readonly archiveDigest: string; readonly originalArchive: ScapeProjectInput;
	readonly project: FramescaperSuccessorProject;
}
export async function digestFramescaperMigrationArchive(blob: ScapeProjectInput, signal?: AbortSignal): Promise<string> {
	const digest = sha256.create();
	const source = blob instanceof Blob ? createBlobScapeArchiveByteSource(blob) : blob; assertScapeArchiveByteSource(source);
	for (let offset = 0; offset < source.size; offset += 1024 * 1024) {
		signal?.throwIfAborted();
		digest.update(await readScapeArchiveByteRange(source, { offset, length: Math.min(1024 * 1024, source.size - offset), signal }));
	}
	signal?.throwIfAborted();
	return bytesToHex(digest.digest());
}

/** Authenticate the full v1 archive before it becomes a recoverable migration source. */
export async function inspectFramescaperMigrationArchive(blob: ScapeProjectInput, signal?: AbortSignal): Promise<{ project: FramescaperProject; archiveDigest: string }> {
	const extension = createFramescaperScapeProjectAssetExtension(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const project = await withScapeProjectInput(blob, signal, async (entries) => {
		const envelope = await readScapeArchiveEnvelope(entries, {}, signal, extension.assetKinds);
		verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'project document');
		const project = cloneFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, JSON.parse(envelope.projectText) as unknown);
		extension.validateImportAssets(project, envelope.manifest);
		indexScapeProjectAssets(project, envelope.manifest, { currentProjectSchemaFamily: 'framescaper', currentProjectSchemaVersion: 1, additionalSourceKinds: extension.sourceKinds });
		indexScapeProjectTimingAssets(project, envelope.manifest);
		if (envelope.manifest.assets.some(({ encoding }) => encoding === EXTERNAL_MEDIA_ENCODING)) throw new RangeError('Migration requires a complete portable archive with all media bytes.');
		for (const asset of envelope.manifest.assets) await verifyEntry(envelope.entryByName.get(asset.entry)!, asset, signal);
		return project;
	});
	return { project, archiveDigest: await digestFramescaperMigrationArchive(blob, signal) };
}

/** Repack only admitted successor intent; every baseline dependency is streamed from retained original custody. */
export async function exportFramescaperSuccessorArchive(record: FramescaperMigrationRecord, signal?: AbortSignal): Promise<Blob> {
	const project = normalizeFramescaperSuccessorProject(record.project);
	const original = await inspectFramescaperMigrationArchive(record.originalArchive, signal);
	if (record.id !== project.id || original.project.id !== project.id || record.archiveDigest !== original.archiveDigest) throw new RangeError('Migration archive custody identity mismatch.');
	const baseline = Object.fromEntries(Object.entries(project).filter(([key]) => key !== 'compositionLinks'));
	if (JSON.stringify({ ...baseline, schemaVersion: 1 }) !== JSON.stringify(original.project)) throw new RangeError('Migration archive export requires unchanged baseline intent and its full asset closure.');
	if (project.compositionLinks.length) throw new RangeError('Linked composition export requires the M10 dependency assembler.');
	const extension = createFramescaperScapeProjectAssetExtension(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	return withScapeProjectInput(record.originalArchive, signal, async (entries) => {
		const envelope = await readScapeArchiveEnvelope(entries, {}, signal, extension.assetKinds);
		const projectText = JSON.stringify(project);
		const bytes = new TextEncoder().encode(projectText);
		const manifest = { ...envelope.manifest, project: { ...envelope.manifest.project, schemaVersion: 2, size: bytes.length, sha256: bytesToHex(sha256(bytes)) } };
		const writer = new ZipWriter(new BlobWriter('application/vnd.framescaper.scape+zip'), { level: 0, useWebWorkers: false, zip64: true });
		try {
			await writer.add('project.json', new TextReader(projectText), { signal });
			await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)), { signal });
			for (const asset of manifest.assets) {
				const entry = envelope.entryByName.get(asset.entry)!;
				await copyScapeArchiveEntry(writer, entry, signal);
			}
			return await writer.close();
		} catch (error) {
			await writer.close().catch(() => undefined);
			throw error;
		}
	});
}

async function verifyEntry(entry: ScapeArchiveEntry, descriptor: ScapeDescriptor, signal?: AbortSignal): Promise<void> {
	if (!entry?.getData) throw new TypeError('Migration archive asset is unreadable.');
	const digest = sha256.create(); let size = 0;
	await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
		signal?.throwIfAborted(); size += chunk.byteLength;
		if (size > descriptor.size) throw new RangeError('Migration archive asset exceeds its byte contract.');
		digest.update(chunk);
	} }), { signal, strictness: 'strict' });
	if (size !== descriptor.size || bytesToHex(digest.digest()) !== descriptor.sha256) throw new RangeError('Migration archive asset digest or size is invalid.');
}

