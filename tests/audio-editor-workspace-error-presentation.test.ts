/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalizedError } from '../src/common/i18n/presentation-message.ts';
import { workspaceErrorMessage } from '../src/common/editor/ui/workspace/workspace-error-presentation.ts';

test('workspace errors retain message identity while their presentation language changes', () => {
	const english = { genericError: 'The action failed: {message}', unknownError: 'Unknown error', missing: 'Missing {file}' };
	const german = { genericError: 'Fehler: {message}', unknownError: 'Unbekannter Fehler', missing: '{file} fehlt' };
	const error = createLocalizedError(Error, english, 'missing', { file: 'voice.wav' });
	assert.equal(workspaceErrorMessage(error, english), 'The action failed: Missing voice.wav');
	assert.equal(workspaceErrorMessage(error, german), 'Fehler: voice.wav fehlt');
	assert.equal(error.message, 'Missing voice.wav');
	assert.equal(workspaceErrorMessage(error, english), 'The action failed: Missing voice.wav');
});

test('workspace errors preserve nested diagnostics and format unknown failures using current copy', () => {
	const copy = { genericError: 'Failure: {message}', unknownError: 'Unknown failure' };
	assert.equal(workspaceErrorMessage(new Error('Import refused', { cause: new Error('Decoder code 12') }), copy),
		'Failure: Import refused → Decoder code 12');
	assert.equal(workspaceErrorMessage(undefined, copy), 'Failure: Unknown failure');
	assert.equal(workspaceErrorMessage(null, copy), '');
});
