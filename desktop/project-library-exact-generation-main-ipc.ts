/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperDesktopProjectLibraryExactGenerationMainChannels } from './project-library-exact-generation-main-channels.ts';
import type { FramescaperDesktopProjectLibraryExactGenerationMainSession } from './project-library-exact-generation-main.ts';

const OPTION_FIELDS = ['handle', 'removeHandler', 'ownerFor', 'main'] as const;
type Handler = (event: unknown, value?: unknown) => Promise<unknown> | unknown;

export interface FramescaperDesktopProjectLibraryExactGenerationIpcMain {
	readonly localHandshake: unknown;
	openSession(value: unknown): FramescaperDesktopProjectLibraryExactGenerationMainSession;
}

export interface FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration {
	dispose(): Promise<void>;
	revokeOwner(owner: object): Promise<void>;
}

/** Trusted Electron boundary shared by exact-generation main wrappers. */
export function registerFramescaperDesktopProjectLibraryExactGenerationMainIpc(
	value: unknown,
	configuration: Readonly<{
		label: string;
		channels: Readonly<FramescaperDesktopProjectLibraryExactGenerationMainChannels>;
		isMain: (value: unknown) => value is FramescaperDesktopProjectLibraryExactGenerationIpcMain;
	}>,
): FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration {
	const options = closedRecord(value, OPTION_FIELDS, `${configuration.label} main IPC options`);
	if (typeof options.handle !== 'function' || typeof options.removeHandler !== 'function'
		|| typeof options.ownerFor !== 'function'
		|| !configuration.isMain(options.main)) {
		throw new TypeError(`${configuration.label} main IPC requires exact Electron seams and main owner`);
	}
	const handle = options.handle as (channel: string, handler: Handler) => void;
	const removeHandler = options.removeHandler as (channel: string) => void;
	const ownerFor = options.ownerFor as (event: unknown) => unknown;
	const main = options.main;
	const connections = new Map<object, FramescaperDesktopProjectLibraryExactGenerationMainSession>();
	const refused = new WeakSet<object>();
	const registered: string[] = [];
	let disposed = false;

	const owner = (event: unknown): object => {
		if (disposed) throw new Error(`${configuration.label} main IPC is disposed`);
		return objectReference(ownerFor(event));
	};
	const connection = (event: unknown): FramescaperDesktopProjectLibraryExactGenerationMainSession => {
		const renderer = owner(event);
		const session = connections.get(renderer);
		if (session) return session;
		throw new Error(refused.has(renderer)
			? `${configuration.label} renderer handshake was refused`
			: `${configuration.label} renderer handshake is required before operational IPC`);
	};
	const register = (channel: string, handler: Handler): void => {
		handle(channel, handler);
		registered.push(channel);
	};
	const channels = configuration.channels;
	try {
		register(channels.handshake, (event, handshake) => {
			const renderer = owner(event);
			if (connections.has(renderer) || refused.has(renderer)) {
				throw new Error(`${configuration.label} renderer handshake is already settled`);
			}
			try {
				connections.set(renderer, main.openSession(handshake));
				return main.localHandshake;
			} catch (error) {
				refused.add(renderer);
				throw new TypeError(`${configuration.label} renderer handshake was refused`, { cause: error });
			}
		});
		register(channels.readProjectBundle, (event, projectId) => connection(event).readProjectBundle(projectId as string));
		register(channels.readBodyChunk, (event, request) => connection(event).readBodyChunk(request));
		register(channels.listProjects, (event) => connection(event).listProjects());
		register(channels.deleteProject, (event, request) => connection(event).deleteProject(request));
		register(channels.duplicateProject, (event, request) => connection(event).duplicateProject(request));
		register(channels.beginPublication, (event, request) => connection(event).beginPublication(request));
		register(channels.writePublicationChunk, (event, request) => connection(event).writePublicationChunk(request));
		register(channels.finishPublication, (event, request) => connection(event).finishPublication(request));
		register(channels.abortPublication, (event, request) => connection(event).abortPublication(request));
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
			await closeSessions(sessions, configuration.label);
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
	sessions: readonly FramescaperDesktopProjectLibraryExactGenerationMainSession[],
	label: string,
): Promise<void> {
	const results = await Promise.allSettled(sessions.map((session) => session.close()));
	const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		.map(({ reason }) => reason as unknown);
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, `${label} IPC cleanup failed`);
}

function objectReference(value: unknown): object {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new TypeError('Framescaper exact-generation renderer owner must be an object reference');
	}
	return value;
}

function closedRecord<const Field extends string>(value: unknown, fields: readonly Field[], label: string): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has missing or unsupported fields`);
	}
	return value as Readonly<Record<Field, unknown>>;
}
