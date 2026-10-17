/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const installed = new WeakMap<Page, Promise<void>>();
interface WorkerEnvironment { secure: boolean; isolated: boolean; kind: string; directory: string; handler: string; synchronousAccess: string }
type WorkerObservation = { environment: WorkerEnvironment } | { failure: unknown };
const observations = new WeakMap<Page, Array<Promise<WorkerObservation>>>();

/** Observe the real module execution context, so failed worker loading cannot
 * qualify merely because the repository's native file fallback still succeeds. */
export function watchNativeOpfsWorkerExecution(page: Page): void {
	if (observations.has(page)) return;
	const attempts: Array<Promise<WorkerObservation>> = []; observations.set(page, attempts);
	page.on('worker', worker => {
		if (!new URL(worker.url()).pathname.endsWith('/opfs-sync-worker.ts')) return;
		attempts.push(worker.evaluate(() => ({ secure: isSecureContext, isolated: crossOriginIsolated,
			kind: globalThis.constructor.name, directory: typeof navigator.storage.getDirectory,
			handler: typeof globalThis.onmessage, synchronousAccess: typeof Reflect.get(FileSystemFileHandle.prototype, 'createSyncAccessHandle') }))
			.then(environment => ({ environment }), (failure: unknown) => ({ failure })));
	});
}

export async function assertNativeOpfsWorkerExecution(page: Page): Promise<void> {
	const attempts = observations.get(page);
	if (!attempts?.length) throw new Error('The actual OPFS worker companion has not executed.');
	for (const attempt of await Promise.all(attempts)) {
		if ('failure' in attempt) throw new Error('The actual OPFS worker companion failed to execute.', { cause: attempt.failure });
		const value = attempt.environment;
		if (!value.secure || !value.isolated || value.kind !== 'DedicatedWorkerGlobalScope'
			|| value.directory !== 'function' || value.handler !== 'function' || value.synchronousAccess !== 'function') {
			throw new Error(`The actual OPFS worker companion lacks its native execution environment: ${JSON.stringify(value)}`);
		}
	}
}

/** Esbuild preserves the common client's worker URL; supply its actual companion
 * with the same response policy the production preview serves at that URL. */
export function installNativeOpfsWorkerCompanion(page: Page): Promise<void> {
	watchNativeOpfsWorkerExecution(page);
	const prior = installed.get(page); if (prior) return prior;
	const ready = install(page); installed.set(page, ready); return ready;
}

async function install(page: Page): Promise<void> {
	await page.exposeFunction('__assertNativeOpfsWorkerExecution', () => assertNativeOpfsWorkerExecution(page));
	const worker = await build({ entryPoints: [fileURLToPath(new URL('../../../src/common/editor/storage/opfs-sync-worker.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser' });
	const body = worker.outputFiles[0]?.text;
	if (worker.outputFiles.length !== 1 || typeof body !== 'string') throw new Error('Expected one actual OPFS worker companion.');
	await page.route('**/opfs-sync-worker.ts', async route => {
		const response = await route.fetch();
		const headers = response.headers(); delete headers['content-length']; delete headers['content-encoding'];
		headers['content-type'] = 'text/javascript';
		try { await route.fulfill({ status: 200, headers, body }); }
		finally { await response.dispose(); }
	});
}
