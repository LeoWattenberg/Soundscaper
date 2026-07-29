import { extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
