/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { exchangeAuthorizationCode } from '../functions/api/audiocom/_shared/oauth-provider.ts';

const context = { request: new Request('https://soundscaper.org/api/audiocom/oauth/callback'), env: { AUDIOCOM_CLIENT_ID: 'client' }, params: {} };

test('OAuth operator diagnostics report rejected status without logging provider bodies or credentials', async t => {
	const logged = t.mock.method(console, 'warn', () => {});
	await assert.rejects(exchangeAuthorizationCode(context, 'private-code', 'private-verifier', {
		fetchImpl: async () => Response.json({ error: 'invalid_grant', error_description: 'private-code' }, { status: 400 }),
	}), /rejected/iu);
	assert.equal(logged.mock.callCount(), 1);
	const output = JSON.stringify(logged.mock.calls[0].arguments);
	assert.match(output, /audiocom_oauth_token_rejected/u);
	assert.match(output, /400/u);
	assert.doesNotMatch(output, /private-code|private-verifier|error_description/u);
});

test('malformed token diagnostics retain only field types and numeric expiry', async t => {
	const logged = t.mock.method(console, 'warn', () => {});
	await assert.rejects(exchangeAuthorizationCode(context, 'private-code', 'private-verifier', {
		fetchImpl: async () => Response.json({ token_type: 'Bearer', access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 0 }),
	}), /invalid authorization data/iu);
	assert.equal(logged.mock.callCount(), 1);
	const output = JSON.stringify(logged.mock.calls[0].arguments);
	assert.match(output, /audiocom_oauth_token_invalid/u);
	assert.match(output, /expiresInSeconds/u);
	assert.doesNotMatch(output, /private-access|private-refresh|private-code|private-verifier/u);
});
