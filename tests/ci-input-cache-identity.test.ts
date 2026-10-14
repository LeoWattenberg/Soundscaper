/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ciInputCacheIdentity } from '../scripts/lib/ci-input-cache-identity.ts';

test('installed dependency identities bind manifests, patches, toolchain, host and installation policy', t => {
	const root = mkdtempSync(join(tmpdir(), 'ci-input-identity-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const directory of ['handbook', 'patches/npm', 'scripts/lib']) mkdirSync(join(root, directory), { recursive: true });
	const inputs: Record<string, string> = {
		'package.json': JSON.stringify({ workspaces: ['handbook'] }), 'package-lock.json': 'lock', '.nvmrc': '26.5.0', '.npmrc': 'policy',
		'handbook/package.json': 'workspace', 'patches/npm/tool.patch': 'patch',
		'scripts/ci-input-cache.mjs': 'cli', 'scripts/lib/verified-ci-input-tree.ts': 'verification', 'scripts/lib/ci-input-cache-identity.ts': 'policy',
	};
	for (const [file, bytes] of Object.entries(inputs)) writeFileSync(join(root, file), bytes);
	const options = { repositoryRoot: root, kind: 'dependencies' as const, nodeVersion: '26.5.0', npmVersion: '12.0.1', platform: 'linux', architecture: 'x64', scope: 'ubuntu-24.04/image-1', environment: {} };
	const original = ciInputCacheIdentity(options);
	assert.equal(ciInputCacheIdentity(options), original);
	for (const file of ['package-lock.json', 'handbook/package.json', 'patches/npm/tool.patch', '.nvmrc', '.npmrc', 'scripts/lib/verified-ci-input-tree.ts']) {
		writeFileSync(join(root, file), inputs[file] + 'changed');
		assert.notEqual(ciInputCacheIdentity(options), original, file);
		writeFileSync(join(root, file), inputs[file]);
	}
	for (const update of [{ nodeVersion: '26.6.0' }, { npmVersion: '12.0.2' }, { architecture: 'arm64' }, { platform: 'darwin' }, { scope: 'container-digest' }, { environment: { NODE_ENV: 'production' } }]) {
		assert.notEqual(ciInputCacheIdentity({ ...options, ...update }), original);
	}
	assert.notEqual(ciInputCacheIdentity({ ...options, environment: { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' } }), original);
	assert.notEqual(ciInputCacheIdentity({ ...options, environment: { NPM_CONFIG_BUILD_FROM_SOURCE: 'true' } }), original);
	assert.notEqual(ciInputCacheIdentity({ ...options, environment: { SOUNDSCAPER_DESKTOP_TARGET_ARCH: 'arm64' } }), original);
});

test('Firefox identity binds the installed Playwright engine revision and verifier while excluding runtime registration state', t => {
	const root = mkdtempSync(join(tmpdir(), 'ci-firefox-identity-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const directory of ['node_modules/playwright-core', 'scripts/lib']) mkdirSync(join(root, directory), { recursive: true });
	for (const file of ['package-lock.json', 'scripts/ci-input-cache.mjs', 'scripts/lib/verified-ci-input-tree.ts', 'scripts/lib/ci-input-cache-identity.ts', 'node_modules/playwright-core/package.json']) writeFileSync(join(root, file), '{}');
	const engines = join(root, 'node_modules/playwright-core/browsers.json');
	writeFileSync(engines, JSON.stringify({ browsers: [{ name: 'firefox', revision: '1538' }] }));
	const options = { repositoryRoot: root, kind: 'firefox' as const, nodeVersion: '26.5.0', npmVersion: '12.0.1', platform: 'linux', architecture: 'x64', scope: 'ubuntu-24.04/image-1', environment: {} };
	const original = ciInputCacheIdentity(options);
	assert.equal(ciInputCacheIdentity({ ...options, environment: { PLAYWRIGHT_BROWSERS_PATH: '/earlier-registration' } }), original);
	writeFileSync(engines, JSON.stringify({ browsers: [{ name: 'firefox', revision: '1539' }] }));
	assert.notEqual(ciInputCacheIdentity(options), original);
});
