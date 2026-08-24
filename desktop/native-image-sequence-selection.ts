/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned, pathless and generation-neutral image-sequence file capabilities. */

import { constants as fsConstants } from 'node:fs';
import { open, lstat, type FileHandle } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

import {
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAMES,
	resolveNativeMediaImageSequence,
} from '../src/common/editor/native-media-image-sequence.ts';
import {
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES,
} from '../src/common/editor/native-media-image-sequence-v25.ts';
import {
	NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES,
} from '../src/common/editor/native-media-image-sequence-pack-v25.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;

const OPAQUE_ID = /^[a-f0-9]{40}$/u;
const SELECT_REQUEST_FIELDS = Object.freeze([] as const);
const READ_REQUEST_FIELDS = Object.freeze(['selectionId', 'fileId', 'offset', 'length'] as const);
const RELEASE_REQUEST_FIELDS = Object.freeze(['selectionId'] as const);

export const FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_MAXIMUM_ACTIVE_SELECTIONS = 8;
export const FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_MAXIMUM_ACTIVE_SELECTIONS_PER_OWNER = 2;

export interface FramescaperNativeImageSequenceSelectedFileV1 {
	readonly fileId: string;
	readonly name: string;
	readonly byteLength: number;
}

export interface FramescaperNativeImageSequenceSelectionV1 {
	readonly selectionId: string;
	readonly files: readonly FramescaperNativeImageSequenceSelectedFileV1[];
}

export interface FramescaperNativeImageSequenceSelectionBrokerOptions {
	readonly selectFiles: () => Awaitable<readonly string[] | null>;
	readonly mintOpaqueId: () => string;
}

interface FileIdentity {
	readonly path: string;
	readonly name: string;
	readonly byteLength: number;
	readonly device: bigint;
	readonly inode: bigint;
	readonly modifiedNs: bigint;
	readonly changedNs: bigint;
}

interface SelectionState {
	readonly owner: object;
	readonly files: ReadonlyMap<string, FileIdentity>;
}

/**
 * Keep native paths in main. Renderer requests carry only opaque selection/file
 * identities and exact bounded ranges; every range is restated before and after
 * reading so a changed selection never becomes admitted media.
 */
export class FramescaperNativeImageSequenceSelectionBroker {
	readonly #options: FramescaperNativeImageSequenceSelectionBrokerOptions;
	readonly #selections = new Map<string, SelectionState>();
	readonly #pendingByOwner = new Map<object, number>();
	readonly #revokedOwners = new WeakSet<object>();
	#pendingSelections = 0;
	#disposed = false;

	constructor(optionsValue: FramescaperNativeImageSequenceSelectionBrokerOptions | unknown) {
		const options = closedRecord(
			optionsValue, ['selectFiles', 'mintOpaqueId'], 'image-sequence selection broker options',
		);
		if (typeof options.selectFiles !== 'function' || typeof options.mintOpaqueId !== 'function') {
			throw new TypeError('Image-sequence selection requires chooser and opaque-ID seams.');
		}
		this.#options = options as unknown as FramescaperNativeImageSequenceSelectionBrokerOptions;
	}

	async select(ownerValue: unknown, requestValue: unknown = {}): Promise<FramescaperNativeImageSequenceSelectionV1 | null> {
		const owner = exactOwner(ownerValue);
		closedRecord(requestValue, SELECT_REQUEST_FIELDS, 'image-sequence selection request');
		this.#reserveSelection(owner);
		try {
			const pathsValue = await this.#options.selectFiles();
			this.#assertOpenOwner(owner);
			if (pathsValue === null) return null;
			if (!Array.isArray(pathsValue) || pathsValue.length === 0
				|| pathsValue.length > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAMES
				|| Reflect.ownKeys(pathsValue).length !== pathsValue.length + 1) {
				throw new TypeError('Image-sequence selection must return a bounded dense path list.');
			}
			const paths = pathsValue.map(exactPrivatePath);
			if (new Set(paths).size !== paths.length) {
				throw new RangeError('Image-sequence selection contains a duplicate file path.');
			}
			const identities = await Promise.all(paths.map(fileIdentity));
			this.#assertOpenOwner(owner);
			resolveNativeMediaImageSequence({
				fileNames: identities.map(({ name }) => name),
				frameRate: { num: 24, den: 1 },
			});
			const selectionId = this.#mintUnusedSelectionId();
			const files = new Map<string, FileIdentity>();
			const projection = identities.map((identity) => {
				const fileId = this.#mintUnusedFileId(files);
				files.set(fileId, identity);
				return Object.freeze({ fileId, name: identity.name, byteLength: identity.byteLength });
			});
			this.#selections.set(selectionId, Object.freeze({ owner, files }));
			return Object.freeze({ selectionId, files: Object.freeze(projection) });
		} finally {
			this.#releaseSelectionReservation(owner);
		}
	}

