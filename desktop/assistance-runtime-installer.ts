/* SPDX-License-Identifier: AGPL-3.0-only */

/** On-demand, digest-pinned installation of optional AI runtime archives. */

import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import {
	access, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { extractAssistanceRuntimeArchive } from './assistance-runtime-archive.ts';
import {
	runtimeDistributionTargetFor, validateAssistanceRuntimeDistribution,
	type AssistanceRuntimeDistribution,
	type AssistanceRuntimeDistributionBundle,
	type AssistanceRuntimeDistributionFamily,
} from './assistance-runtime-distribution.ts';
import { downloadLocalModelArtifact } from './local-model-download.ts';
import { FileLocalModelStore } from './local-model-store.ts';

export interface AssistanceRuntimeInstallerOptions {
	readonly runtimeRoot: string;
	readonly distribution?: unknown;
	readonly distributionPath?: string;
	readonly platform?: string;
	readonly architecture?: string;
	readonly fetchImpl?: typeof fetch;
}

export interface AssistanceRuntimeInstallProgress {
	readonly familyId: AssistanceRuntimeDistributionFamily;
	readonly completedBytes: number;
	readonly totalBytes: number;
}

interface ActiveRuntimeInstall {
	readonly controller: AbortController;
	readonly work: Promise<void>;
	readonly consumers: Set<symbol>;
	readonly progress: Map<symbol, (progress: AssistanceRuntimeInstallProgress) => void>;
}

function absoluteRoot(value: string): string {
	if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')
		|| resolve(value) !== value) {
		throw new TypeError('The assistance runtime install root must be an absolute canonical path.');
	}
	return value;
}

function noEntry(error: unknown): boolean {
	return error !== null && typeof error === 'object' && 'code' in error
		&& error.code === 'ENOENT';
}

async function exists(path: string): Promise<boolean> {
	try { await lstat(path); return true; }
	catch (error) { if (noEntry(error)) return false; throw error; }
}

async function exactClosure(
	root: string,
	bundle: AssistanceRuntimeDistributionBundle,
	signal?: AbortSignal,
): Promise<boolean> {
	try {
		const metadata = await lstat(root);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) return false;
		const discovered: string[] = [];
		async function walk(directory: string, depth: number): Promise<void> {
			if (depth > 16) throw new Error('The runtime directory is too deep.');
			for (const item of await readdir(resolve(root, directory), { withFileTypes: true })) {
				signal?.throwIfAborted();
				if (item.isSymbolicLink()) throw new Error('The runtime contains a symbolic link.');
				const path = directory ? `${directory}/${item.name}` : item.name;
				if (item.isDirectory()) await walk(path, depth + 1);
				else if (item.isFile()) discovered.push(path);
				else throw new Error('The runtime contains an irregular file.');
				if (discovered.length > bundle.files.length) throw new Error('The runtime inventory is excessive.');
			}
		}
		await walk('', 0);
		if (JSON.stringify(discovered.sort()) !== JSON.stringify(bundle.files.map(({ path }) => path))) return false;
		for (const file of bundle.files) {
			signal?.throwIfAborted();
			const path = resolve(root, file.path);
			const stat = await lstat(path);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.byteLength) return false;
			if (file.executable && process.platform !== 'win32') await access(path, constants.X_OK);
			const hash = createHash('sha256');
			for await (const chunk of createReadStream(path)) {
				signal?.throwIfAborted();
				hash.update(chunk);
			}
			if (hash.digest('hex') !== file.sha256) return false;
		}
		return true;
	} catch (error) {
		if (signal?.aborted) signal.throwIfAborted();
		if (noEntry(error)) return false;
		return false;
	}
}

