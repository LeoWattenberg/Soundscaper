/* SPDX-License-Identifier: AGPL-3.0-only */

type Awaitable<Value> = PromiseLike<Value> | Value;
type DataRecord = Readonly<Record<string, unknown>>;

export interface VideoExportOriginalStore {
	loadMediaAsset(
		storageKey: string,
		options: Readonly<{ readonly signal: AbortSignal }>,
	): Awaitable<Blob | null>;
	resolveLinkedVideoOriginal?(
		projectId: string,
		source: DataRecord,
		options: Readonly<{ readonly signal: AbortSignal }>,
	): Awaitable<Readonly<{ readonly blob: Blob; readonly binding: unknown }> | null>;
}

export interface VideoExportOriginalRequest {
	readonly store: VideoExportOriginalStore;
	readonly project: unknown;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}

/** Open delivery authority in retained-media-first order, then the pathless linked binding. */
export async function loadVideoExportOriginal(
	request: VideoExportOriginalRequest,
): Promise<Blob | null> {
	const sourceId = boundedId(request.sourceId, 'video source ID');
	const storageKey = boundedId(request.storageKey, 'video storage key');
	const options = Object.freeze({ signal: request.signal });
	assertReady(request);
	const owned = await request.store.loadMediaAsset(storageKey, options);
	assertReady(request);
	if (owned !== null) return blob(owned, 'Owned video original');

	const source = projectVideoSource(request.project, sourceId);
	const resolveLinked = request.store.resolveLinkedVideoOriginal;
	if (source === null || typeof resolveLinked !== 'function') return null;
	const projectId = projectIdentifier(request.project);
	if (projectId === null) return null;
	const linked = await resolveLinked.call(request.store, projectId, source, options);
	assertReady(request);
	if (linked === null) return null;
	const record = dataRecord(linked, 'Linked video original');
	return blob(dataProperty(record, 'blob', 'Linked video original'), 'Linked video original');
}

function assertReady(request: VideoExportOriginalRequest): void {
	if (request.signal.aborted) {
		throw request.signal.reason ?? new DOMException('Video delivery was cancelled.', 'AbortError');
	}
	request.assertCurrent();
}

function projectIdentifier(project: unknown): string | null {
	const record = nullableRecord(project);
	return record && typeof record.id === 'string' && record.id.length > 0 ? record.id : null;
}

function projectVideoSource(project: unknown, sourceId: string): DataRecord | null {
	const record = nullableRecord(project);
	const sources = record?.sources;
	if (!Array.isArray(sources)) return null;
	const matches = sources.map(nullableRecord).filter((source): source is DataRecord => (
		source !== null && source.id === sourceId
	));
	if (matches.length > 1) throw new RangeError(`Video source ${sourceId} is duplicated.`);
	const source = matches[0] ?? null;
	if (source !== null && source.kind !== 'video') {
		throw new TypeError(`Source ${sourceId} is not a video source.`);
	}
	return source;
}

function nullableRecord(value: unknown): DataRecord | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null ? value as DataRecord : null;
}

function dataRecord(value: unknown, name: string): DataRecord {
	const result = nullableRecord(value);
	if (result === null) throw new TypeError(`${name} must be a plain record.`);
	return result;
}

function dataProperty(record: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own data property.`);
	}
	return descriptor.value;
}

function blob(value: unknown, name: string): Blob {
	if (!(value instanceof Blob)) throw new TypeError(`${name} must be a Blob.`);
	return value;
}

function boundedId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
		throw new TypeError(`${name} must be a bounded string.`);
	}
	return value;
}
