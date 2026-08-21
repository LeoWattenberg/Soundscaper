/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperWebVcrCaptureAuthorityV1,
} from '../desktop/framescaper-web-vcr-capture-authority.ts';

const OWNER = Object.freeze(Object.create(null)) as object;
const OTHER_OWNER = Object.freeze(Object.create(null)) as object;
const SESSION_ID = 'a'.repeat(32);

test('guest capture authority is owner-bound, generation-bound, one-shot, and expires after ten seconds', () => {
	const harness = authority();
	const guestFrame = Object.freeze({ routingId: 17 });
	const grant = harness.value.prepare(OWNER, guestFrame, {
		version: 1, sessionId: SESSION_ID, generation: 2,
	});
	assert.deepEqual(grant, {
		version: 1,
		grantId: '00000000000000000000000000000001',
		sessionId: SESSION_ID,
		generation: 2,
		expiresAtMs: 11_000,
	});
	const request = {
		version: 1 as const,
		sessionId: SESSION_ID,
		generation: 2,
		userGesture: true,
		videoRequested: true,
		audioRequested: true,
	};
	assert.equal(harness.value.consume(OTHER_OWNER, request), null);
	assert.equal(harness.value.consume(OWNER, { ...request, generation: 1 }), null);
	assert.equal(harness.value.consume(OWNER, { ...request, userGesture: false }), null);
	assert.deepEqual(harness.value.consume(OWNER, request), {
		video: guestFrame,
		audio: guestFrame,
		enableLocalEcho: false,
	});
	assert.equal(harness.value.consume(OWNER, request), null);

	harness.value.prepare(OWNER, guestFrame, { version: 1, sessionId: SESSION_ID, generation: 3 });
	harness.advance(10_000);
	assert.equal(harness.value.consume(OWNER, { ...request, generation: 3 }), null);
});

test('new generations revoke old grants and teardown cannot cross owners or generations', () => {
	const harness = authority();
	const firstFrame = { frame: 1 };
	const secondFrame = { frame: 2 };
	harness.value.prepare(OWNER, firstFrame, { version: 1, sessionId: SESSION_ID, generation: 1 });
	harness.value.prepare(OWNER, secondFrame, { version: 1, sessionId: SESSION_ID, generation: 2 });
	assert.equal(harness.value.consume(OWNER, {
		version: 1, sessionId: SESSION_ID, generation: 1, userGesture: true,
		videoRequested: true, audioRequested: true,
	}), null);
	assert.equal(harness.value.teardown(OTHER_OWNER, 2), false);
	assert.equal(harness.value.teardown(OWNER, 1), false);
	assert.equal(harness.value.teardown(OWNER, 2), true);
	assert.equal(harness.value.consume(OWNER, {
		version: 1, sessionId: SESSION_ID, generation: 2, userGesture: true,
		videoRequested: true, audioRequested: true,
	}), null);
	assert.throws(() => harness.value.prepare(OWNER, secondFrame, {
		version: 1, sessionId: SESSION_ID, generation: 1,
	}), /current session|newer generation/iu);
});

test('one guest session may prepare sequential grants but cannot replace a live grant', () => {
	const harness = authority();
	const reference = { version: 1, sessionId: SESSION_ID, generation: 1 };
	harness.value.prepare(OWNER, { frame: 1 }, reference);
	assert.throws(() => harness.value.prepare(OWNER, { frame: 2 }, reference), /live one-shot/iu);
	assert.ok(harness.value.consume(OWNER, {
		...reference, userGesture: true, videoRequested: true, audioRequested: true,
	}));
	const second = harness.value.prepare(OWNER, { frame: 2 }, reference);
	assert.equal(second.grantId, '00000000000000000000000000000002');
	assert.throws(() => harness.value.prepare(OWNER, { frame: 3 }, {
		...reference, sessionId: 'c'.repeat(32),
	}), /current session|generation/iu);
});

test('the sole display handler can claim a pending guest grant without renderer-supplied IDs', () => {
	const consumed: unknown[] = [];
	const nowMs = 1_000;
	const value = createFramescaperWebVcrCaptureAuthorityV1({
		now: () => nowMs,
		createOpaqueId: () => 'd'.repeat(32),
		onConsumed: (owner, reference) => consumed.push({ owner, reference }),
	});
	const frame = { routingId: 41 };
	value.prepare(OWNER, frame, { version: 1, sessionId: SESSION_ID, generation: 1 });
	assert.equal(value.hasPending(OWNER), true);
	assert.equal(value.consumeCurrent(OWNER, {
		userGesture: false, videoRequested: true, audioRequested: true,
	}), null, 'a malformed request is handled and cannot fall through to device capture');
	assert.deepEqual(value.consumeCurrent(OWNER, {
		userGesture: true, videoRequested: true, audioRequested: true,
	}), { video: frame, audio: frame, enableLocalEcho: false });
	assert.equal(value.hasPending(OWNER), false);
	assert.equal(value.consumeCurrent(OWNER, {
		userGesture: true, videoRequested: true, audioRequested: true,
	}), undefined);
	assert.deepEqual(consumed, [{
		owner: OWNER,
		reference: { version: 1, sessionId: SESSION_ID, generation: 1 },
	}]);
});

test('disposal and owner revocation retire guest frame references', () => {
	const harness = authority();
	harness.value.prepare(OWNER, {}, { version: 1, sessionId: SESSION_ID, generation: 1 });
	assert.equal(harness.value.revokeOwner(OWNER), true);
	assert.equal(harness.value.revokeOwner(OWNER), false);
	harness.value.prepare(OTHER_OWNER, {}, { version: 1, sessionId: 'b'.repeat(32), generation: 1 });
	harness.value.dispose();
	assert.equal(harness.value.consume(OTHER_OWNER, {
		version: 1, sessionId: 'b'.repeat(32), generation: 1, userGesture: true,
		videoRequested: true, audioRequested: true,
	}), null);
	assert.throws(() => harness.value.prepare(OTHER_OWNER, {}, {
		version: 1, sessionId: 'b'.repeat(32), generation: 2,
	}), /disposed/iu);
});

function authority() {
	let nowMs = 1_000;
	let nextId = 1;
	const value = createFramescaperWebVcrCaptureAuthorityV1({
		now: () => nowMs,
		createOpaqueId: () => (nextId++).toString(16).padStart(32, '0'),
	});
	return { value, advance: (milliseconds: number) => { nowMs += milliseconds; } };
}