export function createAssistanceRuntimeInstaller(options: AssistanceRuntimeInstallerOptions) {
	const runtimeRoot = absoluteRoot(options.runtimeRoot);
	if ((options.distribution === undefined) === (options.distributionPath === undefined)) {
		throw new TypeError('The runtime installer needs exactly one distribution source.');
	}
	if (options.distributionPath !== undefined) absoluteRoot(options.distributionPath);
	const targetId = runtimeDistributionTargetFor(options.platform ?? process.platform,
		options.architecture ?? process.arch);
	const cache = new FileLocalModelStore(join(runtimeRoot, '.archives'));
	const active = new Map<AssistanceRuntimeDistributionFamily, ActiveRuntimeInstall>();
	const pending = new Map<AssistanceRuntimeDistributionFamily, Promise<number>>();
	let distributionPromise: Promise<AssistanceRuntimeDistribution> | null = null;

	function distribution(): Promise<AssistanceRuntimeDistribution> {
		distributionPromise ??= (async () => {
			const value: unknown = options.distributionPath === undefined ? options.distribution
				: JSON.parse(await readFile(options.distributionPath, 'utf8'));
			return validateAssistanceRuntimeDistribution(value, targetId);
		})();
		return distributionPromise;
	}

	async function bundleFor(familyId: AssistanceRuntimeDistributionFamily): Promise<AssistanceRuntimeDistributionBundle> {
		const bundle = (await distribution()).bundles.find((candidate) => candidate.familyId === familyId);
		if (!bundle) throw new Error(`The ${familyId} runtime is unavailable for ${targetId}.`);
		return bundle;
	}

	function pendingDownloadBytes(familyId: AssistanceRuntimeDistributionFamily): Promise<number> {
		const current = pending.get(familyId);
		if (current) return current;
		const work = bundleFor(familyId).then(async (bundle) => {
			if (await exactClosure(resolve(runtimeRoot, bundle.installPath), bundle)
				|| await cache.verifyArtifact({
					fileName: `${bundle.familyId}-${targetId}.tar.gz`,
					byteLength: bundle.archive.byteLength, sha256: bundle.archive.sha256,
				})) return 0;
			return bundle.archive.byteLength;
		});
		pending.set(familyId, work);
		void work.finally(() => { if (pending.get(familyId) === work) pending.delete(familyId); })
			.catch(() => undefined);
		return work;
	}

	async function isInstalled(familyId: AssistanceRuntimeDistributionFamily): Promise<boolean> {
		const bundle = await bundleFor(familyId);
		return exactClosure(resolve(runtimeRoot, bundle.installPath), bundle);
	}

	async function install(
		bundle: AssistanceRuntimeDistributionBundle,
		signal?: AbortSignal,
		onProgress?: (progress: AssistanceRuntimeInstallProgress) => void,
	): Promise<void> {
		signal?.throwIfAborted();
		const destination = resolve(runtimeRoot, bundle.installPath);
		if (await exactClosure(destination, bundle, signal)) return;
		await cache.initialize();
		const artifact = Object.freeze({
			fileName: `${bundle.familyId}-${targetId}.tar.gz`,
			byteLength: bundle.archive.byteLength, sha256: bundle.archive.sha256,
		});
		if (await cache.hasBlob(artifact.sha256) && !await cache.verifyArtifact(artifact)) {
			await rm(cache.blobPath(artifact.sha256));
		}
		const downloaded = await downloadLocalModelArtifact({
			store: cache, artifact, url: bundle.archive.url,
			fetchImpl: options.fetchImpl, signal,
			onProgress: ({ completedBytes, totalBytes }) => onProgress?.(Object.freeze({
				familyId: bundle.familyId, completedBytes, totalBytes,
			})),
		});
		signal?.throwIfAborted();
		const parent = resolve(destination, '..');
		await mkdir(parent, { recursive: true, mode: 0o700 });
		const staging = await mkdtemp(join(parent, '.runtime-install-'));
		const backup = `${staging}.previous`;
		let oldMoved = false;
		let published = false;
		try {
			await extractAssistanceRuntimeArchive(downloaded.blobPath, staging, bundle.files, signal);
			if (!await exactClosure(staging, bundle, signal)) {
				throw new Error('The extracted runtime failed its file digest or inventory check.');
			}
			signal?.throwIfAborted();
			if (await exists(destination)) {
				await rename(destination, backup);
				oldMoved = true;
			}
			try { await rename(staging, destination); published = true; }
			catch (error) {
				if (oldMoved) await rename(backup, destination);
				throw error;
			}
		} finally {
			if (!published) await rm(staging, { recursive: true, force: true });
			if (published && oldMoved) await rm(backup, { recursive: true, force: true });
		}
	}

	async function ensure(
		familyId: AssistanceRuntimeDistributionFamily,
		signal?: AbortSignal,
		onProgress?: (progress: AssistanceRuntimeInstallProgress) => void,
	): Promise<void> {
		signal?.throwIfAborted();
		let current = active.get(familyId);
		if (current?.controller.signal.aborted) {
			await current.work.catch(() => undefined);
			signal?.throwIfAborted();
			current = undefined;
		}
		if (!current) {
			const controller = new AbortController();
			const consumers = new Set<symbol>();
			const progress = new Map<symbol, (value: AssistanceRuntimeInstallProgress) => void>();
			const work = bundleFor(familyId).then((bundle) => install(bundle, controller.signal,
				(value) => { for (const listener of progress.values()) listener(value); }));
			current = { controller, work, consumers, progress };
			active.set(familyId, current);
			const installing = current;
			void work.finally(() => {
				if (active.get(familyId) === installing) active.delete(familyId);
			}).catch(() => undefined);
		}
		const installation = current;
		const consumer = Symbol(familyId);
		installation.consumers.add(consumer);
		if (onProgress) installation.progress.set(consumer, onProgress);
		return new Promise<void>((accept, reject) => {
			let settled = false;
			const remove = (): void => {
				installation.consumers.delete(consumer);
				installation.progress.delete(consumer);
				signal?.removeEventListener('abort', abort);
			};
			const abort = (): void => {
				if (settled) return;
				settled = true;
				remove();
				if (installation.consumers.size === 0) {
					installation.controller.abort(signal?.reason);
					void installation.work.catch(() => undefined).then(() => reject(
						signal?.reason ?? new DOMException('Runtime installation cancelled.', 'AbortError')));
				} else reject(signal?.reason ?? new DOMException('Runtime installation cancelled.', 'AbortError'));
			};
			signal?.addEventListener('abort', abort, { once: true });
			if (signal?.aborted) { abort(); return; }
			void installation.work.then(() => {
				if (settled) return;
				settled = true;
				remove();
				accept();
			}, (error: unknown) => {
				if (settled) return;
				settled = true;
				remove();
				reject(error);
			});
		});
	}

	async function bundle(familyId: AssistanceRuntimeDistributionFamily): Promise<AssistanceRuntimeDistributionBundle> {
		return bundleFor(familyId);
	}

	return Object.freeze({ runtimeRoot, targetId, bundle, pendingDownloadBytes, isInstalled, ensure });
}

export type AssistanceRuntimeInstaller = ReturnType<typeof createAssistanceRuntimeInstaller>;
