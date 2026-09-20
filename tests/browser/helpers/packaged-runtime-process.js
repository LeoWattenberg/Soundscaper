/* SPDX-License-Identifier: AGPL-3.0-only */

import { once } from 'node:events';

const APPLICATION_EXIT_TIMEOUT_MS = 30_000;

/**
 * Close every Electron window so the application can complete its normal quit path.
 *
 * @param {any} options
 */
export async function requestPackagedRuntimeShutdown({
	child,
	checkpoint = null,
	context,
	productId,
	timeoutMs = APPLICATION_EXIT_TIMEOUT_MS,
}) {
	if (child.exitCode !== null || child.signalCode !== null) return true;
	const appOrigin = `${packagedProductId(productId)}-app://bundle/`;
	const pages = (context?.pages?.() ?? []).filter((candidate) => candidate.isClosed?.() !== true);
	if (pages.length === 0) return false;
	const productPage = pages.find((candidate) => candidate.url().startsWith(appOrigin));
	const orderedPages = productPage === undefined
		? pages
		: [productPage, ...pages.filter((candidate) => candidate !== productPage)];
	const acceptDialog = (dialog) => { void dialog.accept().catch(() => undefined); };
	for (const page of orderedPages) page.on?.('dialog', acceptDialog);
	try {
		if (checkpoint !== null) await checkpoint();
		try {
			for (const page of orderedPages) await closePackagedRuntimePage(page, timeoutMs);
		} catch {
			return child.exitCode !== null || child.signalCode !== null;
		}
		return await waitForPackagedRuntimeExit(child, timeoutMs);
	} finally {
		for (const page of orderedPages) page.off?.('dialog', acceptDialog);
	}
}

async function closePackagedRuntimePage(page, timeoutMs) {
	if (page.isClosed?.() === true) return;
	const closed = typeof page.waitForEvent === 'function'
		? page.waitForEvent('close', { timeout: timeoutMs }).then(() => true, () => false)
		: null;
	await page.close({ runBeforeUnload: true });
	if (closed !== null && !(await closed)) throw new Error('Packaged runtime window did not close.');
}

export async function waitForPackagedRuntimeExit(child, timeoutMs) {
	if (child.exitCode !== null || child.signalCode !== null) return true;
	let timer;
	try {
		return await Promise.race([
			once(child, 'exit').then(() => true),
			new Promise((resolvePromise) => { timer = setTimeout(() => resolvePromise(false), timeoutMs); }),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export async function terminatePackagedRuntime(child, graceMs = 5_000) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'exit');
	child.kill();
	let timer;
	const graceful = await Promise.race([
		exited.then(() => true),
		new Promise((resolvePromise) => { timer = setTimeout(() => resolvePromise(false), graceMs); }),
	]);
	clearTimeout(timer);
	if (graceful || child.exitCode !== null || child.signalCode !== null) return;
	child.kill('SIGKILL');
	await exited;
}

function packagedProductId(value) {
	if (!['soundscaper', 'framescaper'].includes(value)) {
		throw new TypeError('Packaged runtime product ID is invalid.');
	}
	return value;
}
