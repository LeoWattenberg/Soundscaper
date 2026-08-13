/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { constants as fileConstants, type Stats } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
	createFramescaperDesktopProjectLibraryV10Paths,
	validateFramescaperDesktopProjectLibraryV10Owner,
	type FramescaperDesktopProjectLibraryV10Handshake,
	type FramescaperDesktopProjectLibraryV10Owner,
	type FramescaperDesktopProjectLibraryV10Paths,
} from './project-library-v10-contract.ts';
import {
	createFramescaperDesktopProjectLibraryV10HandshakeGate,
	type FramescaperDesktopProjectLibraryV10HandshakeState,
} from './project-library-v10-handshake-gate.ts';
import {
	validateFramescaperDesktopLibraryV10Metadata,
	type FramescaperDesktopLibraryV10Media,
} from './project-library-v10-metadata.ts';

export interface FramescaperDesktopProjectLibraryV10ProxyMediaAudit {
	readonly owner: 'framescaper';
	readonly librarySchemaVersion: 10;
	readonly projectSchemaVersion: 18;
	readonly databaseUserVersion: 12;
	readonly metadataRevision: number;
	readonly totalBytes: number;
	readonly media: readonly Readonly<{
		readonly id: string;
		readonly relativeFile: string;
		readonly byteLength: number;
		readonly sha256: string;
	}>[];
}

const OPTION_FIELDS = ['appDataPath', 'owner'] as const;
const MAXIMUM_PROXY_BYTES = 512 * 1024 * 1024;
const MAXIMUM_INVENTORY_ENTRIES = 100_000;
const READ_CHUNK_BYTES = 1024 * 1024;

/** Read-only integrity owner for one isolated V10 managed-proxy inventory. */
export class FramescaperDesktopProjectLibraryV10ProxyMediaInventory {
	readonly localHandshake: Readonly<FramescaperDesktopProjectLibraryV10Handshake>;
	readonly owner: Readonly<FramescaperDesktopProjectLibraryV10Owner>;
	readonly paths: Readonly<FramescaperDesktopProjectLibraryV10Paths>;
	readonly #gate = createFramescaperDesktopProjectLibraryV10HandshakeGate();

	private constructor(
		paths: Readonly<FramescaperDesktopProjectLibraryV10Paths>,
		owner: Readonly<FramescaperDesktopProjectLibraryV10Owner>,
	) {
		this.paths = paths;
		this.owner = owner;
		this.localHandshake = this.#gate.local;
	}

	static create(value: unknown): FramescaperDesktopProjectLibraryV10ProxyMediaInventory {
		const options = snapshotClosedRecord(value, OPTION_FIELDS, 'Framescaper V10 proxy inventory options');
		if (typeof options.appDataPath !== 'string') {
			throw new TypeError('Framescaper V10 proxy inventory appDataPath must be a string');
		}
		return Object.freeze(new FramescaperDesktopProjectLibraryV10ProxyMediaInventory(
			createFramescaperDesktopProjectLibraryV10Paths(options.appDataPath),
			validateFramescaperDesktopProjectLibraryV10Owner(options.owner),
		)) as FramescaperDesktopProjectLibraryV10ProxyMediaInventory;
	}

	handshakeState(): FramescaperDesktopProjectLibraryV10HandshakeState {
		return this.#gate.state();
	}

	acceptHandshake(value: unknown): Readonly<FramescaperDesktopProjectLibraryV10Handshake> {
		return this.#gate.accept(value);
	}

	async audit(
		metadataValue: unknown,
		signal?: AbortSignal,
	): Promise<Readonly<FramescaperDesktopProjectLibraryV10ProxyMediaAudit>> {
		this.#gate.assertOperational();
		throwIfAborted(signal);
		const metadata = validateFramescaperDesktopLibraryV10Metadata(metadataValue);
		const totalBytes = checkedMediaBytes(metadata.media);
		const expectedPaths = metadata.media.map(({ relativeFile }) => relativeFile).sort();
		const actualPaths = await inventoryFiles(this.paths.managedMediaRoot, signal);
		if (!sameStrings(actualPaths, expectedPaths)) {
			throw new Error('Framescaper V10 proxy media inventory does not match its expected paths');
		}

		for (const media of metadata.media) {
			throwIfAborted(signal);
			const absolutePath = confinedMediaPath(this.paths.managedMediaRoot, media.relativeFile);
			await verifyMediaFile(absolutePath, media, signal);
		}

		return Object.freeze({
			owner: this.localHandshake.owner,
			librarySchemaVersion: this.localHandshake.desktopLibrarySchemaVersion,
			projectSchemaVersion: this.localHandshake.projectSchemaVersion,
			databaseUserVersion: this.localHandshake.desktopDatabaseUserVersion,
			metadataRevision: metadata.revision,
			totalBytes,
			media: Object.freeze(metadata.media.map((entry) => Object.freeze({
				id: entry.id,
				relativeFile: entry.relativeFile,
				byteLength: entry.byteLength,
				sha256: entry.sha256,
			}))),
		});
	}
}

