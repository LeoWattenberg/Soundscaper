/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Browser, BrowserContext, Page } from '@playwright/test';

export interface MotionLinkIsolationCapability {
	readonly isolated: boolean;
	readonly sharedArrayBuffer: string;
	readonly secure: boolean;
}
interface Header { readonly name: string; readonly value: string }

export function readMotionLinkIsolation(page: Page): Promise<MotionLinkIsolationCapability> {
	return page.evaluate(() => ({
		isolated: crossOriginIsolated,
		sharedArrayBuffer: typeof SharedArrayBuffer,
		secure: isSecureContext,
	}));
}

function assertHeaders(headers: readonly Header[]): void {
	const values = (name: string) => headers.filter(header => header.name.toLowerCase() === name).map(header => header.value);
	assert.deepEqual(values('cross-origin-opener-policy'), ['same-origin'], 'Editor opener policy must remain exactly same-origin.');
	assert.deepEqual(values('cross-origin-embedder-policy'), ['credentialless'], 'Editor embedder policy must remain exactly credentialless.');
}

export function assertMotionLinkEditorIsolation(
	headers: readonly Header[],
	actual: MotionLinkIsolationCapability,
	capability: MotionLinkIsolationCapability,
): void {
	assertHeaders(headers);
	assert.equal(capability.secure, true, 'Independent probe secure context is required.');
	assert.equal(capability.sharedArrayBuffer, capability.isolated ? 'function' : 'undefined', 'Independent probe SharedArrayBuffer must agree with isolation.');
	assert.equal(actual.secure, true, 'Editor secure context is required.');
	assert.equal(actual.isolated, capability.isolated, 'Editor isolation capability must agree with the independent probe.');
	assert.equal(actual.sharedArrayBuffer, capability.sharedArrayBuffer, 'Editor SharedArrayBuffer must agree with the independent probe.');
}

/** Fixed policy, no product imports or assets: measure the engine without trusting editor routing.
 * WebKit tracks credentialless implementation at https://bugs.webkit.org/show_bug.cgi?id=230550.
 * A missing capability never skips the bridge's transfer, opener or offline assertions.
 */
export async function probeMotionLinkIsolation(browser: Browser): Promise<MotionLinkIsolationCapability> {
	const server = createServer((_request, response) => {
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('Content-Type', 'text/html');
		response.end('<!doctype html><title>Isolation capability</title>');
	});
	let context: BrowserContext | undefined;
	let capability: MotionLinkIsolationCapability | undefined;
	const failures: unknown[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
		});
		const address = server.address();
		assert.ok(address && typeof address !== 'string', 'Independent isolation probe must bind loopback.');
		context = await browser.newContext({ serviceWorkers: 'block' });
		const page = await context.newPage();
		const response = await page.goto(`http://127.0.0.1:${address.port}/`);
		assert.ok(response && response.status() === 200, 'Independent isolation probe must load.');
		capability = await readMotionLinkIsolation(page);
		assertMotionLinkEditorIsolation(await response.headersArray(), capability, capability);
	} catch (error) { failures.push(error); }
	finally {
		server.closeAllConnections();
		const cleanup = await Promise.allSettled([
			context?.close(),
			server.listening ? new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) : undefined,
		]);
		for (const result of cleanup) if (result.status === 'rejected') failures.push(result.reason);
	}
	if (failures.length) throw new AggregateError(failures, 'Independent isolation probe failed.');
	assert.ok(capability);
	return Object.freeze(capability);
}
