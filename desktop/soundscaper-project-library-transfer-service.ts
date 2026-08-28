/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSoundscaperDesktopProjectLibraryHandshake,
	validateSoundscaperDesktopProjectLibraryHandshake,
	type SoundscaperDesktopProjectLibraryHandshake,
} from './soundscaper-project-library-contract.ts';
import {
	sameSoundscaperDesktopProjectLibraryTransferBody,
	validateSoundscaperDesktopProjectLibraryBodyChunk,
	validateSoundscaperDesktopProjectLibraryBodyReadRequest,
	validateSoundscaperDesktopProjectLibraryHostBundle,
	validateSoundscaperDesktopProjectLibraryProjectId,
	type SoundscaperDesktopProjectLibraryBodyReadRequest,
	type SoundscaperDesktopProjectLibraryTransferBody,
	type SoundscaperDesktopProjectLibraryTransferBundle,
} from './soundscaper-project-library-transfer-contract.ts';

const CREATE_FIELDS = ['host'] as const;
const MAXIMUM_ACTIVE_READS = 4;

export interface SoundscaperDesktopProjectLibraryTransferHost {
	readProjectBundle(projectId: string, signal?: AbortSignal): Promise<unknown>;
	readBodyChunk(
		body: Readonly<SoundscaperDesktopProjectLibraryTransferBody>,
		options: Readonly<{ offset: number; length: number; signal?: AbortSignal }>,
	): Promise<unknown>;
}

export interface SoundscaperDesktopProjectLibraryTransferSession {
	readProjectBundle(
		projectId: string,
		signal?: AbortSignal,
	): Promise<Readonly<SoundscaperDesktopProjectLibraryTransferBundle> | null>;
	readBodyChunk(value: unknown): Promise<Uint8Array>;
}

/** Dormant main-owned, pathless, read-only preservation service for desktop baseline. */
export class SoundscaperDesktopProjectLibraryTransferService {
	readonly localHandshake: Readonly<SoundscaperDesktopProjectLibraryHandshake>;
	readonly #hostValue: unknown;

	private constructor(host: unknown) {
		this.#hostValue = host;
		this.localHandshake = createSoundscaperDesktopProjectLibraryHandshake();
	}

	static create(value: unknown): SoundscaperDesktopProjectLibraryTransferService {
		const options = snapshotClosedRecord(value, CREATE_FIELDS, 'Soundscaper desktop baseline transfer service options');
		return Object.freeze(
			new SoundscaperDesktopProjectLibraryTransferService(options.host),
		) as SoundscaperDesktopProjectLibraryTransferService;
	}

	openSession(value: unknown): SoundscaperDesktopProjectLibraryTransferSession {
		validateSoundscaperDesktopProjectLibraryHandshake(value);
		const host = validateHost(this.#hostValue);
		let activeReads = 0;
		const readProjectBundle = async (
			projectIdValue: string,
			signal?: AbortSignal,
		): Promise<Readonly<SoundscaperDesktopProjectLibraryTransferBundle> | null> => {
			throwIfAborted(signal);
			const projectId = validateSoundscaperDesktopProjectLibraryProjectId(projectIdValue);
			const value = await host.readProjectBundle(projectId, signal);
			throwIfAborted(signal);
			return value === null
				? null
				: validateSoundscaperDesktopProjectLibraryHostBundle(value, projectId);
		};
		return Object.freeze({
			readProjectBundle,
			async readBodyChunk(value: unknown): Promise<Uint8Array> {
				const request = validateSoundscaperDesktopProjectLibraryBodyReadRequest(
					value,
					{ allowSignal: true },
				);
				throwIfAborted(request.signal);
				if (activeReads >= MAXIMUM_ACTIVE_READS) {
					throw new RangeError('Soundscaper desktop baseline body read capacity is exhausted');
				}
				activeReads += 1;
				try {
					const current = await readProjectBundle(request.projectId, request.signal);
					if (!current || !sameSnapshot(current, request)) {
						throw new Error('Soundscaper desktop baseline project snapshot changed before body transfer');
					}
					const currentBody = current.bodies.find((candidate) => (
						sameSoundscaperDesktopProjectLibraryTransferBody(candidate, request.body)
					));
					if (!currentBody) {
						throw new Error('Soundscaper desktop baseline body descriptor changed before transfer');
					}
					throwIfAborted(request.signal);
					const bytes = await host.readBodyChunk(currentBody, {
						offset: request.offset,
						length: request.length,
						...(request.signal === undefined ? {} : { signal: request.signal }),
					});
					throwIfAborted(request.signal);
					return validateSoundscaperDesktopProjectLibraryBodyChunk(bytes, request.length);
				} finally {
					activeReads -= 1;
				}
			},
		});
	}
}

function sameSnapshot(
	bundle: Readonly<SoundscaperDesktopProjectLibraryTransferBundle>,
	request: Readonly<SoundscaperDesktopProjectLibraryBodyReadRequest>,
): boolean {
	return bundle.metadataRevision === request.metadataRevision
		&& bundle.project.projectRevision === request.projectRevision
		&& bundle.project.sha256 === request.projectSha256;
}

function validateHost(value: unknown): SoundscaperDesktopProjectLibraryTransferHost {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Soundscaper desktop baseline transfer service requires a main-owned host');
	}
	for (const method of ['readProjectBundle', 'readBodyChunk'] as const) {
		const descriptor = Object.getOwnPropertyDescriptor(value, method)
			?? findPrototypeDescriptor(value, method);
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
			throw new TypeError(`Soundscaper desktop baseline transfer host is missing ${method}`);
		}
	}
	return value as SoundscaperDesktopProjectLibraryTransferHost;
}

function findPrototypeDescriptor(value: object, key: string): PropertyDescriptor | undefined {
	let prototype = Object.getPrototypeOf(value) as object | null;
	while (prototype) {
		const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
		if (descriptor) return descriptor;
		prototype = Object.getPrototypeOf(prototype) as object | null;
	}
	return undefined;
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
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function throwIfAborted(signal?: AbortSignal): void {
	signal?.throwIfAborted();
}
