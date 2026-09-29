/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { RangeReadAdmission } from '../desktop/read-capability-admission.js';

const OWNER = Object.freeze({ name: 'owner' });

function admission(options = {}) {
	return new RangeReadAdmission({
		hardMaximumCount: 3,
		hardMaximumBytes: 10,
		maximumActiveRequests: 2,
		label: 'Test range',
		...options,
	});
}

test('range admission refuses missing and primitive owners before reserving capacity', () => {
	const gate = admission({ maximumCount: 1 });
	for (const owner of [undefined, null, 0, 'owner', false]) {
		assert.throws(() => gate.reserve(owner), /owner/iu);
	}
	const ticket = gate.reserve(OWNER);
	gate.release(ticket);
});

test('range admission refuses negative, fractional, NaN, infinite, and unsafe charges', () => {
	const gate = admission();
	const ticket = gate.reserve(OWNER);
	for (const size of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => gate.charge(ticket, size), /size|byte|integer/iu, String(size));
	}
	gate.charge(ticket, 10);
	gate.release(ticket);
});

test('range admission refuses forged tickets for charging', () => {
	const gate = admission();
	const ticket = gate.reserve(OWNER);
	assert.throws(() => gate.charge({ state: { bytes: 0 }, charged: false }, 1), /ticket|capability|active/iu);
	gate.charge(ticket, 10);
	gate.release(ticket);
});

test('range admission refuses tickets from another admission for charging', () => {
	const first = admission();
	const second = admission();
	const ticket = first.reserve(OWNER);
	assert.throws(() => second.charge(ticket, 1), /ticket|capability|active/iu);
	first.charge(ticket, 10);
	first.release(ticket);
});

test('range admission cannot release a foreign ticket and free another gate capacity', () => {
	const first = admission({ maximumCount: 1 });
	const second = admission({ maximumCount: 1 });
	const ticket = first.reserve(OWNER);
	assert.throws(() => second.release(ticket), /ticket|capability|active/iu);
	assert.throws(() => first.reserve(OWNER), /count/iu);
	first.release(ticket);
	first.release(ticket);
	const replacement = first.reserve(OWNER);
	first.release(replacement);
});

test('range admission cannot use a forged ticket to release capacity', () => {
	const gate = admission({ maximumCount: 1 });
	const ticket = gate.reserve(OWNER);
	assert.throws(() => gate.release({ state: { count: 1 }, released: false }), /ticket|capability|active/iu);
	assert.throws(() => gate.reserve(OWNER), /count/iu);
	gate.release(ticket);
});

test('range admission cannot be fenced by a foreign ticket', () => {
	const first = admission();
	const second = admission();
	const ticket = first.reserve(OWNER);
	assert.throws(() => second.retainAndFence(ticket), /ticket|capability|active/iu);
	const secondTicket = second.reserve(OWNER);
	second.release(secondTicket);
	first.release(ticket);
});

test('range admission refuses requests on forged and foreign tickets', () => {
	const first = admission();
	const second = admission();
	const ticket = first.reserve(OWNER);
	assert.throws(() => first.acquireRequest({ released: false }), /ticket|capability|active/iu);
	assert.throws(() => second.acquireRequest(ticket), /ticket|capability|active/iu);
	first.release(ticket);
});

test('range admission keeps the active request window bounded and releases it once', () => {
	const gate = admission({ maximumActiveRequests: 1 });
	const ticket = gate.reserve(OWNER);
	const request = gate.acquireRequest(ticket);
	assert.ok(request);
	assert.equal(gate.acquireRequest(ticket), null);
	request.release();
	request.release();
	const next = gate.acquireRequest(ticket);
	assert.ok(next);
	next.release();
	gate.release(ticket);
});

test('range admission fences pending charges and requests after a cleanup failure', () => {
	const gate = admission();
	const retained = gate.reserve(OWNER);
	const pending = gate.reserve(OWNER);
	gate.retainAndFence(retained);
	assert.throws(() => gate.charge(pending, 1), /fenced/iu);
	assert.throws(() => gate.acquireRequest(pending), /fenced/iu);
	assert.throws(() => gate.reserve(OWNER), /fenced/iu);
	gate.release(pending);
});

test('range admission tickets cannot be mutated to erase their accounting', () => {
	const gate = admission({ maximumCount: 1 });
	const ticket = gate.reserve(OWNER);
	assert.equal(Object.isFrozen(ticket), true);
	assert.throws(() => { ticket.released = true; }, TypeError);
	gate.charge(ticket, 10);
	assert.throws(() => { ticket.bytes = 0; }, TypeError);
	assert.throws(() => gate.reserve(OWNER), /count/iu);
	gate.release(ticket);
	const replacement = gate.reserve(OWNER);
	gate.charge(replacement, 10);
	gate.release(replacement);
});
