/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	NATIVE_HELPER_ADDON_ROOT,
	NATIVE_HELPER_ADDON_TARGETS,
	auditNativeHelperAddon,
	buildNativeHelperAddon,
	nativeHelperAddonTargetForRuntime,
	readNativeHelperAddonSourceManifest,
	repinNativeHelperAddonSources,
} from '../scripts/lib/native-helper-addon-build.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

function createFixture(mutate = () => undefined) {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-native-addon-'));
	const sourceRoot = join(root, NATIVE_HELPER_ADDON_ROOT, 'src');
	mkdirSync(sourceRoot, { recursive: true });
	writeFileSync(join(sourceRoot, 'addon.c'), 'int soundscaper_addon(void) { return 1; }\n');
	const bytes = readFileSync(join(sourceRoot, 'addon.c'));
	const payload = Buffer.from('payload bytes');
	const payloadRoot = join(root, NATIVE_HELPER_ADDON_ROOT, 'prebuilt', 'linux-x64');
	mkdirSync(payloadRoot, { recursive: true });
	writeFileSync(join(payloadRoot, 'soundscaper_helper.node'), payload);
	const manifest = {
		schemaVersion: 1,
		addonVersion: '1.0.0',
		napiVersion: 8,
		payloadName: 'soundscaper_helper.node',
		license: 'AGPL-3.0-only',
		toolchain: {
			language: 'c11',
			sourceDateEpoch: 1755302400,
			includeDirectories: ['/usr/include/node'],
			compileFlags: ['-std=c11'],
			linkFlags: ['-shared'],
		},
		sourceFiles: [{ path: 'addon.c', byteLength: bytes.byteLength, sha256: digest(bytes) }],
		targets: Object.fromEntries(NATIVE_HELPER_ADDON_TARGETS.map(({ id }) => [
			id,
			id === 'linux-x64'
				? {
					status: 'built',
					blockedBy: null,
					toolchainIdentity: 'cc (fixture) 1.0',
					payload: { name: 'soundscaper_helper.node', byteLength: payload.byteLength, sha256: digest(payload) },
				}
				: { status: 'pending-external', blockedBy: 'No build host is provisioned for this target.', toolchainIdentity: null, payload: null },
		])),
	};
	mutate(manifest, { root, sourceRoot, payloadRoot });
	writeFileSync(join(root, NATIVE_HELPER_ADDON_ROOT, 'source-manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	return root;
}

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

test('the checked-in native helper addon sources and payloads match their pins', () => {
	const { findings, manifest } = auditNativeHelperAddon({ repositoryRoot });
	assert.deepEqual(findings, []);
	assert.ok(manifest.sourceFiles.length >= 3);
	assert.equal(manifest.targets['linux-x64'].status, 'built');
});

test('every claimed target is recorded and macOS x64 is retired', () => {
	assert.deepEqual(
		NATIVE_HELPER_ADDON_TARGETS.map(({ id }) => id),
		['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'],
	);
	assert.equal(nativeHelperAddonTargetForRuntime('linux', 'x64')?.id, 'linux-x64');
	assert.equal(nativeHelperAddonTargetForRuntime('darwin', 'arm64')?.id, 'mac-arm64');
	assert.equal(nativeHelperAddonTargetForRuntime('win32', 'arm64')?.id, 'win-arm64');
	assert.equal(nativeHelperAddonTargetForRuntime('darwin', 'x64'), null);
	assert.equal(nativeHelperAddonTargetForRuntime('freebsd', 'x64'), null);
});

test('a clean fixture audits with no findings', () => {
	const root = createFixture();
	try {
		assert.deepEqual(auditNativeHelperAddon({ repositoryRoot: root }).findings, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a tampered source, an unpinned source and a tampered payload each fail closed', () => {
	const tampered = createFixture((manifest) => {
		manifest.sourceFiles[0].sha256 = 'a'.repeat(64);
	});
	const unpinned = createFixture((manifest, { sourceRoot }) => {
		void manifest;
		writeFileSync(join(sourceRoot, 'extra.c'), 'int extra(void) { return 2; }\n');
	});
	const swapped = createFixture((manifest, { payloadRoot }) => {
		void manifest;
		writeFileSync(join(payloadRoot, 'soundscaper_helper.node'), Buffer.from('other bytes'));
	});
	try {
		assert.match(auditNativeHelperAddon({ repositoryRoot: tampered }).findings.join('\n'), /Source digest mismatch for addon\.c/u);
		assert.match(auditNativeHelperAddon({ repositoryRoot: unpinned }).findings.join('\n'), /Unpinned native helper addon source: extra\.c/u);
		assert.match(auditNativeHelperAddon({ repositoryRoot: swapped }).findings.join('\n'), /linux-x64: payload (?:byte length|digest) mismatch/u);
	} finally {
		for (const root of [tampered, unpinned, swapped]) rmSync(root, { recursive: true, force: true });
	}
});

test('a built target without its payload and a pending target that pins one are both rejected', () => {
	const missing = createFixture((manifest, { payloadRoot }) => {
		void manifest;
		rmSync(join(payloadRoot, 'soundscaper_helper.node'));
	});
	const overclaimed = createFixture((manifest) => {
		manifest.targets['win-x64'].payload = { name: 'soundscaper_helper.node', byteLength: 4, sha256: 'b'.repeat(64) };
	});
	const unexplained = createFixture((manifest) => {
		manifest.targets['mac-arm64'].blockedBy = '';
	});
	try {
		assert.match(auditNativeHelperAddon({ repositoryRoot: missing }).findings.join('\n'), /linux-x64: the built payload is missing/u);
		assert.match(auditNativeHelperAddon({ repositoryRoot: overclaimed }).findings.join('\n'), /win-x64: a pending-external target must not pin a payload/u);
		assert.match(auditNativeHelperAddon({ repositoryRoot: unexplained }).findings.join('\n'), /mac-arm64: a pending-external target requires a named blocker/u);
	} finally {
		for (const root of [missing, overclaimed, unexplained]) rmSync(root, { recursive: true, force: true });
	}
});

test('a manifest missing a claimed target is rejected before any audit runs', () => {
	const root = createFixture((manifest) => {
		delete manifest.targets['win-arm64'];
	});
	try {
		assert.throws(() => auditNativeHelperAddon({ repositoryRoot: root }), /must record exactly the targets/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('the addon is never cross-built: a foreign target is refused', () => {
	assert.throws(
		() => buildNativeHelperAddon({
			repositoryRoot,
			target: NATIVE_HELPER_ADDON_TARGETS.find(({ runtime }) => runtime !== `${process.platform}-${process.arch}`),
			run: () => ({ status: 0, stdout: 'cc (test) 1.0\n' }),
		}),
		/built only for the host target/u,
	);
});

test('repinning without a build leaves every target record untouched', () => {
	const root = createFixture();
	try {
		const before = readNativeHelperAddonSourceManifest(root);
		const after = repinNativeHelperAddonSources({ repositoryRoot: root });
		assert.deepEqual(after.targets, before.targets);
		assert.deepEqual(after.sourceFiles, before.sourceFiles);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
