/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	SoundscaperDesktopProjectLibraryMain,
} from './soundscaper-project-library-main.ts';
import {
	SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS,
} from './soundscaper-project-library-main-channels.ts';
import type {
	SoundscaperDesktopProjectLibraryMainSession,
} from './soundscaper-project-library-main-session.ts';

export { SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS } from './soundscaper-project-library-main-channels.ts';

const OPTION_FIELDS = ['handle', 'removeHandler', 'ownerFor', 'main'] as const;

type Handler = (event: unknown, value?: unknown) => Promise<unknown> | unknown;

export interface SoundscaperDesktopProjectLibraryMainIpcRegistration {
	dispose(): Promise<void>;
	revokeOwner(owner: object): Promise<void>;
}

/** Trusted Electron boundary for one product-owned baseline main instance. */
export function registerSoundscaperDesktopProjectLibraryMainIpc(
	value: unknown,
): SoundscaperDesktopProjectLibraryMainIpcRegistration {
	const options = snapshotClosedRecord(value, OPTION_FIELDS, 'Soundscaper desktop baseline main IPC options');
	if (typeof options.handle !== 'function' || typeof options.removeHandler !== 'function'
		|| typeof options.ownerFor !== 'function'
		|| !(options.main instanceof SoundscaperDesktopProjectLibraryMain)) {
		throw new TypeError('Soundscaper desktop baseline main IPC requires exact Electron seams and main owner');
	}
	const handle = options.handle as (channel: string, handler: Handler) => void;
	const removeHandler = options.removeHandler as (channel: string) => void;
	const ownerFor = options.ownerFor as (event: unknown) => unknown;
	const main = options.main;
	const connections = new Map<object, SoundscaperDesktopProjectLibraryMainSession>();
	const refused = new WeakSet<object>();
	const registered: string[] = [];
	let disposed = false;

	const owner = (event: unknown): object => {
		if (disposed) throw new Error('Soundscaper desktop baseline main IPC is disposed');
		return objectReference(ownerFor(event));
	};
	const connection = (event: unknown): SoundscaperDesktopProjectLibraryMainSession => {
		const renderer = owner(event);
		const session = connections.get(renderer);
		if (session) return session;
		throw new Error(refused.has(renderer)
			? 'Soundscaper desktop baseline renderer handshake was refused'
			: 'Soundscaper desktop baseline renderer handshake is required before operational IPC');
	};
	const register = (channel: string, handler: Handler): void => {
		handle(channel, handler);
		registered.push(channel);
	};

	try {
		register(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.handshake, (event, handshake) => {
			const renderer = owner(event);
			if (connections.has(renderer) || refused.has(renderer)) {
				throw new Error('Soundscaper desktop baseline renderer handshake is already settled');
			}
			try {
				connections.set(renderer, main.openSession(handshake));
				return main.localHandshake;
			} catch (error) {
				refused.add(renderer);
				throw new TypeError('Soundscaper desktop baseline renderer handshake was refused', { cause: error });
			}
		});
		register(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.readProjectBundle,
			(event, projectId) => connection(event).readProjectBundle(projectId as string));
		register(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.readBodyChunk,
			(event, request) => connection(event).readBodyChunk(request));
		register(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.listProjects,
			(event) => connection(event).listProjects());
		register(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.deleteProject,
			(event, request) => connection(event).deleteProject(request));
		register(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.duplicateProject,
			(event, request) => connection(event).duplicateProject(request));
		register(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.beginPublication,
			(event, request) => connection(event).beginPublication(request));
		register(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.writePublicationChunk,
			(event, request) => connection(event).writePublicationChunk(request));
		register(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.finishPublication,
			(event, request) => connection(event).finishPublication(request));
		register(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.abortPublication,
			(event, request) => connection(event).abortPublication(request));
		register(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.persistNativePluginState,
			(event, bytes) => {
				connection(event);
				return main.persistNativePluginState(bytes);
			});
		register(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.readNativePluginState,
			(event, bodyId) => {
				connection(event);
				return main.readNativePluginState(bodyId);
			});
	} catch (error) {
		for (const channel of registered.reverse()) removeHandler(channel);
		throw error;
	}

	return Object.freeze({
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			for (const channel of registered.splice(0).reverse()) removeHandler(channel);
			const sessions = [...connections.values()];
			connections.clear();
			await closeSessions(sessions);
		},
		async revokeOwner(renderer: object): Promise<void> {
			const target = objectReference(renderer);
			const session = connections.get(target);
			if (!session) return;
			connections.delete(target);
			refused.add(target);
			await session.close();
		},
	});
}

async function closeSessions(
	sessions: readonly SoundscaperDesktopProjectLibraryMainSession[],
): Promise<void> {
	const results = await Promise.allSettled(sessions.map((session) => session.close()));
	const failures = results
		.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		.map(({ reason }) => reason as unknown);
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Soundscaper desktop baseline IPC cleanup failed');
}

function objectReference(value: unknown): object {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new TypeError('Soundscaper desktop baseline renderer owner must be an object reference');
	}
	return value;
}

function snapshotClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
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
