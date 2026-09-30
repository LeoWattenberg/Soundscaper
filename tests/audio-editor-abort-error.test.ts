/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAbortGuard,
	throwIfAborted,
} from '../src/common/editor/abort-error.ts';

test('shared abort checks preserve reasons and exact owner messages', () => {
	assert.doesNotThrow(() => throwIfAborted(undefined, 'Unused cancellation message.'));
	assert.doesNotThrow(() => throwIfAborted(new AbortController().signal, 'Unused cancellation message.'));

	const reason = Symbol('owner cancellation');
	assert.deepEqual(captureThrown(() => throwIfAborted(abortedSignal(reason), 'Unused cancellation message.')), {
		threw: true,
		error: reason,
	});
	assert.deepEqual(captureThrown(() => throwIfAborted(abortedSignal(null), 'Unused cancellation message.')), {
		threw: true,
		error: null,
	});

	const error = captureThrown(() => throwIfAborted(abortedSignal(undefined), 'Exact owner cancellation.'));
	assert.equal(error.threw, true);
	assert.equal((error.error as Error).name, 'AbortError');
	assert.equal((error.error as Error).message, 'Exact owner cancellation.');
	assert.equal(error.error instanceof DOMException, true);

	const guard = createAbortGuard('Fixed owner cancellation.');
	const guardedError = captureThrown(() => guard(abortedSignal(undefined)));
	assert.equal((guardedError.error as Error).name, 'AbortError');
	assert.equal((guardedError.error as Error).message, 'Fixed owner cancellation.');
});

test('shared abort checks retain the Error fallback when DOMException is unavailable', () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'DOMException');
	Object.defineProperty(globalThis, 'DOMException', { configurable: true, writable: true, value: undefined });
	try {
		const outcome = captureThrown(() => throwIfAborted(abortedSignal(undefined), 'Fallback cancellation.'));
		assert.equal(outcome.threw, true);
		assert.equal(outcome.error instanceof Error, true);
		assert.equal((outcome.error as Error).name, 'AbortError');
		assert.equal((outcome.error as Error).message, 'Fallback cancellation.');
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'DOMException', descriptor);
		else Reflect.deleteProperty(globalThis, 'DOMException');
	}
});

function abortedSignal(reason: unknown): AbortSignal {
	return { aborted: true, reason } as AbortSignal;
}

function captureThrown(operation: () => void): Readonly<{ threw: boolean; error: unknown }> {
	try {
		operation();
		return Object.freeze({ threw: false, error: undefined });
	} catch (error) {
		return Object.freeze({ threw: true, error });
	}
}
