/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { createFramescaperMediaReviewPayloadPorts } from '../desktop/framescaper-media-review-policy.mjs';

test('media readiness resolves only its independent development policy usage', async (context) => {
	const fixture = await reviewFixture(context, false);
	assert.equal((await fixture.ports.resolveReviewPublicKey(
		'linux-x64', 'media-reviewer',
	))?.asymmetricKeyType, 'ed25519');
	assert.equal(await fixture.ports.resolveReviewPublicKey('win-x64', 'media-reviewer'), null);
});

test('packaged media readiness ignores app, OpenFX, and package-signing keys', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-media-review-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const applicationRoot = join(root, 'application');
	const resourcesPath = join(root, 'resources');
	await writePolicy(join(applicationRoot, 'config/milestone-5-native-isolation-review-policy.json'),
		'wrong-app-key', 'framescaper-media-host-production-readiness');
	await writePolicy(join(resourcesPath,
		'runtime/native/framescaper-media-host/linux-x64/milestone-5-native-isolation-review-policy.json'),
	'media-reviewer', 'framescaper-media-host-production-readiness');
	const ports = createFramescaperMediaReviewPayloadPorts({
		applicationRoot, packaged: true, resourcesPath, platform: 'linux', arch: 'x64',
	});
	assert.equal((await ports.resolveReviewPublicKey('linux-x64', 'media-reviewer'))?.asymmetricKeyType,
		'ed25519');
	assert.equal(await ports.resolveReviewPublicKey('linux-x64', 'wrong-app-key'), null);
});

async function reviewFixture(context, packaged) {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-media-review-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const applicationRoot = join(root, 'application');
	const resourcesPath = join(root, 'resources');
	await writePolicy(join(applicationRoot, 'config/milestone-5-native-isolation-review-policy.json'),
		'media-reviewer', 'framescaper-media-host-production-readiness');
	return {
		ports: createFramescaperMediaReviewPayloadPorts({
			applicationRoot, packaged, resourcesPath, platform: 'linux', arch: 'x64',
		}),
	};
}

async function writePolicy(path, id, usage) {
	const { publicKey } = generateKeyPairSync('ed25519');
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify({
		schemaVersion: 1,
		algorithm: 'Ed25519',
		trustedKeys: [{
			id, status: 'accepted', usages: [usage], targets: ['linux-x64'],
			publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }),
		}],
		blockedBy: 'An independent native-isolation review is required before any packaged media execution.',
	}));
}
