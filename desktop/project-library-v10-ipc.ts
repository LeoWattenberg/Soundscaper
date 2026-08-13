/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperDesktopProjectLibraryV10TransferService,
	FramescaperDesktopProjectLibraryV10TransferSession,
} from './project-library-v10-transfer-service.ts';

export const FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS = Object.freeze({
	handshake: 'framescaper:v10:projects:handshake',
	readProjectBundle: 'framescaper:v10:projects:bundle',
	readBodyChunk: 'framescaper:v10:projects:bodies:read',
} as const);

const OPTIONS_FIELDS = ['handle', 'ownerFor', 'service'] as const;

type Handler = (event: unknown, value?: unknown) => Promise<unknown> | unknown;

interface Connection {
	readonly controller: AbortController;
	readonly session: FramescaperDesktopProjectLibraryV10TransferSession;
}

export interface FramescaperDesktopProjectLibraryV10IpcRegistration {
	dispose(): Promise<void>;
	revokeOwner(owner: object): Promise<void>;
}

/** Register only the read-only preservation surface; publication remains hard-stopped. */
export function registerFramescaperDesktopProjectLibraryV10Ipc(value: unknown):
	FramescaperDesktopProjectLibraryV10IpcRegistration {
	const options = snapshotClosedRecord(value, OPTIONS_FIELDS, 'Framescaper V10 IPC options');
	if (typeof options.handle !== 'function' || typeof options.ownerFor !== 'function'
		|| !options.service || typeof options.service !== 'object') {
		throw new TypeError('Framescaper V10 IPC requires handler, owner, and service seams');
	}
	const handle = options.handle as (channel: string, handler: Handler) => void;
	const ownerFor = options.ownerFor as (event: unknown) => unknown;
	const service = options.service as FramescaperDesktopProjectLibraryV10TransferService;
	if (typeof service.openSession !== 'function') {
		throw new TypeError('Framescaper V10 IPC requires a transfer service');
	}
	const connections = new Map<object, Connection>();
	const refused = new WeakSet<object>();
	let disposed = false;

	const owner = (event: unknown): object => {
		if (disposed) throw new Error('Framescaper V10 IPC is disposed');
		const result = ownerFor(event);
		if (!result || (typeof result !== 'object' && typeof result !== 'function')) {
			throw new TypeError('Framescaper V10 renderer owner is invalid');
		}
		return result;
	};
	const connection = (event: unknown): Connection => {
		const renderer = owner(event);
		const admitted = connections.get(renderer);
		if (!admitted) {
			throw new Error(refused.has(renderer)
				? 'Framescaper V10 renderer handshake was refused'
				: 'Framescaper V10 renderer handshake is required before operational IPC');
		}
		return admitted;
	};

	handle(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.handshake, (event, handshake) => {
		const renderer = owner(event);
		if (connections.has(renderer) || refused.has(renderer)) {
			throw new Error('Framescaper V10 renderer handshake is already settled');
		}
		try {
			const session = service.openSession(handshake);
			connections.set(renderer, { controller: new AbortController(), session });
			return service.localHandshake;
		} catch (error) {
			refused.add(renderer);
			throw new TypeError('Framescaper V10 renderer handshake was refused', { cause: error });
		}
	});
	handle(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.readProjectBundle,
		(event, projectId) => {
			const admitted = connection(event);
			return admitted.session.readProjectBundle(projectId as string, admitted.controller.signal);
		});
	handle(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS.readBodyChunk,
		(event, request) => {
			const admitted = connection(event);
			return admitted.session.readBodyChunk(withSignal(request, admitted.controller.signal));
		});

	return Object.freeze({
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			for (const { controller } of connections.values()) {
				controller.abort(new Error('Framescaper V10 IPC was disposed'));
			}
			connections.clear();
		},
		async revokeOwner(renderer: object): Promise<void> {
			const admitted = connections.get(renderer);
			if (!admitted) return;
			connections.delete(renderer);
			refused.add(renderer);
			admitted.controller.abort(new Error('Framescaper V10 renderer owner was revoked'));
		},
	});
}

function withSignal(value: unknown, signal: AbortSignal): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper V10 body read must be a plain record');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Framescaper V10 body read must be a plain record');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.includes('signal') || keys.some((key) => typeof key !== 'string')) {
		throw new TypeError('Framescaper V10 body read has unsupported fields');
	}
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Framescaper V10 body read.${String(key)} must be a data property`);
		}
		result[String(key)] = descriptor.value;
	}
	result.signal = signal;
	return result;
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
