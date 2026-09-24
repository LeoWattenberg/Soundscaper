/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFreesoundImportService } from '../src/common/editor/controller/import/freesound-import-service.ts';

function searchWith(response: Response) {
	return createFreesoundImportService({
		enabled: true,
		apiBaseUrl: 'https://soundscaper.org',
		createContributionId: () => 'unused',
		importFile: async () => undefined,
		fetch: async () => response,
	}).search({ query: 'rain' });
}

test('Freesound search keeps upstream error details and status for failed proxy responses', async () => {
	await assert.rejects(searchWith(Response.json({ error: { message: 'Proxy maintenance' } }, {
		status: 503,
	})), /Proxy maintenance \(503\)/u);
	await assert.rejects(searchWith(new Response('not JSON', { status: 502 })),
		/Freesound request failed \(502\)/u);
});

test('Freesound search refuses oversized or malformed JSON before normalizing sounds', async () => {
	await assert.rejects(searchWith(new Response(null, { headers: {
		'Content-Length': String(3 * 1_024 * 1_024),
	} })), /response was too large/u);
	await assert.rejects(searchWith(new Response('{', { headers: {
		'Content-Type': 'application/json',
	} })), /not valid JSON/u);
});

test('Freesound search requires an HTTPS proxy outside loopback', () => {
	assert.throws(() => createFreesoundImportService({
		enabled: true,
		apiBaseUrl: 'http://soundscaper.org',
		createContributionId: () => 'unused',
		importFile: async () => undefined,
		fetch: async () => assert.fail('must not request an insecure proxy'),
	}), /must use HTTPS/u);
});
