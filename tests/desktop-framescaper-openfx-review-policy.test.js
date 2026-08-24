/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { createFramescaperOpenFxReviewPayloadPorts } from '../desktop/framescaper-openfx-review-policy.mjs';

test('development OpenFX readiness resolves only the independent app policy', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-ofx-review-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const applicationRoot = join(root, 'application');
	const resourcesPath = join(root, 'resources');
	const path = join(applicationRoot, 'config/milestone-5-native-isolation-review-policy.json');
	await writePolicy(path);
	const ports = createFramescaperOpenFxReviewPayloadPorts({
		applicationRoot, packaged: false, resourcesPath, platform: 'linux', arch: 'x64',
	});
	assert.equal((await ports.resolveReviewPublicKey(
		'linux-x64', 'framescaper-reviewer',
	))?.asymmetricKeyType, 'ed25519');
	assert.equal(await ports.resolveReviewPublicKey('win-x64', 'framescaper-reviewer'), null);
});

test('packaged OpenFX readiness ignores app and package-signing keys', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-ofx-review-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const applicationRoot = join(root, 'application');
	const resourcesPath = join(root, 'resources');
	await writePolicy(join(applicationRoot, 'config/milestone-5-native-isolation-review-policy.json'), {
		id: 'wrong-app-key', usage: 'framescaper-openfx-production-readiness',
	});
	const packagedPolicy = join(resourcesPath, 'runtime/native/framescaper-openfx-host/linux-x64',
		'milestone-5-native-isolation-review-policy.json');
	await writePolicy(packagedPolicy);
	const ports = createFramescaperOpenFxReviewPayloadPorts({
		applicationRoot, packaged: true, resourcesPath, platform: 'linux', arch: 'x64',
	});
	assert.equal((await ports.resolveReviewPublicKey(
		'linux-x64', 'framescaper-reviewer',
	))?.asymmetricKeyType, 'ed25519');
	assert.equal(await ports.resolveReviewPublicKey('linux-x64', 'wrong-app-key'), null);
});

async function writePolicy(path, overrides = {}) {
	const { publicKey } = generateKeyPairSync('ed25519');
	const id = overrides.id ?? 'framescaper-reviewer';
	const usage = overrides.usage ?? 'framescaper-openfx-production-readiness';
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify({
		schemaVersion: 1,
		algorithm: 'Ed25519',
		trustedKeys: [{
			id, status: 'accepted', usages: [usage], targets: ['linux-x64'],
			publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }),
		}],
		blockedBy: 'An independent native-isolation review is required before any packaged third-party execution.',
	}));
}
