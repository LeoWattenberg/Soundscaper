/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	constantTimeEqual,
	decryptOAuthSecret,
	encodeBase64Url,
	encryptOAuthSecret,
	hashCapability,
	randomCapability,
} from '../functions/api/freesound/_shared/oauth-crypto.ts';

const MASTER_KEY = `v1:${encodeBase64Url(Uint8Array.from({ length: 32 }, (_value, index) => index))}`;

test('OAuth secrets round-trip only with the configured key and matching field context', async () => {
	const encrypted = await encryptOAuthSecret('rotating-refresh-token', MASTER_KEY, 'grant-42:refresh');

	assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
	assert.equal(await decryptOAuthSecret(encrypted, MASTER_KEY, 'grant-42:refresh'), 'rotating-refresh-token');
	await assert.rejects(
		decryptOAuthSecret(encrypted, MASTER_KEY, 'grant-42:access'),
		/could not be authenticated/u,
	);
	await assert.rejects(
		decryptOAuthSecret(encrypted, `v1:${encodeBase64Url(new Uint8Array(32).fill(9))}`, 'grant-42:refresh'),
		/could not be authenticated/u,
	);
});

test('OAuth capabilities use fixed-size URL-safe randomness and stable hashes', async () => {
	const first = randomCapability();
	const second = randomCapability();

	assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
	assert.match(second, /^[A-Za-z0-9_-]{43}$/u);
	assert.notEqual(first, second);
	assert.equal(await hashCapability(first), await hashCapability(first));
	assert.notEqual(await hashCapability(first), await hashCapability(second));
	assert.equal(constantTimeEqual('same', 'same'), true);
	assert.equal(constantTimeEqual('same', 'different'), false);
});

test('OAuth master keys are explicitly versioned 256-bit values', async () => {
	await assert.rejects(encryptOAuthSecret('token', 'plain-text-secret', 'field'), /not configured/u);
	await assert.rejects(encryptOAuthSecret('token', 'v1:short', 'field'), /not configured/u);
});
