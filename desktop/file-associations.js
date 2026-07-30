import { extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isRetryableReadCapabilityAdmissionError } from './read-capability-admission.js';

export class PendingProjectQueue {
	#deliver;
	#dispatchPromise = null;
	#dispatchRequested = false;
	#paths = [];

	constructor(deliver) {
		if (typeof deliver !== 'function') throw new TypeError('Pending project delivery callback is required');
		this.#deliver = deliver;
	}

	enqueue(filePath) {
		if (this.#paths.includes(filePath)) return false;
		this.#paths.push(filePath);
		return true;
	}

	dispatch() {
		this.#dispatchRequested = true;
		this.#dispatchPromise ??= Promise.resolve().then(() => this.#drain());
		return this.#dispatchPromise;
	}

	async #drain() {
		try {
			do {
				this.#dispatchRequested = false;
				while (this.#paths.length) {
					if (!await this.#deliver(this.#paths[0])) break;
					this.#paths.shift();
				}
			} while (this.#dispatchRequested);
		} finally {
			this.#dispatchPromise = null;
		}
	}
}

export function createPendingProjectDelivery({
	isReady,
	currentOwner,
	isOwnerCurrent,
	register,
	release,
	send,
	reportError,
}) {
	return async (filePath) => {
		if (!isReady()) return false;
		let descriptor = null;
		let owner = null;
		try {
			owner = currentOwner();
			descriptor = await register(filePath, owner);
			if (!isOwnerCurrent(owner)) {
				const staleDescriptor = descriptor;
				descriptor = null;
				await releaseDescriptor(release, staleDescriptor, owner);
				return false;
			}
			if (send(descriptor) !== true) throw new Error('Renderer did not accept pending project delivery');
			return true;
		} catch (error) {
			let reportedError = error;
			if (descriptor) {
				try {
					await releaseDescriptor(release, descriptor, owner);
				} catch (cleanupError) {
					reportedError = new AggregateError(
						[error, cleanupError],
						'Pending project delivery and read capability cleanup both failed',
						{ cause: cleanupError },
					);
				}
			}
			if (!isOwnerCurrent(owner)) return false;
			if (isRetryableReadCapabilityAdmissionError(error)) return false;
			reportError(reportedError);
			return true;
		}
	};
}

export async function redispatchPendingProjectsAfterReadRelease(queue, releasePromise) {
	const released = await releasePromise;
	if (released) void queue.dispatch();
	return released;
}

export function extractProjectPaths(argv, workingDirectory = process.cwd()) {
	const paths = [];
	for (const argument of Array.isArray(argv) ? argv : []) {
		if (typeof argument !== 'string' || argument.startsWith('-')) continue;
		let candidate = argument;
		if (candidate.startsWith('file://')) {
			try {
				candidate = fileURLToPath(candidate);
			} catch {
				continue;
			}
		}
		if (!['.aup3', '.aup4', '.scape'].includes(extname(candidate).toLowerCase())) continue;
		const absolutePath = isAbsolute(candidate) ? candidate : resolve(workingDirectory, candidate);
		if (!paths.includes(absolutePath)) paths.push(absolutePath);
	}
	return paths;
}

export const extractAup4Paths = extractProjectPaths;
export const extractAudacityProjectPaths = extractProjectPaths;

async function releaseDescriptor(release, descriptor, owner) {
	if (!await release(descriptor.id, owner)) {
		throw new Error('Pending project read capability was not released');
	}
}
