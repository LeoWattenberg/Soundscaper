/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lifecycle ownership for every filesystem lease held by one media-host job. */

import { lstat, mkdir } from 'node:fs/promises';

import {
	acquireNativeMediaDirectoryLease,
	acquireNativeMediaFileLease,
	removeNativeMediaLeasedDirectory,
	removeNativeMediaLeasedFile,
	type NativeMediaAuthenticatedFile,
	type NativeMediaDirectoryAuthentication,
	type NativeMediaDirectoryLease,
	type NativeMediaFileAuthentication,
	type NativeMediaFileLease,
} from './native-media-filesystem-lease.ts';
import {
	acquireNativeMediaOutputTreeLease,
	sealNativeMediaOutputTree,
	type NativeMediaAuthenticatedOutputTree,
	type NativeMediaOutputTreeIdentityV1,
	type NativeMediaOutputTreeLease,
} from './native-media-output-tree.ts';

export interface NativeMediaHelperInspectedFileOutput extends NativeMediaAuthenticatedFile {
	readonly temporaryPath: string;
}

export type NativeMediaHelperInspectedOutput =
	| Readonly<NativeMediaHelperInspectedFileOutput>
	| Readonly<NativeMediaAuthenticatedOutputTree & { readonly temporaryPath: string }>;

interface ExpectedOutput {
	readonly kind: 'file';
	readonly path: string;
	readonly maximumBytes: number;
	readonly insideReservation: boolean;
}

interface ExpectedOutputTree {
	readonly kind: 'directory';
	readonly path: string;
	readonly maximumBytes: number;
	readonly insideReservation: false;
	readonly identity: NativeMediaOutputTreeIdentityV1;
}

/**
 * Keeps executable, direct-input, root, reservation, and output handles alive
 * until a host result is either revalidated or rejected. Stream-spooled inputs
 * remain digest-bound by the data plane and the admitted native host contract.
 */
export class NativeMediaHelperFilesystem {
	readonly #files: NativeMediaFileLease[] = [];
	readonly #directories: NativeMediaDirectoryLease[] = [];
	#reservation: NativeMediaDirectoryLease | null = null;
	#expectedOutput: ExpectedOutput | ExpectedOutputTree | null = null;
	#output: NativeMediaFileLease | NativeMediaOutputTreeLease | null = null;
	#settled = false;

	async authenticateFile(
		request: NativeMediaFileAuthentication,
	): Promise<Readonly<NativeMediaAuthenticatedFile>> {
		this.#assertActive();
		const lease = await acquireNativeMediaFileLease(request);
		this.#files.push(lease);
		return lease.authenticated;
	}

	async authenticateDirectory(request: NativeMediaDirectoryAuthentication): Promise<void> {
		this.#assertActive();
		this.#directories.push(await acquireNativeMediaDirectoryLease(request));
	}