function checkedMediaBytes(media: readonly Readonly<FramescaperDesktopLibraryV10Media>[]): number {
	let total = 0;
	for (const entry of media) {
		if (entry.byteLength > MAXIMUM_PROXY_BYTES) {
			throw new RangeError('Framescaper V10 proxy media exceeds its 512 MiB maximum');
		}
		if (entry.byteLength > Number.MAX_SAFE_INTEGER - total) {
			throw new RangeError('Framescaper V10 proxy media aggregate byte length is unsafe');
		}
		total += entry.byteLength;
	}
	return total;
}

async function inventoryFiles(root: string, signal?: AbortSignal): Promise<string[]> {
	throwIfAborted(signal);
	try {
		const rootStat = await lstat(root);
		if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
			throw new Error('Framescaper V10 proxy media root must be a real directory');
		}
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return [];
		throw error;
	}
	const files: string[] = [];
	const pending: Array<Readonly<{ absolute: string; relative: string }>> = [{
		absolute: root,
		relative: '',
	}];
	let entries = 0;
	while (pending.length) {
		throwIfAborted(signal);
		const directory = pending.pop();
		if (!directory) break;
		const children = await readdir(directory.absolute, { withFileTypes: true });
		children.sort((left, right) => left.name.localeCompare(right.name));
		for (const child of children) {
			throwIfAborted(signal);
			entries += 1;
			if (entries > MAXIMUM_INVENTORY_ENTRIES) {
				throw new RangeError('Framescaper V10 proxy media inventory exceeds its entry limit');
			}
			const childRelative = directory.relative
				? `${directory.relative}/${child.name}`
				: child.name;
			const childAbsolute = join(directory.absolute, child.name);
			if (child.isSymbolicLink()) {
				throw new Error(`Framescaper V10 proxy media inventory contains a symbolic link: ${childRelative}`);
			}
			if (child.isDirectory()) pending.push({ absolute: childAbsolute, relative: childRelative });
			else if (child.isFile()) files.push(childRelative);
			else throw new Error(
				`Framescaper V10 proxy media inventory contains an unsupported entry: ${childRelative}`,
			);
		}
	}
	return files.sort();
}

async function verifyMediaFile(
	absolutePath: string,
	media: Readonly<FramescaperDesktopLibraryV10Media>,
	signal?: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	const handle = await open(absolutePath, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.size !== media.byteLength) {
			throw new Error(`Framescaper V10 proxy media ${media.id} has an unexpected byte length`);
		}
		const digest = createHash('sha256');
		const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, media.byteLength));
		let offset = 0;
		while (offset < media.byteLength) {
			throwIfAborted(signal);
			const length = Math.min(buffer.byteLength, media.byteLength - offset);
			const { bytesRead } = await handle.read(buffer, 0, length, offset);
			if (bytesRead === 0) {
				throw new Error(`Framescaper V10 proxy media ${media.id} ended before its declared length`);
			}
			digest.update(buffer.subarray(0, bytesRead));
			offset += bytesRead;
		}
		throwIfAborted(signal);
		const after = await handle.stat();
		if (!sameFileSnapshot(before, after)) {
			throw new Error(`Framescaper V10 proxy media ${media.id} changed during verification`);
		}
		if (digest.digest('hex') !== media.sha256) {
			throw new Error(`Framescaper V10 proxy media ${media.id} failed SHA-256 verification`);
		}
	} finally {
		await handle.close();
	}
}

function sameFileSnapshot(left: Stats, right: Stats): boolean {
	return left.dev === right.dev
		&& left.ino === right.ino
		&& left.size === right.size
		&& left.mtimeMs === right.mtimeMs
		&& left.ctimeMs === right.ctimeMs;
}

function confinedMediaPath(root: string, relativeFile: string): string {
	const absolutePath = resolve(root, ...relativeFile.split('/'));
	const fromRoot = relative(root, absolutePath);
	if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
		throw new TypeError('Framescaper V10 proxy media path leaves its managed root');
	}
	return absolutePath;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${name} has missing or unsupported fields`);
	const snapshot = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		snapshot[field] = descriptor.value;
	}
	return snapshot;
}

function throwIfAborted(signal?: AbortSignal): void {
	signal?.throwIfAborted();
}

function errorCode(value: unknown): string | null {
	return value && typeof value === 'object' && 'code' in value && typeof value.code === 'string'
		? value.code
		: null;
}
