/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, normalize } from 'node:path';

const SMOKE_MODE_ARGUMENT = '--soundscaper-smoke';
const SMOKE_APP_DATA_PREFIX = '--soundscaper-smoke-app-data=';
const NIGHTLY_TESTS_BASE_URL_PREFIX = '--soundscaper-nightly-tests-base-url=';
const NIGHTLY_TESTS_APP_DATA_PREFIX = '--soundscaper-nightly-tests-app-data=';
const SOAK_DEBUG_ARGUMENT = '--soundscaper-soak-debug';
const SOAK_DEBUG_APP_DATA_PREFIX = '--soundscaper-soak-debug-app-data=';
const CLEANUP_FAILURE_EXIT_CODE = 1;
const MAXIMUM_EXIT_CODE = 255;

export interface DesktopShutdownTask {
	readonly name: string;
	readonly run: () => void | Promise<void>;
}

export interface DesktopApplicationShutdownOptions {
	readonly tasks: readonly DesktopShutdownTask[];
	readonly exit: (code: number) => void;
	readonly reportError?: (taskName: string, error: unknown) => void;
}

export interface DesktopProjectLibraryAppDataOptions {
	readonly applicationDataPath: string;
	readonly argv: readonly string[];
}

/** Coordinates every main-process exit through one complete cleanup barrier. */
export class DesktopApplicationShutdown {
	#completed = false;
	#exit: (code: number) => void;
	#exitCode: number | null = null;
	#promise: Promise<void> | null = null;
	#reportError: (taskName: string, error: unknown) => void;
	#tasks: readonly DesktopShutdownTask[];

	constructor(options: DesktopApplicationShutdownOptions) {
		if (typeof options.exit !== 'function') throw new TypeError('Desktop shutdown requires an exit callback');
		this.#tasks = Object.freeze(options.tasks.map((task) => validateTask(task)));
		this.#exit = options.exit;
		this.#reportError = options.reportError ?? (() => {});
	}

	get requested(): boolean {
		return this.#promise !== null;
	}

	requestExit(code: number): Promise<void> {
		const requestedCode = validateExitCode(code);
		if (this.#completed && this.#promise) return this.#promise;
		this.#exitCode = preferredExitCode(this.#exitCode, requestedCode);
		this.#promise ??= this.#run();
		return this.#promise;
	}

	async #run(): Promise<void> {
		const results = await Promise.allSettled(this.#tasks.map(async (task) => {
			await task.run();
		}));
		for (const [index, result] of results.entries()) {
			if (result.status === 'fulfilled') continue;
			this.#exitCode = preferredExitCode(this.#exitCode, CLEANUP_FAILURE_EXIT_CODE);
			try {
				this.#reportError(this.#tasks[index]?.name ?? 'unknown task', result.reason);
			} catch {
				// Error reporting cannot prevent the process from completing shutdown.
			}
		}
		this.#completed = true;
		this.#exit(this.#exitCode ?? CLEANUP_FAILURE_EXIT_CODE);
	}
}

/** Keeps artifact smoke probes out of the user's real product-neutral library. */
export function resolveDesktopProjectLibraryAppData(
	options: DesktopProjectLibraryAppDataOptions,
): string {
	const applicationDataPath = absolutePath(options.applicationDataPath, 'application appData');
	if (!Array.isArray(options.argv) || options.argv.some((argument) => typeof argument !== 'string')) {
		throw new TypeError('Desktop process arguments must be strings');
	}
	const nightlyBaseURLs = valuesForPrefix(options.argv, NIGHTLY_TESTS_BASE_URL_PREFIX);
	const nightlyRoots = valuesForPrefix(options.argv, NIGHTLY_TESTS_APP_DATA_PREFIX);
	if (nightlyBaseURLs.length || nightlyRoots.length) {
		if (nightlyBaseURLs.length !== 1 || nightlyRoots.length !== 1) {
			throw new TypeError('Desktop nightly tests require exactly one loopback URL and isolated appData path');
		}
		return absolutePath(nightlyRoots[0], 'nightly tests appData');
	}
	if (options.argv.includes(SOAK_DEBUG_ARGUMENT)) {
		const soakRoots = valuesForPrefix(options.argv, SOAK_DEBUG_APP_DATA_PREFIX);
		if (soakRoots.length !== 1) {
			throw new TypeError('Desktop soak debug requires exactly one isolated appData path');
		}
		return absolutePath(soakRoots[0], 'soak debug appData');
	}
	if (!options.argv.includes(SMOKE_MODE_ARGUMENT)) return applicationDataPath;
	const smokeRoots = valuesForPrefix(options.argv, SMOKE_APP_DATA_PREFIX);
	if (smokeRoots.length !== 1) {
		throw new TypeError('Desktop smoke requires exactly one isolated appData path');
	}
	return absolutePath(smokeRoots[0], 'smoke appData');
}

function valuesForPrefix(argv: readonly string[], prefix: string): string[] {
	return argv.filter((argument) => argument.startsWith(prefix)).map((argument) => argument.slice(prefix.length));
}

function validateTask(task: DesktopShutdownTask): DesktopShutdownTask {
	if (!task || typeof task.name !== 'string' || !task.name.trim() || typeof task.run !== 'function') {
		throw new TypeError('Desktop shutdown tasks require a name and callback');
	}
	return Object.freeze({ name: task.name, run: task.run });
}

function validateExitCode(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0 || value > MAXIMUM_EXIT_CODE) {
		throw new RangeError('Desktop exit code must be an integer between 0 and 255');
	}
	return value;
}

function preferredExitCode(current: number | null, requested: number): number {
	if (current === null || (current === 0 && requested !== 0)) return requested;
	return current;
}

function absolutePath(value: string | undefined, label: string): string {
	if (typeof value !== 'string' || !value || value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError(`Desktop ${label} must be an absolute path without NUL bytes`);
	}
	return normalize(value);
}
