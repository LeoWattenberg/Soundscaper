/* SPDX-License-Identifier: AGPL-3.0-only */
import { MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../common/editor/storage/media-asset-chunk-schema.ts';
import { motionDigest, motionInteger, motionRecord } from '../common/editor/motion-values.ts';

export const FRAMESCAPER_ARCHIVE_CHUNK_BYTES = MEDIA_ASSET_STREAM_CHUNK_BYTES;
export const FRAMESCAPER_ARCHIVE_STORES = ['archiveBodies', 'archiveChunks', 'archiveStages'] as const;
export interface FramescaperArchiveReference {
	readonly kind: 'framescaper-archive-chunks-v1'; readonly token: string; readonly size: number;
	readonly sha256: string; readonly chunkCount: number; readonly chunkBytes: number;
}
export function framescaperArchiveToken(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value)) throw new TypeError('Successor archive custody token is invalid.');
	return value;
}
export function normalizeFramescaperArchiveReference(value: unknown, expectedDigest?: string): FramescaperArchiveReference {
	const record = motionRecord(value, ['kind', 'token', 'size', 'sha256', 'chunkCount', 'chunkBytes'], 'successor archive custody');
	const size = motionInteger(record.size, 'archive size', 1); const sha256 = motionDigest(record.sha256);
	const chunkCount = motionInteger(record.chunkCount, 'archive chunk count', 1);
	if (record.kind !== 'framescaper-archive-chunks-v1' || record.chunkBytes !== FRAMESCAPER_ARCHIVE_CHUNK_BYTES
		|| chunkCount !== Math.ceil(size / FRAMESCAPER_ARCHIVE_CHUNK_BYTES)) throw new RangeError('Successor archive custody kind, size or chunk count changed.');
	if (expectedDigest !== undefined && sha256 !== motionDigest(expectedDigest)) throw new RangeError('Successor archive custody digest changed.');
	return Object.freeze({ kind: 'framescaper-archive-chunks-v1', token: framescaperArchiveToken(record.token), size, sha256, chunkCount, chunkBytes: FRAMESCAPER_ARCHIVE_CHUNK_BYTES });
}
/** Legacy Blob records remain readable without rewriting their exact source bytes. */
export function assertFramescaperArchiveCustody(value: unknown, expectedDigest: string): void {
	motionDigest(expectedDigest); if (!(value instanceof Blob)) normalizeFramescaperArchiveReference(value, expectedDigest);
}
