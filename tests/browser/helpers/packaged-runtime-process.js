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
		if (productPage !== undefined && await requestTrustedApplicationQuit(productPage)) {
			if (await waitForPackagedRuntimeExit(child, timeoutMs)) return true;
		}
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

async function requestTrustedApplicationQuit(page) {
	if (page.isClosed?.() === true || typeof page.evaluate !== 'function') return false;
	try {
		return await page.evaluate(() => {
			const bridge = globalThis.scapeDesktop
				?? globalThis.soundscaperDesktop
				?? globalThis.framescaperDesktop;
			if (typeof bridge?.v1?.runWindowAction !== 'function') return false;
			// Delivery is synchronous even though the acknowledgement is not. The
			// renderer is expected to disappear while Electron completes app.quit().
			void Promise.resolve(bridge.v1.runWindowAction('quit')).catch(() => undefined);
			return true;
		});
	} catch {
		// The application may destroy the inspected context as soon as it accepts
		// the request. The caller still waits for the child before using its close
		// and signal fallbacks.
		return false;
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

export async function terminatePackagedRuntime(child, graceMs = 5_000, forceMs = 5_000) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, 'exit');
	child.kill();
	const graceful = await waitForExitEvent(exited, graceMs);
	if (graceful || child.exitCode !== null || child.signalCode !== null) return;
	if (!child.kill('SIGKILL') && child.exitCode === null && child.signalCode === null) {
		throw new Error('Packaged runtime forced termination signal was refused.');
	}
	if (await waitForExitEvent(exited, forceMs)) return;
	if (child.exitCode !== null || child.signalCode !== null) return;
	throw new Error('Packaged runtime forced termination was not observed before its deadline.');
}

async function waitForExitEvent(exited, timeoutMs) {
	let timer;
	try {
		return await Promise.race([
			exited.then(() => true),
			new Promise((resolvePromise) => {
				timer = setTimeout(() => resolvePromise(false), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

function packagedProductId(value) {
	if (!['soundscaper', 'framescaper'].includes(value)) {
		throw new TypeError('Packaged runtime product ID is invalid.');
	}
	return value;
}