	async createReservation(path: string): Promise<void> {
		this.#assertActive();
		if (this.#reservation !== null) throw new Error('A native media job already owns a scratch reservation.');
		await mkdir(path, { recursive: false, mode: 0o700 });
		this.#reservation = await acquireNativeMediaDirectoryLease({ path });
	}

	async expectOutput(request: Omit<ExpectedOutput, 'kind'>): Promise<void> {
		this.#assertActive();
		if (this.#expectedOutput !== null) throw new Error('A native media job already named its exact output.');
		await assertAbsent(request.path);
		this.#expectedOutput = Object.freeze({ ...request, kind: 'file' });
	}

	async expectOutputTree(request: Omit<ExpectedOutputTree, 'kind'>): Promise<void> {
		this.#assertActive();
		if (this.#expectedOutput !== null) throw new Error('A native media job already named its exact output.');
		await assertAbsent(request.path);
		this.#expectedOutput = Object.freeze({ kind: 'directory', ...request });
	}

	async sealOutputTree(nativeManifestSha256?: string): Promise<void> {
		this.#assertActive();
		if (this.#expectedOutput?.kind !== 'directory' || this.#output !== null) {
			throw new Error('A native media job has no unsealed output tree.');
		}
		await sealNativeMediaOutputTree({
			path: this.#expectedOutput.path, maximumBytes: this.#expectedOutput.maximumBytes,
			identity: this.#expectedOutput.identity,
			...(nativeManifestSha256 ? { nativeManifestSha256 } : {}),
		});
	}

	async inspectOutput(): Promise<Readonly<NativeMediaHelperInspectedOutput>> {
		this.#assertActive();
		if (this.#expectedOutput === null) throw new Error('A native media job did not name an output to inspect.');
		if (this.#output === null) {
			this.#output = this.#expectedOutput.kind === 'directory'
				? await acquireNativeMediaOutputTreeLease({
					path: this.#expectedOutput.path, maximumBytes: this.#expectedOutput.maximumBytes,
					identity: this.#expectedOutput.identity,
				})
				: await acquireNativeMediaFileLease({
					path: this.#expectedOutput.path,
					maximumBytes: this.#expectedOutput.maximumBytes,
				});
		}
		return inspectedOutput(this.#output);
	}

	/** Fence every held path immediately before a result leaves the helper. */
	async revalidate(): Promise<void> {
		this.#assertActive();
		await this.#revalidateAuthority();
		await this.#output?.revalidate();
	}

	async finish(options: Readonly<{ retainOutput: boolean }>): Promise<void> {
		this.#assertActive();
		if ((this.#expectedOutput === null) !== (this.#output === null)) {
			throw new Error('A native media job cannot finish before its exact output is inspected.');
		}
		await this.#revalidateAuthority();
		await this.#output?.revalidate();
		if (options.retainOutput && this.#expectedOutput?.insideReservation) {
			throw new Error('A native media job cannot retain an output inside its scratch reservation.');
		}
		if (!options.retainOutput && this.#output !== null) {
			await this.#output.close();
			this.#output = null;
		}
		await this.#removeReservation();
		if (this.#output !== null) {
			await this.#output.revalidate();
			await this.#output.close();
			this.#output = null;
		}
		await this.#closeAuthority();
		this.#settled = true;
	}

	async abort(): Promise<void> {
		if (this.#settled) return;
		const errors: unknown[] = [];
		if (this.#expectedOutput?.kind === 'directory') {
			await this.#abortOutputTree(errors);
			try { await this.#removeReservation(); } catch (error) { errors.push(error); }
			await this.#closeAuthority(errors);
			this.#settled = true;
			if (errors.length > 0) throw new AggregateError(
				errors, 'Native media filesystem cleanup refused drifted directory authority.',
			);
			return;
		}
		await this.#captureExpectedOutputForCleanup(errors);
		let reservationMayBeRemoved = true;
		if (this.#output !== null && this.#expectedOutput?.insideReservation) {
			const output = this.#output;
			try {
				await output.revalidate();
				await output.close();
				this.#output = null;
			} catch (error) {
				errors.push(error);
				reservationMayBeRemoved = false;
				await output.close().catch((closeError: unknown) => errors.push(closeError));
				this.#output = null;
			}
		} else if (this.#output !== null) {
			try { await removeNativeMediaLeasedFile(this.#output); }
			catch (error) { errors.push(error); }
			this.#output = null;
		}
		if (reservationMayBeRemoved) {
			try { await this.#removeReservation(); }
			catch (error) { errors.push(error); }
		} else if (this.#reservation !== null) {
			await this.#reservation.close().catch((error: unknown) => errors.push(error));
			this.#reservation = null;
		}
		await this.#closeAuthority(errors);
		this.#settled = true;
		if (errors.length > 0) {
			throw new AggregateError(errors, 'Native media filesystem cleanup refused drifted authority.');
		}
	}

	async #revalidateAuthority(): Promise<void> {
		for (const lease of this.#files) await lease.revalidate();
		for (const lease of this.#directories) await lease.revalidate();
		await this.#reservation?.revalidate();
	}

	async #captureExpectedOutputForCleanup(errors: unknown[]): Promise<void> {
		if (this.#output !== null || this.#expectedOutput === null
			|| this.#expectedOutput.kind === 'directory') return;
		try { await this.inspectOutput(); }
		catch (error) {
			if (!isMissing(error)) errors.push(error);
		}
	}

	async #abortOutputTree(errors: unknown[]): Promise<void> {
		const expected = this.#expectedOutput;
		if (expected?.kind !== 'directory') return;
		let directory: NativeMediaDirectoryLease | null = null;
		try {
			if (this.#output !== null) {
				if (!('kind' in this.#output.authenticated)
					|| this.#output.authenticated.kind !== 'directory') {
					throw new Error('A native media output lease changed kind.');
				}
				await this.#output.revalidate();
				const identity = this.#output.authenticated.identity;
				await this.#output.close(); this.#output = null;
				directory = await acquireNativeMediaDirectoryLease({ path: expected.path, identity });
			} else {
				directory = await acquireNativeMediaDirectoryLease({ path: expected.path });
			}
			await removeNativeMediaLeasedDirectory(directory); directory = null;
		} catch (error) {
			if (!isMissing(error)) errors.push(error);
		} finally { await directory?.close().catch((error: unknown) => errors.push(error)); }
	}

	async #removeReservation(): Promise<void> {
		if (this.#reservation === null) return;
		await removeNativeMediaLeasedDirectory(this.#reservation);
		this.#reservation = null;
	}

	async #closeAuthority(errors?: unknown[]): Promise<void> {
		for (const lease of [...this.#files, ...this.#directories]) {
			try { await lease.close(); }
			catch (error) {
				if (!errors) throw error;
				errors.push(error);
			}
		}
		this.#files.length = 0;
		this.#directories.length = 0;
	}

	#assertActive(): void {
		if (this.#settled) throw new Error('A settled native media filesystem scope cannot be reused.');
	}
}

function inspectedOutput(
	lease: NativeMediaFileLease | NativeMediaOutputTreeLease,
): Readonly<NativeMediaHelperInspectedOutput> {
	return Object.freeze({ temporaryPath: lease.path, ...lease.authenticated });
}

async function assertAbsent(path: string): Promise<void> {
	try {
		await lstat(path);
		throw new Error('The native media temporary output already exists.');
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
}

function isMissing(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
