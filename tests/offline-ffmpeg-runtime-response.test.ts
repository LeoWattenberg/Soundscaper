/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	hasEncodedWireRepresentation,
	readBoundedResponse,
	throwIfAborted,
} from '../src/common/offline/ffmpeg-runtime-response.ts';

const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function bytesResponse(
	bytes: Uint8Array,
	headers: Readonly<Record<string, string>> = {},
): Response {
	return new Response(new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	}), { status: 200, headers });
}

test('a verified bounded response checks both its decoded byte count and digest', async () => {
	const bytes = new TextEncoder().encode('abc');
	const result = await readBoundedResponse(bytesResponse(bytes, {
		'content-length': '3',
	}), {
		expectedBytes: 3,
		expectedSha256: ABC_SHA256,
		label: 'Runtime manifest',
		maximumBytes: 16,
	});
	assert.deepEqual(result, bytes);

	await assert.rejects(() => readBoundedResponse(bytesResponse(bytes), {
		expectedSha256: '0'.repeat(64),
		label: 'Runtime manifest',
		maximumBytes: 16,
	}), /SHA-256/u);
});

test('an invalid declared length is rejected and its unread body is cancelled', async () => {
	const cancelled: unknown[] = [];
	const response = new Response(new ReadableStream<Uint8Array>({
		pull(controller) { controller.enqueue(Uint8Array.of(1)); },
		cancel(reason) { cancelled.push(reason); },
	}), { headers: { 'content-length': '3.5' } });

	await assert.rejects(() => readBoundedResponse(response, {
		label: 'Runtime pointer',
		maximumBytes: 16,
	}), /invalid Content-Length/u);
	assert.equal(cancelled.length, 1);
	assert.match(String(cancelled[0]), /invalid Content-Length/u);
});

test('encoded wire length is not mistaken for the decoded body length', async () => {
	const response = bytesResponse(new TextEncoder().encode('abc'), {
		'content-encoding': 'br',
		'content-length': '1',
	});
	assert.equal(hasEncodedWireRepresentation(response), true);
	assert.deepEqual(await readBoundedResponse(response, {
		expectedBytes: 3,
		label: 'Encoded runtime manifest',
		maximumBytes: 3,
	}), new TextEncoder().encode('abc'));

	assert.equal(hasEncodedWireRepresentation(new Response('x', {
		headers: { 'content-encoding': 'identity, identity' },
	})), false);
});

test('a response without a readable body is rejected explicitly', async () => {
	await assert.rejects(() => readBoundedResponse(new Response(null), {
		label: 'Runtime pointer',
		maximumBytes: 16,
	}), /no readable body/u);
});

test('empty stream chunks are refused instead of obscuring stream progress', async () => {
	const response = new Response(new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array());
			controller.close();
		},
	}));
	await assert.rejects(() => readBoundedResponse(response, {
		label: 'Runtime pointer',
		maximumBytes: 16,
	}), /invalid response chunk/u);
});

test('aborting interrupts a body read that has not produced another chunk', async () => {
	let closeStream = (): void => undefined;
	const cancelled: unknown[] = [];
	const response = new Response(new ReadableStream<Uint8Array>({
		start(controller) { closeStream = () => { controller.close(); }; },
		pull: () => new Promise<void>(() => {}),
		cancel(reason) { cancelled.push(reason); },
	}));
	const abort = new AbortController();
	const failure = new DOMException('cancelled by the user', 'AbortError');
	const reading = readBoundedResponse(response, {
		label: 'Runtime payload',
		maximumBytes: 16,
		signal: abort.signal,
	});
	abort.abort(failure);
	const outcome = await Promise.race([
		reading.then(() => 'resolved', (error: unknown) => error),
		new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 50)),
	]);
	if (outcome === 'timeout') closeStream();
	assert.notEqual(outcome, 'timeout', 'abort must not wait for the network stream to produce a chunk');
	assert.equal(outcome, failure);
	assert.deepEqual(cancelled, [failure]);
});

test('abort helpers preserve an explicit reason and synthesize the default otherwise', () => {
	const explicit = new AbortController();
	const reason = new Error('stop now');
	explicit.abort(reason);
	assert.throws(() => throwIfAborted(explicit.signal), (error: unknown) => error === reason);

	const absent = { aborted: true, reason: undefined } as AbortSignal;
	assert.throws(() => throwIfAborted(absent), { name: 'AbortError' });
	assert.doesNotThrow(() => throwIfAborted(undefined));
});
