/* SPDX-License-Identifier: AGPL-3.0-only */

import { statfs } from 'node:fs/promises';

import {
	MAX_LIBRARY_MEDIA,
	MAX_LIBRARY_METADATA_BYTES,
	type DesktopLibraryMedia,
	type DesktopLibraryMetadata,
	validateDesktopLibraryMetadata,
} from './project-library-contract.ts';

export const MAXIMUM_DESKTOP_LIBRARY_MANAGED_MEDIA_ADMITTED_BYTES = 64 * 1024 * 1024 * 1024;

export type DesktopLibraryMediaStatfs = (
	path: string,
	options: Readonly<{ bigint: true }>,
) => PromiseLike<unknown> | unknown;

export interface DesktopLibraryMediaCapacityOptions {
	readonly managedMediaRoot: string;
	readonly maximumAdmittedBytes?: number;
	readonly maximumMediaRows?: number;
	readonly maximumMetadataBytes?: number;
	readonly statfsImpl?: DesktopLibraryMediaStatfs;
}

export interface DesktopLibraryMediaCapacityReservation {
	release(): boolean;
}

interface ActiveReservation {
	readonly descriptor: DesktopLibraryMedia;
	released: boolean;
}

/** Point-in-time capacity admission for one absent managed-media catalog binding. */
export class DesktopLibraryMediaCapacity {
	readonly #active = new Set<ActiveReservation>();
	readonly #managedMediaRoot: string;
	readonly #maximumAdmittedBytes: number;
	readonly #maximumMediaRows: number;
	readonly #maximumMetadataBytes: number;
	readonly #statfs: DesktopLibraryMediaStatfs;
	#reservedBytes = 0;

	constructor(options: DesktopLibraryMediaCapacityOptions) {
		if (typeof options.managedMediaRoot !== 'string' || !options.managedMediaRoot) {
			throw new TypeError('Desktop library managed-media capacity requires its destination root');
		}
		this.#managedMediaRoot = options.managedMediaRoot;
		this.#maximumAdmittedBytes = lowerOnlyLimit(
			options.maximumAdmittedBytes,
			MAXIMUM_DESKTOP_LIBRARY_MANAGED_MEDIA_ADMITTED_BYTES,
			'managed-media aggregate admitted bytes',
		);
		this.#maximumMediaRows = lowerOnlyLimit(
			options.maximumMediaRows,
			MAX_LIBRARY_MEDIA,
			'managed-media catalog rows',
		);
		this.#maximumMetadataBytes = lowerOnlyLimit(
			options.maximumMetadataBytes,
			MAX_LIBRARY_METADATA_BYTES,
			'managed-media metadata bytes',
		);
		this.#statfs = options.statfsImpl ?? statfs;
	}

	async reserve(
		metadata: DesktopLibraryMetadata,
		descriptor: DesktopLibraryMedia,
		signal?: AbortSignal,
	): Promise<DesktopLibraryMediaCapacityReservation> {
		signal?.throwIfAborted();
		const state = this.#reserveProspective(metadata, descriptor);
		const reservation = Object.freeze({ release: () => this.#release(state) });
		try {
			let details: unknown;
			try {
				details = await this.#statfs(this.#managedMediaRoot, { bigint: true });
			} catch (error) {
				throw new Error('Could not inspect filesystem capacity for managed media', { cause: error });
			}
			signal?.throwIfAborted();
			let availableBytes: bigint;
			try {
				availableBytes = availableStorageBytes(details);
			} catch (error) {
				throw new Error('Managed-media filesystem capacity information is invalid', { cause: error });
			}
			if (availableBytes < BigInt(this.#reservedBytes)) {
				throw new RangeError('Available disk space is below the aggregate admitted managed-media capacity');
			}
			return reservation;
		} catch (error) {
			reservation.release();
			throw error;
		}
	}

	candidateForPublication(
		metadata: DesktopLibraryMetadata,
		descriptor: DesktopLibraryMedia,
	): DesktopLibraryMetadata {
		const media = [...metadata.media, descriptor];
		const revision = this.#assertCatalogCapacity(metadata, media);
		return validateDesktopLibraryMetadata({
			schemaVersion: metadata.schemaVersion,
			revision,
			projects: metadata.projects,
			media,
		});
	}

	#reserveProspective(
		metadata: DesktopLibraryMetadata,
		descriptor: DesktopLibraryMedia,
	): ActiveReservation {
		const mediaById = new Map(metadata.media.map((entry) => [entry.id, entry]));
		for (const active of this.#active) {
			if (!mediaById.has(active.descriptor.id)) mediaById.set(active.descriptor.id, active.descriptor);
		}
		if (mediaById.has(descriptor.id)) {
			throw new Error('Managed-media capacity admission requires an absent catalog binding');
		}
		mediaById.set(descriptor.id, descriptor);
		const media = [...mediaById.values()];
		this.#assertCatalogCapacity(metadata, media);
		if (descriptor.byteLength > this.#maximumAdmittedBytes - this.#reservedBytes) {
			throw new RangeError('Aggregate admitted managed-media bytes exceed their lower-only limit');
		}
		const state: ActiveReservation = { descriptor, released: false };
		this.#active.add(state);
		this.#reservedBytes += descriptor.byteLength;
		return state;
	}

	#assertCatalogCapacity(
		metadata: DesktopLibraryMetadata,
		media: readonly DesktopLibraryMedia[],
	): number {
		if (media.length > this.#maximumMediaRows) {
			throw new RangeError('Desktop library catalog has reached its managed-media row capacity');
		}
		const addedRows = media.length - metadata.media.length;
		const revision = metadata.revision + addedRows;
		if (!Number.isSafeInteger(revision)) {
			throw new RangeError('Desktop library prospective metadata revision is invalid');
		}
		const metadataBytes = Buffer.byteLength(JSON.stringify({
			schemaVersion: metadata.schemaVersion,
			revision,
			projects: metadata.projects,
			media,
		}), 'utf8');
		if (metadataBytes > this.#maximumMetadataBytes) {
			throw new RangeError('Desktop library prospective managed-media metadata exceeds its byte capacity');
		}
		return revision;
	}

	#release(state: ActiveReservation): boolean {
		if (state.released) return false;
		state.released = true;
		if (!this.#active.delete(state)) return false;
		this.#reservedBytes -= state.descriptor.byteLength;
		return true;
	}
}

function lowerOnlyLimit(value: unknown, hardMaximum: number, label: string): number {
	const limit = value === undefined ? hardMaximum : value;
	if (!Number.isSafeInteger(limit) || Number(limit) < 0 || Number(limit) > hardMaximum) {
		throw new RangeError(`Desktop library ${label} must be a lower-only safe integer no greater than ${hardMaximum}`);
	}
	return Number(limit);
}

function availableStorageBytes(details: unknown): bigint {
	if (!details || typeof details !== 'object') {
		throw new TypeError('Expected filesystem capacity details');
	}
	const record = details as Readonly<Record<string, unknown>>;
	if (typeof record.bavail !== 'bigint' || record.bavail < 0n
		|| typeof record.bsize !== 'bigint' || record.bsize <= 0n) {
		throw new TypeError('Expected non-negative bigint bavail and positive bigint bsize values');
	}
	return record.bavail * record.bsize;
}