	async read(ownerValue: unknown, requestValue: unknown): Promise<Uint8Array> {
		const owner = exactOwner(ownerValue);
		const request = closedRecord(requestValue, READ_REQUEST_FIELDS, 'image-sequence range request');
		const selectionId = opaqueId(request.selectionId, 'selection ID');
		const fileId = opaqueId(request.fileId, 'file ID');
		const offset = nonNegativeInteger(request.offset, 'range offset');
		const length = positiveInteger(request.length, 'range length');
		if (length > NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES) {
			throw new RangeError('Image-sequence range length exceeds the negotiated chunk ceiling.');
		}
		const state = this.#owned(selectionId, owner);
		const identity = state.files.get(fileId);
		if (!identity) throw new Error('The selected image-sequence file is unavailable.');
		if (offset > identity.byteLength - length) {
			throw new RangeError('Image-sequence range is outside the selected file.');
		}
		let handle: FileHandle;
		try {
			handle = await open(identity.path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
		} catch (error) {
			throw new Error('The selected image-sequence file changed after selection.', { cause: error });
		}
		try {
			await assertOpenFileCurrent(handle, identity);
			const bytes = new Uint8Array(length);
			const result = await handle.read(bytes, 0, length, offset);
			if (result.bytesRead !== length) throw new Error('The selected image-sequence file returned a short range.');
			await assertOpenFileCurrent(handle, identity);
			return bytes;
		} finally {
			await handle.close();
		}
	}

	async release(ownerValue: unknown, requestValue: unknown): Promise<boolean> {
		const owner = exactOwner(ownerValue);
		const request = closedRecord(requestValue, RELEASE_REQUEST_FIELDS, 'image-sequence release request');
		const selectionId = opaqueId(request.selectionId, 'selection ID');
		this.#owned(selectionId, owner);
		return this.#selections.delete(selectionId);
	}

	disposeOwner(ownerValue: unknown): number {
		const owner = exactOwner(ownerValue);
		this.#revokedOwners.add(owner);
		let removed = 0;
		for (const [selectionId, state] of this.#selections) {
			if (state.owner !== owner) continue;
			this.#selections.delete(selectionId);
			removed += 1;
		}
		return removed;
	}

	dispose(): number {
		if (this.#disposed) return 0;
		this.#disposed = true;
		const count = this.#selections.size;
		this.#selections.clear();
		return count;
	}

	#owned(selectionId: string, owner: object): SelectionState {
		this.#assertOpenOwner(owner);
		const state = this.#selections.get(selectionId);
		if (!state) throw new Error('The image-sequence selection is unavailable.');
		if (state.owner !== owner) throw new Error('The image-sequence selection belongs to another owner.');
		return state;
	}

	#assertOpenOwner(owner: object): void {
		if (this.#disposed || this.#revokedOwners.has(owner)) {
			throw new Error('The image-sequence selection owner is unavailable.');
		}
	}

	#reserveSelection(owner: object): void {
		this.#assertOpenOwner(owner);
		let ownerSelections = this.#pendingByOwner.get(owner) ?? 0;
		for (const state of this.#selections.values()) {
			if (state.owner === owner) ownerSelections += 1;
		}
		if (this.#selections.size + this.#pendingSelections
			>= FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_MAXIMUM_ACTIVE_SELECTIONS
			|| ownerSelections
			>= FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_MAXIMUM_ACTIVE_SELECTIONS_PER_OWNER) {
			throw new Error('The image-sequence selection capacity is exhausted.');
		}
		this.#pendingSelections += 1;
		this.#pendingByOwner.set(owner, (this.#pendingByOwner.get(owner) ?? 0) + 1);
	}

	#releaseSelectionReservation(owner: object): void {
		this.#pendingSelections -= 1;
		const pending = (this.#pendingByOwner.get(owner) ?? 1) - 1;
		if (pending === 0) this.#pendingByOwner.delete(owner);
		else this.#pendingByOwner.set(owner, pending);
	}

	#mintUnusedSelectionId(): string {
		for (let attempt = 0; attempt < 16; attempt += 1) {
			const id = opaqueId(this.#options.mintOpaqueId(), 'selection ID');
			if (!this.#selections.has(id)) return id;
		}
		throw new Error('Could not mint a unique image-sequence selection ID.');
	}

	#mintUnusedFileId(files: ReadonlyMap<string, FileIdentity>): string {
		for (let attempt = 0; attempt < 16; attempt += 1) {
			const id = opaqueId(this.#options.mintOpaqueId(), 'file ID');
			if (!files.has(id)) return id;
		}
		throw new Error('Could not mint a unique image-sequence file ID.');
	}
}

async function fileIdentity(path: string): Promise<FileIdentity> {
	const metadata = await lstat(path, { bigint: true });
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new TypeError('An image-sequence selection must contain direct regular files.');
	}
	if (metadata.size < 1n || metadata.size > BigInt(NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES)) {
		throw new RangeError('An image-sequence frame exceeds its admitted byte domain.');
	}
	return Object.freeze({
		path,
		name: basename(path),
		byteLength: Number(metadata.size),
		device: metadata.dev,
		inode: metadata.ino,
		modifiedNs: metadata.mtimeNs,
		changedNs: metadata.ctimeNs,
	});
}

async function assertOpenFileCurrent(handle: FileHandle, expected: FileIdentity): Promise<void> {
	const current = await handle.stat({ bigint: true });
	if (!current.isFile() || current.isSymbolicLink()
		|| current.size !== BigInt(expected.byteLength)
		|| current.dev !== expected.device || current.ino !== expected.inode
		|| current.mtimeNs !== expected.modifiedNs || current.ctimeNs !== expected.changedNs) {
		throw new Error('The selected image-sequence file changed after selection.');
	}
}

function exactPrivatePath(value: unknown): string {
	if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4_096 || value.includes('\0')) {
		throw new TypeError('The native image-sequence chooser returned an invalid private path.');
	}
	return value;
}

function exactOwner(value: unknown): object {
	if (!value || typeof value !== 'object') throw new TypeError('Image-sequence selection requires an exact owner.');
	return value;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
		throw new TypeError(`Image-sequence ${label} is invalid.`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`Image-sequence ${label} is invalid.`);
	return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`Image-sequence ${label} is invalid.`);
	return Number(value);
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== fields.length) {
		throw new TypeError(`Framescaper ${label} must be an exact record.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper ${label} must be an exact record.`);
		}
	}
	return value as Readonly<Record<Field, unknown>>;
}
