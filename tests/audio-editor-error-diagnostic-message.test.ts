/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { errorDiagnosticMessage } from '../src/common/editor/error-diagnostic-message.ts';

test('status diagnostics retain every bounded nested AggregateError cause', () => {
	const primary = new Error('encoder rejected frame');
	const cleanup = new AggregateError([
		new Error('output deletion failed'),
		new Error('worker termination failed'),
	], 'cleanup failed');
	const failure = new AggregateError([primary, cleanup], 'video operation failed');
	assert.equal(errorDiagnosticMessage(failure, 'unknown'), [
		'video operation failed', 'encoder rejected frame', 'cleanup failed',
		'output deletion failed', 'worker termination failed',
	].join(' → '));
});

test('status diagnostics tolerate cycles and empty values', () => {
	const cyclic: { message: string; cause?: unknown } = { message: 'outer' };
	cyclic.cause = cyclic;
	assert.equal(errorDiagnosticMessage(cyclic, 'unknown'), 'outer');
	assert.equal(errorDiagnosticMessage(null, 'unknown'), 'unknown');
});

test('status diagnostics retain native DOMException prototype messages', () => {
	assert.equal(
		errorDiagnosticMessage(new DOMException('capture cancelled', 'AbortError'), 'unknown'),
		'capture cancelled',
	);
});

test('status diagnostics never invoke hostile error accessors', () => {
	const hostile = Object.create(null) as Record<string, unknown>;
	for (const key of ['message', 'errors', 'cause']) {
		Object.defineProperty(hostile, key, {
			enumerable: true,
			get(): never { throw new Error(`${key} getter must not run`); },
		});
	}
	assert.equal(errorDiagnosticMessage(hostile, 'unknown'), 'unknown');
});

test('status diagnostics bound adversarial aggregate breadth', () => {
	const failure = new AggregateError(
		Array.from({ length: 100 }, (_, index) => new Error(`failure ${String(index)}`)),
		'outer',
	);
	const messages = errorDiagnosticMessage(failure, 'unknown').split(' → ');
	assert.equal(messages.length, 32);
	assert.equal(messages[0], 'outer');
	assert.equal(messages.at(-1), 'failure 30');
});
