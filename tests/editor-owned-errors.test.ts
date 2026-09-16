/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalizedError, formatPresentationMessage, localizedErrorMessage } from '../src/common/i18n/presentation-message.ts';

test('an optional host copy fallback keeps Error behavior and an owned identity for later preview', () => {
	const error = createLocalizedError(TypeError, {}, 'ownedKey', undefined, { fallback: 'Original host fallback' });
	assert.ok(error instanceof TypeError);
	assert.equal(error.message, 'Original host fallback');
	const identity = localizedErrorMessage(error);
	assert.equal(identity?.key, 'ownedKey');
	assert.equal(formatPresentationMessage({ ownedKey: 'Geänderte Meldung' }, identity!), 'Geänderte Meldung');
});
