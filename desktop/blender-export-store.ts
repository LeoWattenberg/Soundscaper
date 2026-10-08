/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
	BlenderBeginRequest, BlenderManifest, BlenderPublicationRequest, BlenderWriteRequest,
} from '../src/common/editor/blender-contract.ts';
import { createBlenderLiveServer, type BlenderLiveServer } from './blender-live-server.ts';

type Identity = { readonly dev: number; readonly ino: number };
type Media = { readonly file: string; size: number; identity: Identity | null; prefix: Uint8Array };
type Publication = {
	readonly id: string;
	readonly directory: string;
	readonly identity: Identity;
	readonly request: BlenderBeginRequest;
	readonly media: Map<string, Media>;
	totalBytes: number;
};
type Session = {
	readonly id: string;
	readonly owner: object;
	readonly directory: string;
	readonly identity: Identity;
	revision: number;
	publication: Publication | null;
	live: BlenderLiveServer | null;
	stopped: boolean;
	pending: number;
	queue: Promise<void>;
};
const MAXIMUM_MEDIA_BYTES = 16 * 1024 * 1024 * 1024;

/** Owns renderer-authorized output directories and bounded staged media writes. */
export class BlenderExportStore {
	readonly #isOwnerCurrent: (owner: object) => boolean;
	readonly #addonPath: string | undefined;
	readonly #sessions = new Map<string, Session>();
	readonly #revoked = new WeakSet<object>();
	readonly #closing = new Map<Promise<void>, object>();
	readonly #stops = new WeakMap<Session, Promise<void>>();
	#disposed = false;

	constructor(options: { isOwnerCurrent(owner: object): boolean; addonPath?: string }) {
		this.#isOwnerCurrent = options.isOwnerCurrent;
		this.#addonPath = options.addonPath;
	}

	async create(owner: object, parent: string, live: boolean): Promise<{ sessionId: string }> {
		this.#assertOwner(owner);
		this.#assertCapacity(owner);
		const directory = await mkdtemp(join(parent, 'Soundscaper-Blender-'));
		let session: Session | null = null;
		try {
			this.#assertOwner(owner);
			session = {
				id: randomBytes(24).toString('hex'), owner, directory,
				identity: await directoryIdentity(directory), revision: 0,
				publication: null, live: null, stopped: false, pending: 0, queue: Promise.resolve(),
			};
			this.#assertOwner(owner);
			this.#assertCapacity(owner);
			this.#sessions.set(session.id, session);
			if (this.#addonPath) await copyFile(this.#addonPath, join(directory, 'soundscaper_blender.py'), constants.COPYFILE_EXCL);
			this.#assertSession(session);
			if (live) {
				const current = session;
				session.live = await createBlenderLiveServer(() => this.#active(current));
				this.#assertSession(session);
				await writeFile(join(directory, 'live.json'), JSON.stringify(session.live.descriptor), { flag: 'wx', mode: 0o600 });
			}
			this.#assertSession(session);
			return { sessionId: session.id };
		} catch (error) {
			if (session) {
				session.stopped = true;
				this.#sessions.delete(session.id);
				await session.live?.close();
			}
			await rm(directory, { recursive: true, force: true });
			throw error;
		}
	}

	begin(owner: object, request: BlenderBeginRequest): Promise<{ publicationId: string }> {
		return this.#run(owner, request.sessionId, async (session) => {
			if (session.publication) throw new Error('Blender publication is already active');
			await this.#assertDirectory(session);
			const id = randomBytes(24).toString('hex');
			const directory = join(session.directory, `.publication-${id}`);
			await mkdir(directory, { mode: 0o700 });
			try {
				this.#assertSession(session);
				const identity = await directoryIdentity(directory);
				this.#assertSession(session);
				session.publication = {
					id, directory, identity, request, totalBytes: 0,
					media: new Map(request.tracks.map((track, index) => [track.id, {
						file: `track-${String(index + 1).padStart(4, '0')}.wav`, size: 0, identity: null, prefix: new Uint8Array(),
					}])),
				};
				return { publicationId: id };
			} catch (error) {
				await rm(directory, { recursive: true, force: true });
				throw error;
			}
		});
	}

