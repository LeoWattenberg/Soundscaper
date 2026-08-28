/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertMatchingCapturedVideoProxyAttachment,
	capturedVideoProxyAbortError,
	capturedVideoProxySource,
	throwIfCapturedVideoProxyAborted,
} from '../src/framescaper/editor-captured-video-proxy-scheduler-guards.ts';

type Data = Record<string, unknown>;

function project(sources: readonly Data[]): never {
	return { sources } as unknown as never;
}

test('the single matching video source is returned with its attachment', () => {
	const source = { id: 'source-1', kind: 'video', proxyAttachment: null };

	assert.equal(
		capturedVideoProxySource(project([source, { id: 'source-2', kind: 'video' }]), 'source-1'),
		source,
	);
});

test('a missing, duplicated or non-video source identity is refused', () => {
	assert.throws(() => capturedVideoProxySource(project([]), 'source-1'), ReferenceError);
	assert.throws(
		() => capturedVideoProxySource(
			project([{ id: 'source-1', kind: 'video' }, { id: 'source-1', kind: 'video' }]),
			'source-1',
		),
		ReferenceError,
	);
	assert.throws(
		() => capturedVideoProxySource(project([{ id: 'source-1', kind: 'audio' }]), 'source-1'),
		ReferenceError,
	);
});

test('an attachment is accepted only when it names the same original digest', () => {
	assert.doesNotThrow(() => assertMatchingCapturedVideoProxyAttachment(
		{ proxyAttachment: { originalSha256: 'a'.repeat(64) } },
		'a'.repeat(64),
	));
	assert.throws(() => assertMatchingCapturedVideoProxyAttachment(
		{ proxyAttachment: { originalSha256: 'b'.repeat(64) } },
		'a'.repeat(64),
	), /different source generation/u);
	assert.throws(
		() => assertMatchingCapturedVideoProxyAttachment({ proxyAttachment: null }, 'a'.repeat(64)),
		/different source generation/u,
	);
});

test('the synthesized cancellation error is a named AbortError carrying its message', () => {
	const error = capturedVideoProxyAbortError('Captured proxy work stopped.');

	assert.equal(error.name, 'AbortError');
	assert.equal(error.message, 'Captured proxy work stopped.');
});

test('an unaborted signal passes the cancellation guard', () => {
	assert.doesNotThrow(() => throwIfCapturedVideoProxyAborted(new AbortController().signal));
});

test('an aborted signal rethrows its own reason rather than a synthesized error', () => {
	const controller = new AbortController();
	const reason = new Error('the caller stopped this render');
	controller.abort(reason);

	assert.throws(() => throwIfCapturedVideoProxyAborted(controller.signal), (error: unknown) => {
		assert.equal(error, reason);
		return true;
	});
});

test('an aborted signal without a reason falls back to a named AbortError', () => {
	const signal = { aborted: true, reason: undefined } as unknown as AbortSignal;

	assert.throws(() => throwIfCapturedVideoProxyAborted(signal), (error: unknown) => {
		assert.equal((error as Error).name, 'AbortError');
		return true;
	});
});
