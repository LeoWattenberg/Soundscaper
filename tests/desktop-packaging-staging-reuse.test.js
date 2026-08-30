/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	stageVerifiedNativeAddonPayload,
	verifyNativeAddonPayloadManifest,
} from '../scripts/lib/native-addon-payload-manifest.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const PAYLOAD_MANIFEST_MODULE = 'scripts/lib/native-addon-payload-manifest.mjs';
const BUILT_TARGET = 'linux-x64';

function readModule(path) {
	return readFile(resolve(repositoryRoot, path), 'utf8');
}

test('the native payload manifest validates paths with the shared runtime-manifest rules', async () => {
	const source = await readModule(PAYLOAD_MANIFEST_MODULE);
	assert.match(source, /import \{[^}]*\bassertSafeRelativePath\b[^}]*\} from '\.\/ffmpeg-runtime-manifest\.mjs';/u);
	assert.match(source, /import \{[^}]*\bcanonicalJson\b[^}]*\} from '\.\/ffmpeg-runtime-manifest\.mjs';/u);
	assert.doesNotMatch(source, /function assertSafeRelativePath/u);
	assert.doesNotMatch(source, /function canonicalJson/u);
});

test('the native payload stager publishes through the shared exclusive rename', async () => {
	const source = await readModule(PAYLOAD_MANIFEST_MODULE);
	assert.match(source, /import \{ renameIntoPlaceExclusively \} from '\.\/exclusive-rename\.mjs';/u);
	assert.doesNotMatch(source, /mkdtemp/u);
	assert.doesNotMatch(source, /function assertPathMissing/u);
});

test('staging never overwrites an already published native addon payload', async (context) => {
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot, target: BUILT_TARGET });
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-native-restage-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const outputRoot = join(root, 'runtime', 'native', BUILT_TARGET);
	assert.equal((await stageVerifiedNativeAddonPayload({ release, outputRoot })).target, BUILT_TARGET);
	await assert.rejects(
		() => stageVerifiedNativeAddonPayload({ release, outputRoot }),
		/native addon payload output already exists/u,
	);
});

test('the desktop packaging scripts take the staged native prefix from the manifest', async () => {
	for (const path of [
		'scripts/desktop-prepare.mjs',
		'scripts/desktop-before-pack.mjs',
		'scripts/desktop-after-pack.mjs',
	]) {
		const source = await readModule(path);
		assert.doesNotMatch(source, /runtime\/native|[`'"]native\//u, `${path} must not hardcode the staged native prefix`);
		assert.match(
			source,
			/nativeAddonPayloadOutputRoot|NATIVE_ADDON_RUNTIME_PREFIX/u,
			`${path} must derive the staged native prefix from the payload manifest`,
		);
	}
});

test('every guarded desktop staging copy disables overwrite', async () => {
	const source = await readModule('scripts/desktop-prepare.mjs');
	const optionBlocks = [...source.matchAll(/\bcp\([^;]*?\{([^}]*errorOnExist: true[^}]*)\}\)/gu)]
		.map((match) => match[1]);

	assert.equal(optionBlocks.length, 3);
	assert.ok(optionBlocks.every((options) => /\bforce: false\b/u.test(options)));
});
