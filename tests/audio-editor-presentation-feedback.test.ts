/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalizedError } from '../src/common/i18n/presentation-message.ts';
import { feedbackFailure, presentationFeedbackText } from '../src/common/editor/ui/presentation-feedback.ts';

test('local feedback keeps its key and parameters while presentation copy changes', () => {
	const message = { key: 'queued', parameters: { count: 3 } };
	assert.equal(presentationFeedbackText(message, { queued: 'Queued {count}' }), 'Queued 3');
	assert.equal(presentationFeedbackText(message, { queued: '{count} eingereiht' }), '3 eingereiht');
	assert.equal(presentationFeedbackText('', {}), '');
});

test('local feedback errors retain tagged wording and bounded external diagnostics', () => {
	const source = { refused: 'File {file} refused' };
	const failure = feedbackFailure(createLocalizedError(Error, source, 'refused', { file: 'clip.wav' }));
	assert.equal(presentationFeedbackText(failure, source), 'File clip.wav refused');
	assert.equal(presentationFeedbackText(failure, { refused: '{file} verweigert' }), 'clip.wav verweigert');
	assert.equal(presentationFeedbackText(feedbackFailure(new Error('Codec refused', { cause: new Error('Code 7') })), {}),
		'Codec refused → Code 7');
});
