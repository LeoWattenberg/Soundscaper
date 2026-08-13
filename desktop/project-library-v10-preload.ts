/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryV10Handshake,
	validateFramescaperDesktopProjectLibraryV10Handshake,
	type FramescaperDesktopProjectLibraryV10Handshake,
} from './project-library-v10-contract.ts';
import {
	FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS,
} from './project-library-v10-ipc.ts';
import {
	validateFramescaperDesktopProjectLibraryV10BodyChunk,
	validateFramescaperDesktopProjectLibraryV10BodyReadRequest,
	validateFramescaperDesktopProjectLibraryV10ProjectId,
	validateFramescaperDesktopProjectLibraryV10TransferBundle,
	type FramescaperDesktopProjectLibraryV10TransferBundle,
} from './project-library-v10-transfer-contract.ts';

const OPTIONS_FIELDS = ['invoke'] as const;

export type FramescaperDesktopProjectLibraryV10PreloadHandshakeState =
	| 'pending'
	| 'admitted'
	| 'refused';

export interface FramescaperDesktopProjectLibraryV10PreloadBridge {
	connect(): Promise<Readonly<FramescaperDesktopProjectLibraryV10Handshake>>;
	handshakeState(): FramescaperDesktopProjectLibraryV10PreloadHandshakeState;
	readProjectBundle(
		projectId: string,
	): Promise<Readonly<FramescaperDesktopProjectLibraryV10TransferBundle> | null>;
	readBodyChunk(value: unknown): Promise<Uint8Array>;
}

/** Create the frozen pathless API that a future Framescaper-only preload exposes. */
export function createFramescaperDesktopProjectLibraryV10PreloadBridge(value: unknown):
	FramescaperDesktopProjectLibraryV10PreloadBridge {
	const options = snapshotClosedRecord(value, OPTIONS_FIELDS, 'Framescaper V10 preload options');
	if (typeof options.invoke !== 'function') {
		throw new TypeError('Framescaper V10 preload requires an IPC invoke seam');
	}
	const invoke = options.invoke as (channel: string, value?: unknown) => Promise<unknown>;
	const local = createFramescaperDesktopProjectLibraryV10Handshake();
	let state: FramescaperDesktopProjectLibraryV10PreloadHandshakeState = 'pending';
	let connection: Promise<Readonly<FramescaperDesktopProjectLibraryV10Handshake>> | null = null;
	const assertOperational = (): void => {
		if (state === 'pending') {
			throw new Error('Framescaper V10 preload handshake is required before operational IPC');
		}
		if (state === 'refused') throw new Error('Framescaper V10 preload handshake was refused');
	};
	return Object.freeze({
		async connect(): Promise<Readonly<FramescaperDesktopProjectLibraryV10Handshake>> {
			if (state === 'admitted') return local;
			if (state === 'refused') throw new Error('Framescaper V10 preload handshake was refused');
			if (connection) return connection;
			connection = invoke(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.handshake, local)
				.then((remote) => {
					try {
						const admitted = validateFramescaperDesktopProjectLibraryV10Handshake(remote);
						state = 'admitted';
						return admitted;
					} catch (error) {
						state = 'refused';
						throw new TypeError('Framescaper V10 preload handshake was refused', { cause: error });
					}
				}, (error: unknown) => {
					state = 'refused';
					throw new TypeError('Framescaper V10 preload handshake was refused', { cause: error });
				});
			return connection;
		},
		handshakeState: () => state,
		async readProjectBundle(projectIdValue: string) {
			assertOperational();
			const projectId = validateFramescaperDesktopProjectLibraryV10ProjectId(projectIdValue);
			const result = await invoke(
				FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.readProjectBundle,
				projectId,
			);
			return result === null
				? null
				: validateFramescaperDesktopProjectLibraryV10TransferBundle(result, projectId);
		},
		async readBodyChunk(value: unknown): Promise<Uint8Array> {
			assertOperational();
			const request = validateFramescaperDesktopProjectLibraryV10BodyReadRequest(value);
			const result = await invoke(
				FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.readBodyChunk,
				request,
			);
			return validateFramescaperDesktopProjectLibraryV10BodyChunk(result, request.length);
		},
	});
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
