/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

export async function waitForEvent(events: readonly string[], expected: string): Promise<void> {
	for (let attempt = 0; attempt < 20 && !events.includes(expected); attempt += 1) {
		await new Promise<void>((resolve) => { setImmediate(resolve); });
	}
	assert.equal(events.includes(expected), true, `Expected event ${expected}.`);
}

export function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
	return { promise, resolve, reject };
}

export async function remainsPending(operation: Promise<unknown>): Promise<boolean> {
	const marker = Symbol('pending');
	return await Promise.race([
		operation.then(() => false, () => false),
		new Promise<typeof marker>((resolve) => { setImmediate(() => { resolve(marker); }); }),
	]) === marker;
}
