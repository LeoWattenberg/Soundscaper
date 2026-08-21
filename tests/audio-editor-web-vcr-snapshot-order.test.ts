/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperWebVcrSnapshotOrder,
} from '../src/common/editor/controller/framescaper-web-vcr-snapshot-order.ts';

const snapshot = (
	generation: number,
	sessionId: string | null,
	phase: 'ready' | 'recording' | 'closed' = sessionId === null ? 'closed' : 'ready',
) => Object.freeze({ generation, sessionId, phase });

test('snapshot order rejects delayed generations and same-generation foreign sessions', () => {
	const order = createFramescaperWebVcrSnapshotOrder();
	assert.equal(order.accept(snapshot(7, 'session-a')), true);
	assert.equal(order.accept(snapshot(6, 'session-old')), false);
	assert.equal(order.accept(snapshot(7, 'session-b')), false);
	assert.equal(order.accept(snapshot(7, 'session-a', 'recording')), true);
	assert.equal(order.generation, 7);
});

test('a terminal generation cannot be resurrected and a newer session remains authoritative', () => {
	const order = createFramescaperWebVcrSnapshotOrder();
	assert.equal(order.accept(snapshot(7, 'session-a')), true);
	assert.equal(order.accept(snapshot(7, null)), true);
	assert.equal(order.accept(snapshot(7, 'session-a')), false);
	assert.equal(order.accept(snapshot(8, 'session-b')), true);
	assert.equal(order.accept(snapshot(7, null)), false);
	assert.equal(order.accept(snapshot(8, 'session-b', 'recording')), true);
});

test('initial closed state is idempotent until a newer generation opens', () => {
	const order = createFramescaperWebVcrSnapshotOrder();
	assert.equal(order.accept(snapshot(0, null)), true);
	assert.equal(order.accept(snapshot(0, null)), true);
	assert.equal(order.accept(snapshot(0, 'invalid-same-generation')), false);
	assert.equal(order.accept(snapshot(1, 'session-a')), true);
	assert.equal(order.generation, 1);
});
