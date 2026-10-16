/* SPDX-License-Identifier: AGPL-3.0-only */
import { MAX_UPLOAD_BYTES, record } from './contracts.ts';
import { OAuthHttpError } from './oauth-http.ts';

export const PROJECT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
export interface ProjectArchive {
	readonly id: string;
	readonly name: string;
	readonly format: 'aup3' | 'aup4';
	readonly size: number;
	readonly snapshotId: string | null;
}
export function projectId(value: unknown): string {
	if (typeof value !== 'string' || !PROJECT_ID.test(value)) throw invalid('Invalid project identifier.');
	return value;
}
export function normalizeProject(value: unknown): ProjectArchive {
	const data = record(value);
	const format = data.latest_synced_snapshot_id && data.latest_synced_format ? data.latest_synced_format : data.format;
	if (data.transport !== 'file' || !['aup3', 'aup4'].includes(String(format))
		|| typeof data.name !== 'string' || !data.name.trim() || data.name.length > 256
		|| typeof data.size !== 'number' || !Number.isSafeInteger(data.size) || data.size < 0) throw invalid('Invalid project archive.');
	return { id: projectId(data.id), name: data.name, format: format as 'aup3' | 'aup4', size: data.size,
		snapshotId: data.latest_synced_snapshot_id ? projectId(data.latest_synced_snapshot_id) : null };
}
export function archiveUploadInput(request: Request): Readonly<{ name: string; format: 'aup3' | 'aup4'; size: number }> {
	const query = new URL(request.url).searchParams;
	if (query.size !== 2 || query.getAll('name').length !== 1 || query.getAll('format').length !== 1) throw new OAuthHttpError(400, 'invalid_request', 'Invalid project upload parameters.');
	const name = query.get('name')?.trim() ?? '';
	const format = query.get('format');
	if (!name || name.length > 256 || [...name].some(character => character.charCodeAt(0) < 32) || (format !== 'aup3' && format !== 'aup4')) throw new OAuthHttpError(400, 'invalid_request', 'Choose an AUP3 or AUP4 project archive and name.');
	const size = request.headers.get('X-Audiocom-Content-Length');
	if (size === null || !/^[1-9]\d{0,15}$/u.test(size) || Number(size) > MAX_UPLOAD_BYTES) throw new OAuthHttpError(413, 'invalid_upload_size', 'Project archives must be no larger than 100 MB.');
	if (Number(size) < 16 || request.body === null) throw new OAuthHttpError(400, 'invalid_upload', 'Choose a standalone SQLite project archive.');
	return { name, format, size: Number(size) };
}
export function invalid(message: string): OAuthHttpError { return new OAuthHttpError(502, 'invalid_upstream_response', message); }

/** Check the header while preserving streaming and without reading the whole file. */
export function sqliteArchiveStream(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
	const header = new TextEncoder().encode('SQLite format 3\0');
	let offset = 0;
	return source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			for (let index = 0; index < chunk.byteLength && offset < header.length; index++, offset++) {
				if (chunk[index] !== header[offset]) throw new OAuthHttpError(422, 'invalid_project_archive', 'Choose a standalone SQLite AUP3 or AUP4 project file.');
			}
			controller.enqueue(chunk);
		},
		flush() { if (offset < header.length) throw new OAuthHttpError(422, 'invalid_project_archive', 'The project archive is incomplete.'); },
	}));
}
