/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Projecting a desktop V10 bundle snapshot onto the Scape archive shape.
 *
 * The renderer holds the snapshot; the archive wants a manifest and a list of
 * entries whose bodies stream on demand. That translation is the whole of this
 * module, and keeping it out of the renderer is what lets the renderer stay a
 * lifecycle object rather than also being a serializer.
 *
 * Bodies are never buffered whole. An entry's `getData` pulls fixed-size chunks
 * through the bridge and writes each one straight out, so a project larger than
 * memory exports the same way a small one does, and an abort stops the transfer
 * at the next chunk boundary rather than after the last byte.
 */

import type { ScapeArchiveEntry } from '../common/editor/scape-archive-envelope.ts';
import { throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import {
	FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES,
	validateFramescaperDesktopV10BodyChunk,
	type FramescaperDesktopV10Body,
	type FramescaperDesktopV10BundleSnapshot,
	type FramescaperDesktopV10RendererBridge,
} from './desktop-project-library-v10-renderer-contract.ts';

export function framescaperDesktopV10ArchiveManifest(
	snapshot: Readonly<FramescaperDesktopV10BundleSnapshot>,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		format: 'scape-project',
		formatVersion: snapshot.assets.length === 0 ? 1 : 2,
		project: Object.freeze({
			entry: 'project.json', mimeType: 'application/json', schemaVersion: 18,
			size: snapshot.bundle.project.byteLength, sha256: snapshot.bundle.project.sha256,
		}),
		assets: snapshot.assets,
	});
}

export function framescaperDesktopV10ArchiveEntries(
	snapshot: Readonly<FramescaperDesktopV10BundleSnapshot>,
	bridge: FramescaperDesktopV10RendererBridge,
	signal?: AbortSignal,
): readonly ScapeArchiveEntry[] {
	return Object.freeze(snapshot.assets.map((asset, index) => {
		const body = snapshot.bundle.bodies[index]!;
		if (asset.sourceId !== body.storageKey || asset.size !== body.byteLength || asset.sha256 !== body.sha256) {
			throw new Error('The desktop V10 body no longer matches its V18 archive descriptor.');
		}
		return Object.freeze({
			filename: asset.entry,
			directory: false,
			encrypted: false,
			compressionMethod: 0,
			compressedSize: body.byteLength,
			uncompressedSize: body.byteLength,
			getData: (writable: WritableStream<Uint8Array>, options?: Readonly<{ signal?: AbortSignal }>) => (
				transferBody(snapshot, body, bridge, writable, options?.signal ?? signal)
			),
		});
	}));
}

async function transferBody(
	snapshot: Readonly<FramescaperDesktopV10BundleSnapshot>,
	body: Readonly<FramescaperDesktopV10Body>,
	bridge: FramescaperDesktopV10RendererBridge,
	writable: WritableStream<Uint8Array>,
	signal?: AbortSignal,
): Promise<void> {
	const writer = writable.getWriter();
	try {
		for (let offset = 0; offset < body.byteLength; offset += FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES) {
			throwIfScapeAborted(signal);
			const length = Math.min(FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES, body.byteLength - offset);
			const bytes = validateFramescaperDesktopV10BodyChunk(await bridge.readBodyChunk({
				projectId: snapshot.bundle.project.projectId,
				metadataRevision: snapshot.bundle.metadataRevision,
				projectRevision: snapshot.bundle.project.projectRevision,
				projectSha256: snapshot.bundle.project.sha256,
				body,
				offset,
				length,
			}), length);
			throwIfScapeAborted(signal);
			await writer.write(bytes);
		}
		await writer.close();
	} catch (error) {
		try { await writer.abort(error); } catch { /* the primary transfer error owns the refusal */ }
		throw error;
	} finally {
		writer.releaseLock();
	}
}
