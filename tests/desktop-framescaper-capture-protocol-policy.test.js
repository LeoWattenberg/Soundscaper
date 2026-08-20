/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createProtocolHandler } from '../desktop/protocol.js';

const FRAMESCAPER_POLICY =
	'microphone=(self), speaker-selection=(self), display-capture=(self), camera=(self), geolocation=()';
const SOUNDSCAPER_POLICY =
	'microphone=(self), speaker-selection=(self), display-capture=(self), camera=(), geolocation=()';
const DENIED_POLICY =
	'microphone=(), speaker-selection=(), display-capture=(), camera=(), geolocation=()';

test('packaged document capture policy is product- and route-specific', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-capture-policy-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'embed', 'en'), { recursive: true });
	await writeFile(join(root, 'index.html'), '<main>Editor</main>');
	await writeFile(join(root, 'embed', 'en', 'index.html'), '<main>Embedded</main>');
	const framescaper = handler(root, 'framescaper');
	const soundscaper = handler(root, 'soundscaper');

	assert.equal(await policy(framescaper, 'soundscaper-app://bundle/'), FRAMESCAPER_POLICY);
	assert.equal(await policy(soundscaper, 'soundscaper-app://bundle/'), SOUNDSCAPER_POLICY);
	assert.equal(await policy(framescaper, 'soundscaper-app://bundle/embed/en/'), DENIED_POLICY);
	assert.equal(await policy(framescaper, 'https://example.com/'), DENIED_POLICY);
});

function handler(root, productId) {
	return createProtocolHandler({
		productId, rendererRoot: root, runtimeRoot: root, readCapabilities: { get: () => null },
	});
}

async function policy(handlerValue, url) {
	return (await handlerValue(new Request(url))).headers.get('permissions-policy');
}
