/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	bindFramescaperSelectedFreezeCapture,
	bindFramescaperSelectedFreezeCaptureFinishing,
	framescaperSelectedFreezeCaptureFinishingFor,
} from '../src/framescaper/editor-selected-finishing-freeze-capture.ts';

function port(label: string): never {
	return { capture: () => label } as unknown as never;
}

test('an owner with no bound capture port resolves to null', () => {
	assert.equal(framescaperSelectedFreezeCaptureFinishingFor({}), null);
});

test('a bound capture port is resolved for its own owner only', () => {
	const owner = {};
	const other = {};
	const capture = port('capture');

	bindFramescaperSelectedFreezeCaptureFinishing(owner, capture);

	assert.equal(framescaperSelectedFreezeCaptureFinishingFor(owner), capture);
	assert.equal(framescaperSelectedFreezeCaptureFinishingFor(other), null);
});

test('releasing the current binding clears it and stays idempotent', () => {
	const owner = {};
	const release = bindFramescaperSelectedFreezeCaptureFinishing(owner, port('capture'));

	release();
	assert.equal(framescaperSelectedFreezeCaptureFinishingFor(owner), null);

	release();
	assert.equal(framescaperSelectedFreezeCaptureFinishingFor(owner), null);
});

test('a stale release never unbinds the port that replaced it', () => {
	const owner = {};
	const first = port('first');
	const second = port('second');

	const releaseFirst = bindFramescaperSelectedFreezeCaptureFinishing(owner, first);
	bindFramescaperSelectedFreezeCaptureFinishing(owner, second);
	assert.equal(framescaperSelectedFreezeCaptureFinishingFor(owner), second);

	releaseFirst();

	assert.equal(
		framescaperSelectedFreezeCaptureFinishingFor(owner),
		second,
		'a superseded release must not tear down its successor',
	);
});

test('binding requires an object owner and a callable capture port', () => {
	assert.throws(
		() => bindFramescaperSelectedFreezeCaptureFinishing(null as unknown as object, port('capture')),
		TypeError,
	);
	assert.throws(
		() => bindFramescaperSelectedFreezeCaptureFinishing('owner' as unknown as object, port('capture')),
		TypeError,
	);
	assert.throws(
		() => bindFramescaperSelectedFreezeCaptureFinishing({}, null as unknown as never),
		TypeError,
	);
	assert.throws(
		() => bindFramescaperSelectedFreezeCaptureFinishing({}, {} as unknown as never),
		TypeError,
	);
	assert.throws(
		() => bindFramescaperSelectedFreezeCaptureFinishing({}, { capture: 1 } as unknown as never),
		TypeError,
	);
});

test('the shortened binding name is the same registration entry point', () => {
	assert.equal(bindFramescaperSelectedFreezeCapture, bindFramescaperSelectedFreezeCaptureFinishing);
});
