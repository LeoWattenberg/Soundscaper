/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { lstat, opendir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const MAX_SESSIONS = 4;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SCAN_ENTRIES = 20_000;
const MAX_SCAN_DEPTH = 12;
const AUDIO_EXTENSION = /\.(?:aac|aiff?|flac|m4a|mp2|mp3|oga|ogg|opus|rf64|wav|wv)$/iu;

export function normalizeSesxRelativePath(value) {
	if (typeof value !== 'string' || !value || value.length > 4096 || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
		throw new TypeError('SESX media path must be a bounded relative path');
	}
	const normalized = value.replaceAll('\\', '/');
	if (normalized.startsWith('/') || /^[a-z]:/iu.test(normalized) || normalized.includes('://')) {
		throw new TypeError('SESX media path must be relative');
	}
	const parts = normalized.split('/');
	if (parts.length > 32 || parts.some((part) => !part || part === '.' || part === '..' || part.length > 255)) {
		throw new TypeError('SESX media path must not contain traversal or empty components');
	}
	return Object.freeze(parts);
}

export class SesxMediaSessionStore {
	#sessions = new Map();
	#readCapabilities;
	#dialog;
	#windowFor;
	#maxScanEntries;
	#now;

	constructor({ readCapabilities, dialog, windowFor, maxScanEntries = MAX_SCAN_ENTRIES, now = Date.now }) {
		if (!readCapabilities || typeof readCapabilities.registerSelectedAudioRangePath !== 'function'
			|| typeof readCapabilities.resolveHelperGrant !== 'function'
			|| !dialog || typeof dialog.showOpenDialog !== 'function' || typeof windowFor !== 'function') {
			throw new TypeError('SESX media sessions require desktop read and folder selection ports');
		}
		this.#readCapabilities = readCapabilities;
		this.#dialog = dialog;
		this.#windowFor = windowFor;
		this.#maxScanEntries = Number.isSafeInteger(maxScanEntries) && maxScanEntries > 0 && maxScanEntries <= MAX_SCAN_ENTRIES
			? maxScanEntries : MAX_SCAN_ENTRIES;
		this.#now = now;
	}

	async registerSelection(sessionReadId, filePath, { owner } = {}) {
		if (typeof sessionReadId !== 'string' || !/^[a-f0-9]{64}$/u.test(sessionReadId)
			|| typeof filePath !== 'string' || !isAbsolute(filePath) || !/\.sesx$/iu.test(filePath)) {
			throw new TypeError('A selected SESX file and read capability are required');
		}
		if ((typeof owner !== 'object' || owner === null) && typeof owner !== 'function') {
			throw new TypeError('SESX media session requires a renderer owner');
		}
		this.#sweepExpired();
		if (this.#sessions.size >= MAX_SESSIONS || this.#sessions.has(sessionReadId)) {
			throw new Error('Too many active SESX media sessions');
		}
		const session = {
			owner, selectedSessionFolder: dirname(resolve(filePath)), folder: null, folderIdentity: null,
			selectedFolder: null, selectedFolderIdentity: null, mediaRootId: null,
			expiresAt: this.#now() + SESSION_TTL_MS,
		};
		this.#sessions.set(sessionReadId, session);
		try {
			const grant = await this.#readCapabilities.resolveHelperGrant(sessionReadId, { owner });
			if (!grant || grant.path !== filePath) throw new Error('Selected SESX read capability is unavailable');
			const folder = await pinnedDirectory(session.selectedSessionFolder);
			const file = await stat(filePath);
			this.#assertCurrent(sessionReadId, session);
			if (!file.isFile() || file.dev !== grant.identity.dev || file.ino !== grant.identity.ino
				|| file.size !== grant.size) throw new Error('Selected SESX file changed during session registration');
			session.folder = folder.path;
			session.folderIdentity = folder.identity;
		} catch (error) {
			if (this.#sessions.get(sessionReadId) === session) this.#sessions.delete(sessionReadId);
			throw error;
		}
	}

	async chooseFolder({ sessionReadId, owner } = {}) {
		const session = this.#requireSession(sessionReadId, owner);
		const selected = await this.#dialog.showOpenDialog(this.#windowFor(), {
			title: 'Locate Adobe Audition media', properties: ['openDirectory'],
		});
		this.#assertCurrent(sessionReadId, session);
		if (selected.canceled || selected.filePaths?.length !== 1) return Object.freeze({ status: 'cancelled' });
		const chosenPath = selected.filePaths[0];
		if (typeof chosenPath !== 'string' || !isAbsolute(chosenPath)) throw new TypeError('SESX media folder selection was invalid');
		const folder = await realpath(chosenPath);
		const details = await stat(folder);
		this.#assertCurrent(sessionReadId, session);
		if (!details.isDirectory()) throw new TypeError('SESX media root must be a directory');
		session.selectedFolder = folder;
		session.selectedFolderIdentity = directoryIdentity(details);
		session.mediaRootId = randomBytes(24).toString('hex');
		return Object.freeze({ status: 'selected', mediaRootId: session.mediaRootId });
	}

	async resolve({ sessionReadId, relativePath, mediaRootId, owner } = {}) {
		const session = this.#requireSession(sessionReadId, owner);
		const parts = normalizeSesxRelativePath(relativePath);
		if (mediaRootId !== undefined && (typeof mediaRootId !== 'string' || mediaRootId !== session.mediaRootId)) {
			throw new TypeError('SESX media folder grant does not belong to this session');
		}
		const sessionRoot = await verifiedDirectory(session.selectedSessionFolder, session.folder, session.folderIdentity);
		this.#assertCurrent(sessionReadId, session);
		let candidate = await exactCandidate(sessionRoot, parts);
		if (!candidate && mediaRootId !== undefined) {
			const selectedRoot = await verifiedDirectory(session.selectedFolder, session.selectedFolder, session.selectedFolderIdentity);
			candidate = await exactCandidate(selectedRoot, parts);
			if (!candidate) candidate = await uniqueBasenameCandidate(selectedRoot, parts.at(-1), this.#maxScanEntries);
		}
		this.#assertCurrent(sessionReadId, session);
		if (candidate === 'ambiguous' || candidate === 'scan-limited') return Object.freeze({ status: candidate });
		if (!candidate) return Object.freeze({ status: 'missing' });
		const descriptor = await this.#readCapabilities.registerSelectedAudioRangePath(candidate.path, {
			owner, expectedIdentity: candidate.identity,
		});
		if (this.#sessions.get(sessionReadId) !== session) {
			await this.#readCapabilities.release(descriptor.id, { owner });
			throw new Error('SESX media session expired during resolution');
		}
		return Object.freeze({ status: 'found', descriptor });
	}

	release(sessionReadId, { owner } = {}) {
		const session = this.#sessions.get(sessionReadId);
		if (!session) return false;
		if (session.owner !== owner) return false;
		this.#sessions.delete(sessionReadId);
		return true;
	}

	revokeOwner(owner) {
		for (const [id, session] of this.#sessions) if (session.owner === owner) this.#sessions.delete(id);
	}

	dispose() { this.#sessions.clear(); }

	#requireSession(id, owner) {
		this.#sweepExpired();
		const session = this.#sessions.get(id);
		if (!session || session.owner !== owner) throw new Error('SESX media session is unavailable');
		session.expiresAt = this.#now() + SESSION_TTL_MS;
		return session;
	}

	#assertCurrent(id, session) {
		if (this.#sessions.get(id) !== session) throw new Error('SESX media session is unavailable');
	}

	#sweepExpired() {
		const now = this.#now();
		for (const [id, session] of this.#sessions) if (session.expiresAt <= now) this.#sessions.delete(id);
	}
}

