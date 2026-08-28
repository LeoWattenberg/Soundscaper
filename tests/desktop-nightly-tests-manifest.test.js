/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readDesktopNightlyTestsSourceRevision } from '../desktop/nightly-tests-manifest.mjs';

test('nightly test launcher reads the source revision from its staged manifest', async (context) => {
	const payloadRoot = await createPayloadRoot(context);
	const sourceRevision = 'a'.repeat(40);
	await writeManifest(payloadRoot, { sourceRevision });

	assert.equal(await readDesktopNightlyTestsSourceRevision({
		payloadRoot,
		applicationVersion: '1.0.0-rc.1',
	}), sourceRevision);

	await writeManifest(payloadRoot, { sourceRevision: null });
	assert.equal(await readDesktopNightlyTestsSourceRevision({
		payloadRoot,
		applicationVersion: '1.0.0-rc.1',
	}), null);
});

test('nightly test launcher rejects malformed or mismatched staged manifests', async (context) => {
	const payloadRoot = await createPayloadRoot(context);
	const cases = [
		[{ schemaVersion: 2 }, /schema version/iu],
		[{ kind: 'not-soundscaper' }, /kind/iu],
		[{ applicationVersion: '9.9.9' }, /application version/iu],
		[{ sourceRevision: 'A'.repeat(40) }, /source revision/iu],
	];
	for (const [override, expected] of cases) {
		await writeManifest(payloadRoot, override);
		await assert.rejects(
			() => readDesktopNightlyTestsSourceRevision({
				payloadRoot,
				applicationVersion: '1.0.0-rc.1',
			}),
			expected,
		);
	}

	await writeFile(join(payloadRoot, 'stage-manifest.json'), '{', 'utf8');
	await assert.rejects(
		() => readDesktopNightlyTestsSourceRevision({
			payloadRoot,
			applicationVersion: '1.0.0-rc.1',
		}),
		/stage manifest is not valid JSON/iu,
	);
});

async function createPayloadRoot(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-manifest-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

async function writeManifest(payloadRoot, override) {
	const manifest = {
		schemaVersion: 1,
		kind: 'soundscaper-desktop-nightly-tests',
		applicationVersion: '1.0.0-rc.1',
		sourceRevision: 'a'.repeat(40),
		...override,
	};
	await writeFile(join(payloadRoot, 'stage-manifest.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
}
