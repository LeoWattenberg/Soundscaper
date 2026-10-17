/* SPDX-License-Identifier: AGPL-3.0-only */

import { ZipReader, BlobReader, ZipWriter, BlobWriter, Uint8ArrayWriter, Uint8ArrayReader } from '@zip.js/zip.js/index-native.js';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoStackV1, type PhotoStackV1 } from '../../src/lightscaper/catalog/photo-stack-v1.ts';
import type { PhotoCatalogArchiveStageV2 } from '../../src/lightscaper/archive/catalog-archive-import-v2.ts';
import type { PhotoDocumentV1 } from '../../src/lightscaper/catalog/types.ts';
import { digestScapeBytes } from '../../src/common/editor/scape-byte-stream.ts';
import { encodePhotoStackPackV1 } from '../../src/lightscaper/archive/stack-pack.ts';

export const stackArchiveRoot = (photoCount = 4) => normalizePhotoCatalogRootV1({
	schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Photo library',
	revision: 3, photoCount, folders: [], keywords: [], collections: [],
});
export const stackArchiveRecord = (id = 'stack-1', photoIds = ['photo-2', 'photo-1']) => normalizePhotoStackV1({
	schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog-1', id, revision: 3, photoIds, coverPhotoId: photoIds[1],
});
export function stackArchiveDestination() {
	const photos = new Map<string, { photo: PhotoDocumentV1; bytes: Uint8Array }>(), stacks = new Map<string, PhotoStackV1>();
	const events: string[] = [];
	const stage: PhotoCatalogArchiveStageV2 = {
		async writePhoto(photo, original) {
			const parts: Uint8Array[] = []; for await (const chunk of original) parts.push(new Uint8Array(chunk));
			photos.set(photo.id, { photo, bytes: new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer()) }); events.push(`photo:${photo.id}`);
		},
		async writeStack(stack) { stacks.set(stack.id, stack); events.push(`stack:${stack.id}`); },
		async publish() { events.push('publish'); },
		async rollback() { photos.clear(); stacks.clear(); events.push('rollback'); },
	};
	return { photos, stacks, events, stage };
}
export async function rewriteStackArchive(blob: Blob, change: (entries: Map<string, Uint8Array>) => void | Promise<void>) {
	const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
	const entries = new Map<string, Uint8Array>();
	try { for (const entry of await reader.getEntries()) { if (!entry.directory) entries.set(entry.filename, await entry.getData(new Uint8ArrayWriter())); } }
	finally { await reader.close(); }
	await change(entries);
	const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false, level: 0 });
	for (const [name, value] of entries) await writer.add(name, new Uint8ArrayReader(value), { level: 0 });
	return writer.close();
}
export async function replaceStackArchivePack(entries: Map<string, Uint8Array>, records: readonly PhotoStackV1[]) {
	const parts: Uint8Array[] = []; for await (const bytes of encodePhotoStackPackV1(records)) parts.push(bytes);
	const entry = 'assets/stack-pack-000001.bin', body = new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
	entries.set(entry, body);
	const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as { assets: { entry: string; size: number; sha256: string }[] };
	const asset = manifest.assets.find(asset => asset.entry === entry)!; asset.size = body.length; asset.sha256 = digestScapeBytes(body);
	entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
}
export function editStackArchiveDocument(entries: Map<string, Uint8Array>, change: (document: Record<string, unknown>) => void) {
	const document = JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as Record<string, unknown>; change(document);
	const projectBytes = new TextEncoder().encode(JSON.stringify(document)); entries.set('project.json', projectBytes);
	const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))) as { project: Record<string, unknown> };
	manifest.project.size = projectBytes.byteLength; manifest.project.sha256 = digestScapeBytes(projectBytes);
	manifest.project.schemaVersion = document.schemaVersion;
	entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
}
export function stackArchiveFailure(error: unknown, pattern: RegExp): boolean {
	return error instanceof Error && (pattern.test(error.message) || error instanceof AggregateError
		&& (error.errors as unknown[]).some(failure => stackArchiveFailure(failure, pattern)));
}