async function pinnedDirectory(path) {
	const physical = await realpath(path);
	const details = await stat(physical);
	if (!details.isDirectory()) throw new TypeError('SESX media root must be a directory');
	return Object.freeze({ path: physical, identity: directoryIdentity(details) });
}

async function verifiedDirectory(selectedPath, expectedPath, identity) {
	const current = await pinnedDirectory(selectedPath);
	if (current.path !== expectedPath || current.identity.dev !== identity.dev || current.identity.ino !== identity.ino) {
		throw new Error('SESX media root changed after selection');
	}
	return current.path;
}

function directoryIdentity(details) { return Object.freeze({ dev: details.dev, ino: details.ino }); }

async function exactCandidate(root, parts) {
	if (!root || !AUDIO_EXTENSION.test(parts.at(-1))) return null;
	let current = root;
	for (let index = 0; index < parts.length; index += 1) {
		current = join(current, parts[index]);
		let details;
		try { details = await lstat(current); } catch (error) { if (isMissing(error)) return null; throw error; }
		if (details.isSymbolicLink()) return null;
		if (index < parts.length - 1 && !details.isDirectory()) return null;
		if (index === parts.length - 1 && !details.isFile()) return null;
	}
	const physical = await realpath(current);
	if (!isWithin(root, physical)) return null;
	const details = await stat(physical);
	if (!details.isFile()) return null;
	return Object.freeze({ path: physical, identity: fileIdentity(details) });
}

async function uniqueBasenameCandidate(root, fileName, maxEntries) {
	if (!AUDIO_EXTENSION.test(fileName)) return null;
	const queue = [{ path: root, depth: 0 }];
	let count = 0;
	let match = null;
	while (queue.length) {
		const folder = queue.shift();
		try {
			for await (const entry of await opendir(folder.path)) {
				count += 1;
				if (count > maxEntries) return 'scan-limited';
				if (entry.isSymbolicLink()) continue;
				const path = join(folder.path, entry.name);
				if (entry.isDirectory()) {
					if (folder.depth >= MAX_SCAN_DEPTH) return 'scan-limited';
					queue.push({ path, depth: folder.depth + 1 });
				} else if (entry.isFile() && entry.name.toLocaleLowerCase('en') === fileName.toLocaleLowerCase('en')) {
					const parts = relative(root, path).split(sep);
					const candidate = await exactCandidate(root, parts);
					if (candidate) {
						if (match) return 'ambiguous';
						match = candidate;
					}
				}
			}
		} catch (error) { if (!isMissing(error)) throw error; }
	}
	return match;
}

function isWithin(root, path) {
	const subpath = relative(root, path);
	return !subpath.startsWith(`..${sep}`) && subpath !== '..' && !isAbsolute(subpath);
}

function fileIdentity(details) {
	return Object.freeze({ dev: details.dev, ino: details.ino, size: details.size, mtimeMs: details.mtimeMs, ctimeMs: details.ctimeMs });
}

function isMissing(error) { return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' || error?.code === 'ELOOP'; }
