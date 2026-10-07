/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnosticErrorMessage } from '../scripts/lib/diagnostic-error-message.ts';

void test('tooling diagnostics preserve Error messages without adding their names', () => {
	assert.equal(diagnosticErrorMessage(new TypeError('refused')), 'refused');
	assert.equal(diagnosticErrorMessage(new Error('')), '');
	assert.equal(diagnosticErrorMessage(new AggregateError([], 'cleanup')), 'cleanup');
});

void test('tooling diagnostics use string coercion for every other thrown value', () => {
	assert.equal(diagnosticErrorMessage(null), 'null');
	assert.equal(diagnosticErrorMessage(undefined), 'undefined');
	assert.equal(diagnosticErrorMessage(false), 'false');
	assert.equal(diagnosticErrorMessage(0), '0');
	assert.equal(diagnosticErrorMessage(Symbol('refused')), 'Symbol(refused)');
	assert.equal(diagnosticErrorMessage({ message: 'not an Error' }), '[object Object]');
	assert.equal(diagnosticErrorMessage({ toString: () => 'custom failure' }), 'custom failure');
});
