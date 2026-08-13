/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryV10Handshake,
	validateFramescaperDesktopProjectLibraryV10Handshake,
	type FramescaperDesktopProjectLibraryV10Handshake,
} from './project-library-v10-contract.ts';
import {
	sameFramescaperDesktopProjectLibraryV10TransferBody,
	validateFramescaperDesktopProjectLibraryV10BodyChunk,
	validateFramescaperDesktopProjectLibraryV10BodyReadRequest,
	validateFramescaperDesktopProjectLibraryV10HostBundle,
	validateFramescaperDesktopProjectLibraryV10ProjectId,
	type FramescaperDesktopProjectLibraryV10BodyReadRequest,
	type FramescaperDesktopProjectLibraryV10TransferBody,
	type FramescaperDesktopProjectLibraryV10TransferBundle,
} from './project-library-v10-transfer-contract.ts';

const CREATE_FIELDS = ['host'] as const;
const MAXIMUM_ACTIVE_READS = 4;

export interface FramescaperDesktopProjectLibraryV10TransferHost {
	readProjectBundle(projectId: string, signal?: AbortSignal): Promise<unknown>;
	readBodyChunk(
		body: Readonly<FramescaperDesktopProjectLibraryV10TransferBody>,
		options: Readonly<{ offset: number; length: number; signal?: AbortSignal }>,
	): Promise<unknown>;
}

export interface FramescaperDesktopProjectLibraryV10TransferSession {
	readProjectBundle(
		projectId: string,
		signal?: AbortSignal,
	): Promise<Readonly<FramescaperDesktopProjectLibraryV10TransferBundle> | null>;
	readBodyChunk(value: unknown): Promise<Uint8Array>;
}

/** Dormant main-owned, pathless, read-only preservation service for desktop V10. */
export class FramescaperDesktopProjectLibraryV10TransferService {
	readonly localHandshake: Readonly<FramescaperDesktopProjectLibraryV10Handshake>;
	readonly #hostValue: unknown;

	private constructor(host: unknown) {
		this.#hostValue = host;
		this.localHandshake = createFramescaperDesktopProjectLibraryV10Handshake();
	}

	static create(value: unknown): FramescaperDesktopProjectLibraryV10TransferService {
		const options = snapshotClosedRecord(value, CREATE_FIELDS, 'Framescaper V10 transfer service options');
		return Object.freeze(
			new FramescaperDesktopProjectLibraryV10TransferService(options.host),
		) as FramescaperDesktopProjectLibraryV10TransferService;
	}

	openSession(value: unknown): FramescaperDesktopProjectLibraryV10TransferSession {
		validateFramescaperDesktopProjectLibraryV10Handshake(value);
		const host = validateHost(this.#hostValue);
		let activeReads = 0;
		const readProjectBundle = async (
			projectIdValue: string,
			signal?: AbortSignal,
		): Promise<Readonly<FramescaperDesktopProjectLibraryV10TransferBundle> | null> => {
			throwIfAborted(signal);
			const projectId = validateFramescaperDesktopProjectLibraryV10ProjectId(projectIdValue);
			const value = await host.readProjectBundle(projectId, signal);
			throwIfAborted(signal);
			return value === null
				? null
				: validateFramescaperDesktopProjectLibraryV10HostBundle(value, projectId);
		};
		return Object.freeze({
			readProjectBundle,
			async readBodyChunk(value: unknown): Promise<Uint8Array> {
				const request = validateFramescaperDesktopProjectLibraryV10BodyReadRequest(
					value,
					{ allowSignal: true },
				);
				throwIfAborted(request.signal);
				if (activeReads >= MAXIMUM_ACTIVE_READS) {
					throw new RangeError('Framescaper V10 body read capacity is exhausted');
				}
				activeReads += 1;
				try {
					const current = await readProjectBundle(request.projectId, request.signal);
					if (!current || !sameSnapshot(current, request)) {
						throw new Error('Framescaper V10 project snapshot changed before body transfer');
					}
					const currentBody = current.bodies.find((candidate) => (
						sameFramescaperDesktopProjectLibraryV10TransferBody(candidate, request.body)
					));
					if (!currentBody) {
						throw new Error('Framescaper V10 body descriptor changed before transfer');
					}
					throwIfAborted(request.signal);
					const bytes = await host.readBodyChunk(currentBody, {
						offset: request.offset,
						length: request.length,
						...(request.signal === undefined ? {} : { signal: request.signal }),
					});
					throwIfAborted(request.signal);
					return validateFramescaperDesktopProjectLibraryV10BodyChunk(bytes, request.length);
				} finally {
					activeReads -= 1;
				}
			},
		});
	}
}

function sameSnapshot(
	bundle: Readonly<FramescaperDesktopProjectLibraryV10TransferBundle>,
	request: Readonly<FramescaperDesktopProjectLibraryV10BodyReadRequest>,
): boolean {
	return bundle.metadataRevision === request.metadataRevision
		&& bundle.project.projectRevision === request.projectRevision
		&& bundle.project.sha256 === request.projectSha256;
}

function validateHost(value: unknown): FramescaperDesktopProjectLibraryV10TransferHost {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Framescaper V10 transfer service requires a main-owned host');
	}
	for (const method of ['readProjectBundle', 'readBodyChunk'] as const) {
		const descriptor = Object.getOwnPropertyDescriptor(value, method)
			?? findPrototypeDescriptor(value, method);
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
			throw new TypeError(`Framescaper V10 transfer host is missing ${method}`);
		}
	}
	return value as FramescaperDesktopProjectLibraryV10TransferHost;
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
