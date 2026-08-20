/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	mediaAssetChunkRecord,
	type MediaAssetChunkRead,
	type MediaAssetChunkRecord,
} from './media-asset-chunk-records.ts';
import type { OpfsRepository } from './opfs-repository.ts';

const SELECTION_KEY_PREFIX = 'framescaper-capture-chunk-storage-v1:';
const REFERENCE_KEY_PREFIX = 'framescaper-capture-opfs-chunk-v1:';

export type EncodedCaptureChunkBackend = 'opfs' | 'chunk-fallback';

interface CaptureChunkKeyValuePort {
	get(key: string): PromiseLike<unknown> | unknown;
	putIfAbsent(key: string, value: unknown): PromiseLike<boolean> | boolean;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
}

interface CaptureChunkFallbackPort {
	write(record: MediaAssetChunkRecord): PromiseLike<void> | void;
	chunks(token: string): AsyncIterable<MediaAssetChunkRead>;
	deleteOwned(token: string, sourceId: string): PromiseLike<boolean> | boolean;
	deleteTailOwned(token: string, sourceId: string, firstIndex: number): PromiseLike<boolean> | boolean;
}

interface CaptureChunkStorageSelection {
	readonly version: 1;
	readonly token: string;
	readonly sourceId: string;
	readonly backend: EncodedCaptureChunkBackend;
}

interface OpfsCaptureChunkReference {
	readonly version: 1;
	readonly token: string;
	readonly sourceId: string;
	readonly index: number;
	readonly path: string;
	readonly metadata: Readonly<Record<string, unknown>>;
}

export interface OpfsPreferredEncodedCaptureChunkPortOptions {
	readonly values: CaptureChunkKeyValuePort;
	readonly opfs: Pick<OpfsRepository, 'directory' | 'writeBlob' | 'loadBinaryRecord' | 'deletePath'>;
	readonly fallback: CaptureChunkFallbackPort;
}

/**
 * Selects one durable backend per encoded stream. OPFS payloads carry their
 * ownership metadata in the existing analysis store, so a reload can recover
 * only the exact acknowledged prefix without adding an IndexedDB store.
 */
export class OpfsPreferredEncodedCaptureChunkPort {
	readonly #values: CaptureChunkKeyValuePort;
	readonly #opfs: OpfsPreferredEncodedCaptureChunkPortOptions['opfs'];
	readonly #fallback: CaptureChunkFallbackPort;

	constructor(options: OpfsPreferredEncodedCaptureChunkPortOptions) {
		this.#values = options.values;
		this.#opfs = options.opfs;
		this.#fallback = options.fallback;
	}

	async write(value: MediaAssetChunkRecord): Promise<void> {
		const record = mediaAssetChunkRecord(value);
		if (!record) throw new TypeError('Encoded capture requires a valid physical media chunk.');
		const selection = await this.#select(record.mediaChunkToken, record.sourceId);
		if (selection.backend === 'chunk-fallback') {
			await this.#fallback.write(value);
			return;
		}
		const written = await this.#opfs.writeBlob(
			`framescaper-capture-${record.sourceId}-${String(record.index)}`,
			record.payload,
		);
		if (!written) throw new Error('The selected OPFS capture backend became unavailable.');
		const metadata: Record<string, unknown> = { ...value };
		delete metadata.payload;
		const reference: OpfsCaptureChunkReference = Object.freeze({
			version: 1,
			token: record.mediaChunkToken,
			sourceId: record.sourceId,
			index: record.index,
			path: written.path,
			metadata: Object.freeze(structuredClone(metadata)),
		});
		if (await this.#values.putIfAbsent(referenceKey(reference.token, reference.index), reference)) return;
		await this.#opfs.deletePath(reference.path);
		throw new Error('Encoded capture OPFS chunk ownership already exists.');
	}

