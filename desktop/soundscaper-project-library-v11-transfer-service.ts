/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSoundscaperDesktopProjectLibraryV11Handshake,
	validateSoundscaperDesktopProjectLibraryV11Handshake,
	type SoundscaperDesktopProjectLibraryV11Handshake,
} from './soundscaper-project-library-v11-contract.ts';
import {
	sameSoundscaperDesktopProjectLibraryV11TransferBody,
	validateSoundscaperDesktopProjectLibraryV11BodyChunk,
	validateSoundscaperDesktopProjectLibraryV11BodyReadRequest,
	validateSoundscaperDesktopProjectLibraryV11HostBundle,
	validateSoundscaperDesktopProjectLibraryV11ProjectId,
	type SoundscaperDesktopProjectLibraryV11BodyReadRequest,
	type SoundscaperDesktopProjectLibraryV11TransferBody,
	type SoundscaperDesktopProjectLibraryV11TransferBundle,
} from './soundscaper-project-library-v11-transfer-contract.ts';

const CREATE_FIELDS = ['host'] as const;
const MAXIMUM_ACTIVE_READS = 4;

export interface SoundscaperDesktopProjectLibraryV11TransferHost {
	readProjectBundle(projectId: string, signal?: AbortSignal): Promise<unknown>;
	readBodyChunk(
		body: Readonly<SoundscaperDesktopProjectLibraryV11TransferBody>,
		options: Readonly<{ offset: number; length: number; signal?: AbortSignal }>,
	): Promise<unknown>;
}

export interface SoundscaperDesktopProjectLibraryV11TransferSession {
	readProjectBundle(
		projectId: string,
		signal?: AbortSignal,
	): Promise<Readonly<SoundscaperDesktopProjectLibraryV11TransferBundle> | null>;
	readBodyChunk(value: unknown): Promise<Uint8Array>;
}

/** Dormant main-owned, pathless, read-only preservation service for desktop V11. */
export class SoundscaperDesktopProjectLibraryV11TransferService {
	readonly localHandshake: Readonly<SoundscaperDesktopProjectLibraryV11Handshake>;
	readonly #hostValue: unknown;

	private constructor(host: unknown) {
		this.#hostValue = host;
		this.localHandshake = createSoundscaperDesktopProjectLibraryV11Handshake();
	}

	static create(value: unknown): SoundscaperDesktopProjectLibraryV11TransferService {
		const options = snapshotClosedRecord(value, CREATE_FIELDS, 'Soundscaper V11 transfer service options');
		return Object.freeze(
			new SoundscaperDesktopProjectLibraryV11TransferService(options.host),
		) as SoundscaperDesktopProjectLibraryV11TransferService;
	}

	openSession(value: unknown): SoundscaperDesktopProjectLibraryV11TransferSession {
		validateSoundscaperDesktopProjectLibraryV11Handshake(value);
		const host = validateHost(this.#hostValue);
		let activeReads = 0;
		const readProjectBundle = async (
			projectIdValue: string,
			signal?: AbortSignal,
		): Promise<Readonly<SoundscaperDesktopProjectLibraryV11TransferBundle> | null> => {
			throwIfAborted(signal);
			const projectId = validateSoundscaperDesktopProjectLibraryV11ProjectId(projectIdValue);
			const value = await host.readProjectBundle(projectId, signal);
			throwIfAborted(signal);
			return value === null
				? null
				: validateSoundscaperDesktopProjectLibraryV11HostBundle(value, projectId);
		};
		return Object.freeze({
			readProjectBundle,
			async readBodyChunk(value: unknown): Promise<Uint8Array> {
				const request = validateSoundscaperDesktopProjectLibraryV11BodyReadRequest(
					value,
					{ allowSignal: true },
				);
				throwIfAborted(request.signal);
				if (activeReads >= MAXIMUM_ACTIVE_READS) {
					throw new RangeError('Soundscaper V11 body read capacity is exhausted');
				}
				activeReads += 1;
				try {
					const current = await readProjectBundle(request.projectId, request.signal);
					if (!current || !sameSnapshot(current, request)) {
						throw new Error('Soundscaper V11 project snapshot changed before body transfer');
					}
					const currentBody = current.bodies.find((candidate) => (
						sameSoundscaperDesktopProjectLibraryV11TransferBody(candidate, request.body)
					));
					if (!currentBody) {
						throw new Error('Soundscaper V11 body descriptor changed before transfer');
					}
					throwIfAborted(request.signal);
					const bytes = await host.readBodyChunk(currentBody, {
						offset: request.offset,
						length: request.length,
						...(request.signal === undefined ? {} : { signal: request.signal }),
					});
					throwIfAborted(request.signal);
					return validateSoundscaperDesktopProjectLibraryV11BodyChunk(bytes, request.length);
				} finally {
					activeReads -= 1;
				}
			},
		});
	}
}

function sameSnapshot(
	bundle: Readonly<SoundscaperDesktopProjectLibraryV11TransferBundle>,
	request: Readonly<SoundscaperDesktopProjectLibraryV11BodyReadRequest>,
): boolean {
	return bundle.metadataRevision === request.metadataRevision
		&& bundle.project.projectRevision === request.projectRevision
		&& bundle.project.sha256 === request.projectSha256;
}

function validateHost(value: unknown): SoundscaperDesktopProjectLibraryV11TransferHost {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Soundscaper V11 transfer service requires a main-owned host');
	}
	for (const method of ['readProjectBundle', 'readBodyChunk'] as const) {
		const descriptor = Object.getOwnPropertyDescriptor(value, method)
			?? findPrototypeDescriptor(value, method);
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
			throw new TypeError(`Soundscaper V11 transfer host is missing ${method}`);
		}
	}
	return value as SoundscaperDesktopProjectLibraryV11TransferHost;
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
