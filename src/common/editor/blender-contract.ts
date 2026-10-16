/* SPDX-License-Identifier: AGPL-3.0-only */

export const BLENDER_CHUNK_BYTE_LIMIT = 4 * 1024 * 1024;
export const BLENDER_TRACK_LIMIT = 128;
export const BLENDER_CHANNELS = Object.freeze({
	select: 'soundscaper:blender:select',
	begin: 'soundscaper:blender:begin',
	write: 'soundscaper:blender:write',
	commit: 'soundscaper:blender:commit',
	abort: 'soundscaper:blender:abort',
	stop: 'soundscaper:blender:stop',
});

export interface BlenderTrack {
	readonly id: string;
	readonly name: string;
	readonly startSeconds: number;
	readonly durationSeconds: number;
	readonly mute: boolean;
}
export interface BlenderManifest {
	readonly schemaVersion: 1;
	readonly projectId: string;
	readonly projectName: string;
	readonly revision: number;
	readonly tracks: readonly (BlenderTrack & { readonly fileName: string })[];
}
export interface BlenderSelectRequest { readonly live: boolean }
export interface BlenderSessionRequest { readonly sessionId: string }
export interface BlenderPublicationRequest extends BlenderSessionRequest { readonly publicationId: string }
export interface BlenderBeginRequest extends BlenderSessionRequest {
	readonly projectId: string;
	readonly projectName: string;
	readonly tracks: readonly BlenderTrack[];
}
export interface BlenderWriteRequest extends BlenderPublicationRequest {
	readonly trackId: string;
	readonly offset: number;
	readonly bytes: Uint8Array;
}
export interface BlenderBridge {
	select(value: BlenderSelectRequest): Promise<{ readonly sessionId: string } | null>;
	begin(value: BlenderBeginRequest): Promise<{ readonly publicationId: string }>;
	write(value: BlenderWriteRequest): Promise<void>;
	commit(value: BlenderPublicationRequest): Promise<{ readonly revision: number }>;
	abort(value: BlenderPublicationRequest): Promise<void>;
	stop(value: BlenderSessionRequest): Promise<void>;
}

export function validateBlenderSelect(value: unknown): BlenderSelectRequest {
	const record = closed(value, ['live']);
	if (typeof record.live !== 'boolean') throw new TypeError('Blender live flag must be boolean');
	return { live: record.live };
}

export function validateBlenderSession(value: unknown): BlenderSessionRequest {
	const record = closed(value, ['sessionId']);
	return { sessionId: opaque(record.sessionId) };
}

export function validateBlenderPublication(value: unknown): BlenderPublicationRequest {
	const record = closed(value, ['sessionId', 'publicationId']);
	return { sessionId: opaque(record.sessionId), publicationId: opaque(record.publicationId) };
}

export function validateBlenderBegin(value: unknown): BlenderBeginRequest {
	const record = closed(value, ['sessionId', 'projectId', 'projectName', 'tracks']);
	if (!Array.isArray(record.tracks) || record.tracks.length > BLENDER_TRACK_LIMIT) {
		throw new TypeError('Blender tracks exceed the bounded track limit');
	}
	const ids = new Set<string>();
	const tracks = Array.from({ length: record.tracks.length }, (_, index): BlenderTrack => {
		const descriptor = Object.getOwnPropertyDescriptor(record.tracks, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Blender tracks must be own data properties');
		const track = closed(descriptor.value, ['id', 'name', 'startSeconds', 'durationSeconds', 'mute']);
		const id = label(track.id, 256, 'track id');
		if (ids.has(id)) throw new TypeError('Blender track ids must be unique');
		ids.add(id);
		if (typeof track.mute !== 'boolean') throw new TypeError('Blender track mute must be boolean');
		return {
			id, name: label(track.name, 1024, 'track name'),
			startSeconds: seconds(track.startSeconds, 'start'),
			durationSeconds: seconds(track.durationSeconds, 'duration'), mute: track.mute,
		};
	});
	return {
		sessionId: opaque(record.sessionId), projectId: label(record.projectId, 256, 'project id'),
		projectName: label(record.projectName, 1024, 'project name'), tracks,
	};
}

export function validateBlenderWrite(value: unknown): BlenderWriteRequest {
	const record = closed(value, ['sessionId', 'publicationId', 'trackId', 'offset', 'bytes']);
	if (!Number.isSafeInteger(record.offset) || (record.offset as number) < 0) throw new TypeError('Invalid Blender chunk offset');
	if (!(record.bytes instanceof Uint8Array) || record.bytes.byteLength === 0
		|| record.bytes.byteLength > BLENDER_CHUNK_BYTE_LIMIT) throw new TypeError('Invalid Blender WAV chunk size');
	return {
		sessionId: opaque(record.sessionId), publicationId: opaque(record.publicationId),
		trackId: label(record.trackId, 256, 'track id'), offset: record.offset as number,
		bytes: Uint8Array.from(record.bytes),
	};
}

function closed<const Key extends string>(value: unknown, fields: readonly Key[]): Record<Key, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Blender request must be a plain record');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key as Key))) {
		throw new TypeError('Blender request has unsupported or missing fields');
	}
	const result = Object.create(null) as Record<Key, unknown>;
	for (const key of fields) {
		const property = Object.getOwnPropertyDescriptor(value, key);
		if (!property?.enumerable || !Object.hasOwn(property, 'value')) throw new TypeError('Blender fields must be own data properties');
		result[key] = property.value;
	}
	return result;
}

function opaque(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{48}$/u.test(value)) throw new TypeError('Invalid Blender session or publication id');
	return value;
}
function label(value: unknown, maximum: number, name: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum || /\p{Cc}/u.test(value)) {
		throw new TypeError(`Invalid Blender ${name}`);
	}
	return value;
}
function seconds(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
		throw new TypeError(`Invalid Blender track ${name}`);
	}
	return value;
}