	async *chunks(tokenValue: string): AsyncGenerator<MediaAssetChunkRead> {
		const token = stableText(tokenValue, 'encoded capture chunk token', 512);
		const selection = await this.#selection(token);
		if (!selection || selection.backend === 'chunk-fallback') {
			yield* this.#fallback.chunks(token);
			return;
		}
		for (let index = 0; ; index += 1) {
			const reference = await this.#reference(token, index);
			if (!reference) return;
			const payload = await this.#opfs.loadBinaryRecord({
				storage: 'opfs',
				path: reference.path,
				mimeType: 'application/octet-stream',
			}, `Encoded capture OPFS chunk ${String(index)} is missing.`);
			yield Object.freeze({
				primaryKey: referenceKey(token, index),
				value: Object.freeze({ ...reference.metadata, payload }),
			});
		}
	}

	async deleteOwned(tokenValue: string, sourceIdValue: string): Promise<boolean> {
		const token = stableText(tokenValue, 'encoded capture chunk token', 512);
		const sourceId = stableText(sourceIdValue, 'encoded capture sourceId', 256);
		const selection = await this.#selection(token);
		if (!selection) return this.#fallback.deleteOwned(token, sourceId);
		if (selection.sourceId !== sourceId) return false;
		if (selection.backend === 'chunk-fallback') {
			if (!await this.#fallback.deleteOwned(token, sourceId)) return false;
			return this.#values.deleteIfCurrent(selectionKey(token), selection);
		}
		const references: OpfsCaptureChunkReference[] = [];
		for (let index = 0; ; index += 1) {
			const reference = await this.#reference(token, index);
			if (!reference) break;
			if (reference.sourceId !== sourceId) return false;
			references.push(reference);
		}
		for (const reference of references) {
			if (!await this.#values.deleteIfCurrent(
				referenceKey(token, reference.index),
				reference,
			)) return false;
			await this.#opfs.deletePath(reference.path);
		}
		return this.#values.deleteIfCurrent(selectionKey(token), selection);
	}

	async deleteTailOwned(tokenValue: string, sourceIdValue: string, firstIndex: number): Promise<boolean> {
		const token = stableText(tokenValue, 'encoded capture chunk token', 512);
		const sourceId = stableText(sourceIdValue, 'encoded capture sourceId', 256);
		const selection = await this.#selection(token);
		if (!selection) return this.#fallback.deleteTailOwned(token, sourceId, firstIndex);
		if (selection.sourceId !== sourceId) return false;
		if (selection.backend === 'chunk-fallback') {
			return this.#fallback.deleteTailOwned(token, sourceId, firstIndex);
		}
		const references: OpfsCaptureChunkReference[] = [];
		for (let index = firstIndex; ; index += 1) {
			const reference = await this.#reference(token, index);
			if (!reference) break;
			if (reference.sourceId !== sourceId) return false;
			references.push(reference);
		}
		for (const reference of references) {
			if (!await this.#values.deleteIfCurrent(referenceKey(token, reference.index), reference)) return false;
			await this.#opfs.deletePath(reference.path);
		}
		return true;
	}

	async backend(tokenValue: string): Promise<EncodedCaptureChunkBackend | null> {
		return (await this.#selection(stableText(
			tokenValue,
			'encoded capture chunk token',
			512,
		)))?.backend ?? null;
	}

	async retainedPaths(tokens: ReadonlySet<string>): Promise<ReadonlySet<string>> {
		const paths = new Set<string>();
		for (const tokenValue of tokens) {
			const token = stableText(tokenValue, 'encoded capture chunk token', 512);
			const selection = await this.#selection(token);
			if (selection?.backend !== 'opfs') continue;
			for (let index = 0; ; index += 1) {
				const reference = await this.#reference(token, index);
				if (!reference) break;
				paths.add(reference.path);
			}
		}
		return paths;
	}

	/** Release only the fallback selector after ordinary media adopts its bytes. */
	async releaseAdoptedFallback(tokenValue: string, sourceIdValue: string): Promise<void> {
		const token = stableText(tokenValue, 'encoded capture chunk token', 512);
		const sourceId = stableText(sourceIdValue, 'encoded capture sourceId', 256);
		const selection = await this.#selection(token);
		if (!selection || selection.backend !== 'chunk-fallback' || selection.sourceId !== sourceId) {
			throw new Error('Only an adopted fallback capture token can release its selector.');
		}
		if (!await this.#values.deleteIfCurrent(selectionKey(token), selection)) {
			throw new Error('The adopted capture fallback selector changed before release.');
		}
	}

	async #select(token: string, sourceId: string): Promise<CaptureChunkStorageSelection> {
		const existing = await this.#selection(token);
		if (existing) {
			if (existing.sourceId !== sourceId) {
				throw new Error('Encoded capture chunk selector ownership changed.');
			}
			return existing;
		}
		const backend: EncodedCaptureChunkBackend = await this.#opfs.directory()
			? 'opfs'
			: 'chunk-fallback';
		const selected = Object.freeze({ version: 1, token, sourceId, backend } as const);
		if (await this.#values.putIfAbsent(selectionKey(token), selected)) return selected;
		const raced = await this.#selection(token);
		if (!raced || raced.sourceId !== sourceId) {
			throw new Error('Encoded capture chunk selector changed during admission.');
		}
		return raced;
	}

	async #selection(token: string): Promise<CaptureChunkStorageSelection | null> {
		const value = await this.#values.get(selectionKey(token));
		if (value === undefined || value === null) return null;
		return normalizeSelection(value, token);
	}

	async #reference(token: string, index: number): Promise<OpfsCaptureChunkReference | null> {
		const value = await this.#values.get(referenceKey(token, index));
		if (value === undefined || value === null) return null;
		return normalizeReference(value, token, index);
	}
}

function normalizeSelection(value: unknown, token: string): CaptureChunkStorageSelection {
	const record = dataRecord(value, 'encoded capture chunk selector');
	if (record.version !== 1 || record.token !== token
		|| (record.backend !== 'opfs' && record.backend !== 'chunk-fallback')) {
		throw new Error('Encoded capture chunk selector is invalid.');
	}
	return Object.freeze({
		version: 1,
		token,
		sourceId: stableText(record.sourceId, 'encoded capture sourceId', 256),
		backend: record.backend,
	});
}

function normalizeReference(value: unknown, token: string, index: number): OpfsCaptureChunkReference {
	const record = dataRecord(value, `encoded capture OPFS chunk ${String(index)}`);
	if (record.version !== 1 || record.token !== token || record.index !== index) {
		throw new Error('Encoded capture OPFS chunk reference is invalid.');
	}
	return Object.freeze({
		version: 1,
		token,
		sourceId: stableText(record.sourceId, 'encoded capture sourceId', 256),
		index,
		path: stableText(record.path, 'encoded capture OPFS path', 512),
		metadata: Object.freeze(structuredClone(dataRecord(
			record.metadata,
			'encoded capture OPFS chunk metadata',
		))),
	});
}

function selectionKey(token: string): string {
	return `${SELECTION_KEY_PREFIX}${encodeURIComponent(token)}`;
}

function referenceKey(token: string, index: number): string {
	return `${REFERENCE_KEY_PREFIX}${encodeURIComponent(token)}:${String(index).padStart(10, '0')}`;
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a data record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function stableText(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > maximumLength
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}
