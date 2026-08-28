/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	SoundscaperDesktopProjectLibraryTransferService,
	SoundscaperDesktopProjectLibraryTransferSession,
} from './soundscaper-project-library-transfer-service.ts';

export const SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_CHANNELS = Object.freeze({
	handshake: 'soundscaper:v1:project-library:handshake',
	readProjectBundle: 'soundscaper:v1:project-library:projects:bundle',
	readBodyChunk: 'soundscaper:v1:project-library:bodies:read',
} as const);

const OPTIONS_FIELDS = ['handle', 'ownerFor', 'service'] as const;

type Handler = (event: unknown, value?: unknown) => Promise<unknown> | unknown;

interface Connection {
	readonly controller: AbortController;
	readonly session: SoundscaperDesktopProjectLibraryTransferSession;
}

export interface SoundscaperDesktopProjectLibraryIpcRegistration {
	dispose(): Promise<void>;
	revokeOwner(owner: object): Promise<void>;
}

/** Register only the read-only preservation surface; publication remains hard-stopped. */
export function registerSoundscaperDesktopProjectLibraryIpc(value: unknown):
	SoundscaperDesktopProjectLibraryIpcRegistration {
	const options = snapshotClosedRecord(value, OPTIONS_FIELDS, 'Soundscaper desktop baseline IPC options');
	if (typeof options.handle !== 'function' || typeof options.ownerFor !== 'function'
		|| !options.service || typeof options.service !== 'object') {
		throw new TypeError('Soundscaper desktop baseline IPC requires handler, owner, and service seams');
	}
	const handle = options.handle as (channel: string, handler: Handler) => void;
	const ownerFor = options.ownerFor as (event: unknown) => unknown;
	const service = options.service as SoundscaperDesktopProjectLibraryTransferService;
	if (typeof service.openSession !== 'function') {
		throw new TypeError('Soundscaper desktop baseline IPC requires a transfer service');
	}
	const connections = new Map<object, Connection>();
	const refused = new WeakSet<object>();
	let disposed = false;

	const owner = (event: unknown): object => {
		if (disposed) throw new Error('Soundscaper desktop baseline IPC is disposed');
		const result = ownerFor(event);
		if (!result || (typeof result !== 'object' && typeof result !== 'function')) {
			throw new TypeError('Soundscaper desktop baseline renderer owner is invalid');
		}
		return result;
	};
	const connection = (event: unknown): Connection => {
		const renderer = owner(event);
		const admitted = connections.get(renderer);
		if (!admitted) {
			throw new Error(refused.has(renderer)
				? 'Soundscaper desktop baseline renderer handshake was refused'
				: 'Soundscaper desktop baseline renderer handshake is required before operational IPC');
		}
		return admitted;
	};

	handle(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_CHANNELS.handshake, (event, handshake) => {
		const renderer = owner(event);
		if (connections.has(renderer) || refused.has(renderer)) {
			throw new Error('Soundscaper desktop baseline renderer handshake is already settled');
		}
		try {
			const session = service.openSession(handshake);
			connections.set(renderer, { controller: new AbortController(), session });
			return service.localHandshake;
		} catch (error) {
			refused.add(renderer);
			throw new TypeError('Soundscaper desktop baseline renderer handshake was refused', { cause: error });
		}
	});
	handle(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_CHANNELS.readProjectBundle,
		(event, projectId) => {
			const admitted = connection(event);
			return admitted.session.readProjectBundle(projectId as string, admitted.controller.signal);
		});
	handle(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_CHANNELS.readBodyChunk,
		(event, request) => {
			const admitted = connection(event);
			return admitted.session.readBodyChunk(withSignal(request, admitted.controller.signal));
		});

	return Object.freeze({
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			for (const { controller } of connections.values()) {
				controller.abort(new Error('Soundscaper desktop baseline IPC was disposed'));
			}
			connections.clear();
		},
		async revokeOwner(renderer: object): Promise<void> {
			const admitted = connections.get(renderer);
			if (!admitted) return;
			connections.delete(renderer);
			refused.add(renderer);
			admitted.controller.abort(new Error('Soundscaper desktop baseline renderer owner was revoked'));
		},
	});
}

function withSignal(value: unknown, signal: AbortSignal): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Soundscaper desktop baseline body read must be a plain record');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Soundscaper desktop baseline body read must be a plain record');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.includes('signal') || keys.some((key) => typeof key !== 'string')) {
		throw new TypeError('Soundscaper desktop baseline body read has unsupported fields');
	}
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Soundscaper desktop baseline body read.${String(key)} must be a data property`);
		}
		Object.defineProperty(result, String(key), {
			value: descriptor.value,
			enumerable: true,
			writable: true,
			configurable: true,
		});
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