	write(owner: object, request: BlenderWriteRequest): Promise<void> {
		return this.#run(owner, request.sessionId, async (session) => {
			const publication = this.#publication(session, request.publicationId);
			const media = publication.media.get(request.trackId);
			if (!media) throw new Error('Blender track is not part of the publication');
			if (media.size !== request.offset) throw new Error('Blender WAV chunk offset is not sequential');
			if (media.size + request.bytes.byteLength > MAXIMUM_MEDIA_BYTES) throw new Error('Blender WAV exceeds the file size limit');
			if (publication.totalBytes + request.bytes.byteLength > 4 * MAXIMUM_MEDIA_BYTES) throw new Error('Blender publication exceeds the total size limit');
			await this.#assertDirectory(session, publication);
			const flags = constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0)
				| (media.identity ? 0 : constants.O_CREAT | constants.O_EXCL);
			const handle = await open(join(publication.directory, media.file), flags, 0o600);
			try {
				const details = await handle.stat();
				if (!details.isFile() || details.size !== media.size || (media.identity && !sameIdentity(details, media.identity))) {
					throw new Error('Blender staged WAV changed during publication');
				}
				this.#assertSession(session);
				let written = 0;
				while (written < request.bytes.byteLength) {
					this.#assertSession(session);
					const result = await handle.write(request.bytes, written, request.bytes.byteLength - written, request.offset + written);
					if (result.bytesWritten === 0) throw new Error('Blender WAV write made no progress');
					written += result.bytesWritten;
				}
				media.identity = { dev: details.dev, ino: details.ino };
				if (media.prefix.byteLength < 48) {
					media.prefix = Uint8Array.from([...media.prefix, ...request.bytes.subarray(0, 48 - media.prefix.byteLength)]);
				}
				media.size += written;
				publication.totalBytes += written;
			} finally { await handle.close(); }
		});
	}

	commit(owner: object, request: BlenderPublicationRequest): Promise<{ revision: number }> {
		return this.#run(owner, request.sessionId, async (session) => {
			const publication = this.#publication(session, request.publicationId);
			await this.#assertDirectory(session, publication);
			for (const media of publication.media.values()) {
				if (media.size < 44 || !media.identity || !completeWave(media.prefix, media.size)) throw new Error('Blender publication requires a complete WAV for every track');
				const details = await lstat(join(publication.directory, media.file));
				if (!details.isFile() || !sameIdentity(details, media.identity) || details.size !== media.size) {
					throw new Error('Blender staged WAV changed before commit');
				}
			}
			this.#assertSession(session);
			const revision = session.revision + 1;
			const revisionName = `revision-${String(revision)}-${publication.id}`;
			const manifest: BlenderManifest = {
				schemaVersion: 1, projectId: publication.request.projectId,
				projectName: publication.request.projectName, revision,
				tracks: publication.request.tracks.map((track) => ({
					...track, fileName: `${revisionName}/${publication.media.get(track.id)!.file}`,
				})),
			};
			const json = `${JSON.stringify(manifest, null, 2)}\n`;
			const temporary = join(session.directory, `.manifest-${publication.id}`);
			try {
				await writeFile(temporary, json, { flag: 'wx', mode: 0o600 });
				await this.#assertDirectory(session, publication);
				await rename(publication.directory, join(session.directory, revisionName));
				this.#assertSession(session);
				await rename(temporary, join(session.directory, 'soundscaper.json'));
				session.revision = revision;
				session.publication = null;
				session.live?.publish(revision, json);
				return { revision };
			} finally { await rm(temporary, { force: true }); }
		});
	}

	abort(owner: object, request: BlenderPublicationRequest): Promise<void> {
		return this.#run(owner, request.sessionId, async (session) => {
			const publication = this.#publication(session, request.publicationId);
			await this.#assertDirectory(session);
			await rm(publication.directory, { recursive: true, force: true });
			session.publication = null;
		});
	}

	stop(owner: object, sessionId: string): Promise<void> {
		const session = this.#session(owner, sessionId);
		return this.#stop(session);
	}

	async revokeOwner(owner: object): Promise<void> {
		this.#revoked.add(owner);
		const stops = [...this.#sessions.values()].filter((session) => session.owner === owner).map((session) => this.#stop(session));
		await Promise.all([...stops, ...[...this.#closing].filter(([, pendingOwner]) => pendingOwner === owner).map(([closing]) => closing)]);
	}

	async dispose(): Promise<void> {
		this.#disposed = true;
		const stops = [...this.#sessions.values()].map((session) => this.#stop(session));
		await Promise.all([...stops, ...this.#closing.keys()]);
	}

	#stop(session: Session): Promise<void> {
		const pending = this.#stops.get(session);
		if (pending) return pending;
		session.stopped = true;
		this.#sessions.delete(session.id);
		const closing = session.queue.then(async () => {
			await session.live?.close();
			session.live = null;
			// Cleanup only inside the originally created directory, never a replaced symlink.
			if (!sameIdentity(await directoryIdentity(session.directory), session.identity)) return;
			await rm(join(session.directory, 'live.json'), { force: true });
			if (session.publication) {
				await rm(session.publication.directory, { recursive: true, force: true });
				session.publication = null;
			}
		});
		this.#stops.set(session, closing);
		this.#closing.set(closing, session.owner);
		void closing.then(() => this.#closing.delete(closing), () => this.#closing.delete(closing));
		return closing;
	}

	#run<Result>(owner: object, id: string, operation: (session: Session) => Promise<Result>): Promise<Result> {
		const session = this.#session(owner, id);
		if (session.pending >= 4) throw new Error('Blender publication queue is full');
		session.pending++;
		const result = session.queue.then(async () => {
			this.#assertSession(session);
			return operation(session);
		});
		session.queue = result.then(() => { session.pending--; }, () => { session.pending--; });
		return result;
	}
	#session(owner: object, id: string): Session {
		this.#assertOwner(owner);
		const session = this.#sessions.get(id);
		if (!session || session.owner !== owner) throw new Error('Blender session is unavailable for this owner');
		this.#assertSession(session);
		return session;
	}
	#publication(session: Session, id: string): Publication {
		if (!session.publication || session.publication.id !== id) throw new Error('Blender publication is not active');
		return session.publication;
	}
	#active(session: Session): boolean {
		return !this.#disposed && !session.stopped && !this.#revoked.has(session.owner) && this.#isOwnerCurrent(session.owner);
	}
	#assertOwner(owner: object): void {
		if (this.#disposed || this.#revoked.has(owner) || !this.#isOwnerCurrent(owner)) throw new Error('Blender renderer owner is no longer current');
	}
	#assertCapacity(owner: object): void {
		if (this.#sessions.size >= 16 || [...this.#sessions.values()].filter((session) => session.owner === owner).length >= 4) {
			throw new Error('Stop an existing Blender connection before creating another');
		}
	}
	#assertSession(session: Session): void {
		if (!this.#active(session)) throw new Error('Blender session owner is no longer current');
	}
	async #assertDirectory(session: Session, publication?: Publication): Promise<void> {
		this.#assertSession(session);
		if (!sameIdentity(await directoryIdentity(session.directory), session.identity)
			|| (publication && !sameIdentity(await directoryIdentity(publication.directory), publication.identity))) {
			throw new Error('Blender export directory changed');
		}
		this.#assertSession(session);
	}
}

async function directoryIdentity(path: string): Promise<Identity> {
	const details = await lstat(path);
	if (!details.isDirectory()) throw new Error('Blender export directory is not a regular directory');
	return { dev: details.dev, ino: details.ino };
}
function sameIdentity(actual: Identity | Stats, expected: Identity): boolean {
	return actual.dev === expected.dev && actual.ino === expected.ino;
}
function completeWave(prefix: Uint8Array, size: number): boolean {
	if (prefix.byteLength < 12) return false;
	const bytes = Buffer.from(prefix);
	if (bytes.toString('ascii', 8, 12) !== 'WAVE') return false;
	const format = bytes.toString('ascii', 0, 4);
	if (format === 'RIFF') return bytes.readUInt32LE(4) + 8 === size;
	return format === 'RF64' && prefix.byteLength >= 48 && bytes.readUInt32LE(4) === 0xffff_ffff
		&& bytes.toString('ascii', 12, 16) === 'ds64' && bytes.readUInt32LE(16) >= 28
		&& bytes.readBigUInt64LE(20) + 8n === BigInt(size);
}
