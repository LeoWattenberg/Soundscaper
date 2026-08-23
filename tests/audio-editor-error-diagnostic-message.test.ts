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
