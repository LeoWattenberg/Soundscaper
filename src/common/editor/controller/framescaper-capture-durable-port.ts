/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperCaptureDurableSession as CoordinatorSession,
	FramescaperCaptureDurableSessionCoordinator,
	FramescaperCaptureRecoveryInventoryEntry,
} from './framescaper-capture-durable-session.ts';
import type {
	FramescaperCaptureDurablePort,
	FramescaperCaptureDurableSession,
} from './framescaper-capture-session-types.ts';

export interface FramescaperCaptureDurablePortBinding {
	readonly port: FramescaperCaptureDurablePort;
	coordinatorSession(session: FramescaperCaptureDurableSession): CoordinatorSession;
	refresh(session: FramescaperCaptureDurableSession): Promise<CoordinatorSession>;
}

interface FramescaperCaptureDurablePortOptions {
	readonly coordinator: FramescaperCaptureDurableSessionCoordinator;
	readonly createId: (prefix: string) => string;
}

/** Adapts the manifest coordinator to the whole-session orchestration port. */
export function createFramescaperCaptureDurablePortBinding(
	options: FramescaperCaptureDurablePortOptions,
): Readonly<FramescaperCaptureDurablePortBinding> {
	if (!options || typeof options.coordinator !== 'object'
		|| typeof options.createId !== 'function') {
		throw new TypeError('Framescaper capture durable-port dependencies are invalid.');
	}
	const owned = new WeakMap<FramescaperCaptureDurableSession, CoordinatorSession>();

	function wrap(session: CoordinatorSession): FramescaperCaptureDurableSession {
		const { manifest } = session;
		const value: FramescaperCaptureDurableSession = Object.freeze({
			sessionId: manifest.sessionId,
			sources: Object.freeze(manifest.streams.map(({ streamId, role, storage }) => Object.freeze({
				streamId, role, sourceId: storage.sourceId,
			}))),
			destination: manifest.origin.destination,
			projectFence: manifest.projectFence,
			origin: manifest.origin,
		});
		owned.set(value, session);
		return value;
	}

	function coordinatorSession(session: FramescaperCaptureDurableSession): CoordinatorSession {
		const value = owned.get(session);
		if (!value) throw new Error('Framescaper capture durable-session ownership is invalid.');
		return value;
	}

	async function refresh(session: FramescaperCaptureDurableSession): Promise<CoordinatorSession> {
		coordinatorSession(session);
		const loaded = await options.coordinator.load(session.projectFence.projectId, session.sessionId);
		if (!loaded) throw new Error('Framescaper capture durable session disappeared during refresh.');
		assertWrappedIdentity(session, loaded);
		owned.set(session, loaded);
		return loaded;
	}

	const port: FramescaperCaptureDurablePort = {
		async prepare(request) {
			const streams = request.streams.map((stream) => {
				const common = {
					streamId: stream.streamId,
					spoolId: options.createId(`${stream.role}-capture-spool`),
					sourceId: stream.sourceId,
					required: stream.required,
					role: stream.role,
				};
				return stream.format.kind === 'encoded-media'
					? Object.freeze({
						...common,
						kind: 'encoded-media' as const,
						role: videoRole(stream.role),
						mimeType: stream.format.mimeType,
					})
					: Object.freeze({
						...common,
						kind: 'raw-pcm' as const,
						role: audioRole(stream.role),
						sampleRate: stream.format.sampleRate,
						channelCount: stream.format.channelCount,
						chunkFrames: stream.format.chunkFrames,
					});
			});
			return wrap(await options.coordinator.create({
				sessionId: request.sessionId,
				generation: request.generation,
				projectFence: request.projectFence,
				origin: request.origin,
				monotonicOriginMicroseconds: request.monotonicOriginMicroseconds,
				streams: Object.freeze(streams),
			}));
		},
		async append(session, packet) {
			await coordinatorSession(session).append(packet);
			return session;
		},
		async recordPauseSpan(session, span) {
			await coordinatorSession(session).addPauseSpan(span);
			return session;
		},
		async seal(session) {
			await coordinatorSession(session).seal();
			return session;
		},
		async discard(session) {
			await coordinatorSession(session).delete();
		},
		async findRecovery(projectId) {
			const inventory = (await options.coordinator.recoveryInventory(projectId))
				.filter(recoverableInventoryEntry);
			if (!inventory.length) return null;
			if (inventory.length > 1) {
				throw new Error('More than one Framescaper capture recovery session requires maintenance.');
			}
			const entry = inventory[0]!;
			if (entry.storageStatus !== 'exact') {
				throw new Error(`Framescaper capture recovery storage is ${entry.storageStatus}.`);
			}
			const session = await options.coordinator.load(projectId, entry.manifest.sessionId);
			if (!session) throw new Error('Framescaper capture recovery disappeared during admission.');
			if (session.manifest.state === 'capturing') await session.seal();
			return wrap(session);
		},
	};
	Object.freeze(port);

	return Object.freeze({ port, coordinatorSession, refresh });
}

function assertWrappedIdentity(
	session: FramescaperCaptureDurableSession,
	coordinator: CoordinatorSession,
): void {
	const manifest = coordinator.manifest;
	const sources = manifest.streams.map(({ streamId, role, storage }) => ({
		streamId, role, sourceId: storage.sourceId,
	}));
	if (manifest.sessionId !== session.sessionId
		|| manifest.origin.destination !== session.destination
		|| JSON.stringify(manifest.projectFence) !== JSON.stringify(session.projectFence)
		|| JSON.stringify(manifest.origin) !== JSON.stringify(session.origin)
		|| JSON.stringify(sources) !== JSON.stringify(session.sources)) {
		throw new Error('Framescaper capture durable session changed ownership during refresh.');
	}
}

function recoverableInventoryEntry(entry: FramescaperCaptureRecoveryInventoryEntry): boolean {
	return entry.manifest.state !== 'committed' && entry.manifest.state !== 'discarded';
}

function videoRole(value: string): 'camera' | 'display' {
	if (value !== 'camera' && value !== 'display') {
		throw new Error('Encoded Framescaper capture requires a video source role.');
	}
	return value;
}

function audioRole(value: string): 'microphone' | 'system-audio' {
	if (value !== 'microphone' && value !== 'system-audio') {
		throw new Error('PCM Framescaper capture requires an audio source role.');
	}
	return value;
}
