/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudiocomProjectArchive, AudiocomProjectArchiveClient } from '../audiocom-project-archives.ts';
import { AudiocomApiError } from './audiocom-api-client.ts';
import { audiocomProvider } from './audiocom-provider.ts';

const PREFIX = '/api/audiocom/';
const MAXIMUM = 100000000;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
interface ClientOptions {
	readonly fetch?: typeof fetch;
	readonly location?: Pick<Location, 'origin' | 'protocol'>;
}
export function createAudiocomProjectArchiveClient(options: ClientOptions = {}): AudiocomProjectArchiveClient {
	const location = options.location ?? globalThis.location;
	const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
	const request = (path: string, init: RequestInit = {}): Promise<Response> => fetchImpl(location?.protocol === 'soundscaper-app:'
		? `soundscaper-app://bundle/_desktop/audiocom${PREFIX}${path}` : new URL(`${PREFIX}${path}`, location?.origin ?? 'https://soundscaper.org'), {
		...init, credentials: 'include', redirect: 'error',
	});
	return {
		async capabilities(signal) {
			const data = record(await dataResponse(await request('usage', { signal })));
			const formats = data.projectStorageSupported === true && Array.isArray(data.projectFormats)
				? data.projectFormats.filter((value): value is 'aup3' | 'aup4' => value === 'aup3' || value === 'aup4') : [];
			const provider = data.provider ? audiocomProvider(data.provider, location) : undefined;
			return { formats, maximumBytes: typeof data.maximumUploadBytes === 'number' && Number.isSafeInteger(data.maximumUploadBytes)
				&& data.maximumUploadBytes > 0 ? Math.min(MAXIMUM, data.maximumUploadBytes) : MAXIMUM, ...(provider ? { provider } : {}) };
		},
		async list(page, signal) {
			const data = record(await dataResponse(await request(`projects?page=${page}`, { signal })));
			if (!Array.isArray(data.results) || data.results.length > 20 || data.page !== page || typeof data.hasNext !== 'boolean') throw new Error('Invalid project archive list.');
			return { results: data.results.map(normalizeProject), page, hasNext: data.hasNext };
		},
		async upload(file, name, signal) {
			const format = file.name.toLowerCase().split('.').at(-1) ?? '';
			const params = new URLSearchParams({ name, format });
			return normalizeProject(await dataResponse(await request(`projects?${params}`, { method: 'POST', signal, body: file,
				headers: { 'Content-Type': 'application/octet-stream', 'X-Audiocom-Filename': encodeURIComponent(file.name), 'X-Audiocom-Content-Length': String(file.size) } })));
		},
		async download(project, signal) {
			if (!ID.test(project.id) || !project.snapshotId || !ID.test(project.snapshotId)) throw new Error('The project archive has no completed revision.');
			const response = await request(`projects/download?${new URLSearchParams({ id: project.id, snapshotId: project.snapshotId })}`, { signal });
			if (!response.ok) { await dataResponse(response); throw new Error('The project archive could not be downloaded.'); }
			const length = response.headers.get('Content-Length');
			if (!length || !/^\d+$/u.test(length) || Number(length) < 16 || Number(length) > MAXIMUM || !response.body) {
				await response.body?.cancel(); throw new Error('The project archive size exceeds its limit.');
			}
			const blob = await boundedBlob(response, Number(length));
			if (new TextDecoder().decode(await blob.slice(0, 16).arrayBuffer()) !== 'SQLite format 3\0') throw new Error('The downloaded project is not a standalone SQLite archive.');
			return blob;
		},
	};
}

function normalizeProject(value: unknown): AudiocomProjectArchive {
	const data = record(value);
	if (typeof data.id !== 'string' || !ID.test(data.id) || typeof data.name !== 'string' || !data.name || data.name.length > 256
		|| (data.format !== 'aup3' && data.format !== 'aup4') || typeof data.size !== 'number' || !Number.isSafeInteger(data.size) || data.size < 0
		|| (data.snapshotId !== null && (typeof data.snapshotId !== 'string' || !ID.test(data.snapshotId)))) throw new Error('Invalid project archive metadata.');
	return { id: data.id, name: data.name, format: data.format, size: data.size, snapshotId: data.snapshotId };
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid project archive response.');
	return value as Record<string, unknown>;
}
async function dataResponse(response: Response): Promise<unknown> {
	try {
		const body = await boundedBlob(response, 1048576, false);
		const parsed = record(JSON.parse(await body.text()) as unknown);
		if (!response.ok) {
			const error = parsed.error && typeof parsed.error === 'object' ? record(parsed.error) : {};
			throw new AudiocomApiError(response.status, typeof error.message === 'string' ? error.message : 'The project archive request failed.');
		}
		return parsed.data;
	} catch (error) {
		if (!response.ok && !(error instanceof AudiocomApiError)) throw new AudiocomApiError(response.status, 'The project archive request failed.');
		throw error;
	}
}
async function boundedBlob(response: Response, maximum: number, exact = true): Promise<Blob> {
	if (!response.body) throw new Error('The project archive response is empty.');
	const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
	try {
		for (;;) {
			const next = await reader.read(); if (next.done) break;
			size += next.value.byteLength;
			if (size > maximum) { await reader.cancel(); throw new Error('The project archive response exceeds its size limit.'); }
			chunks.push(new Uint8Array(next.value));
		}
	} finally { reader.releaseLock(); }
	if (exact && size !== maximum) throw new Error('The downloaded project archive is incomplete.');
	return new Blob(chunks, { type: 'application/octet-stream' });
}
