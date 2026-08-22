/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
	auditFramescaperOpenFxHost,
	deriveFramescaperOpenFxPayloadManifest,
	verifyFramescaperOpenFxPayloadManifest,
} from '../scripts/lib/framescaper-openfx-host-build.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const hostRoot = join(repositoryRoot, 'native/framescaper-openfx-host');

test('OpenFX 1.5.1 is pinned to its signed ab77951 release tag and the source closure audits', () => {
	const audit = auditFramescaperOpenFxHost({ repositoryRoot });
	assert.deepEqual(audit.findings, []);
	assert.deepEqual(audit.manifest.openfx, {
		version: '1.5.1',
		tag: 'OFX_Release_1.5.1',
		commit: 'ab77951',
		commitSha: 'ab779510b2655b4d11a7e01e5c521f9aa8c88976',
		tagObjectSha: '43d93ea99255cc61177b0632e421e899e802995e',
		signedTagApiUrl: 'https://api.github.com/repos/AcademySoftwareFoundation/openfx/git/tags/43d93ea99255cc61177b0632e421e899e802995e',
		signedTagVerifiedAt: '2025-11-20T18:14:02Z',
		url: 'https://codeload.github.com/AcademySoftwareFoundation/openfx/tar.gz/ab77951',
		byteLength: 9_837_777,
		sha256: '7f4fcde6c4bff3ee1f95a0b73a805e662a3e030999523165b40cfbe76c1ab9f5',
		extractedTree: {
			algorithm: 'framescaper-portable-source-tree-sha256-v1',
			fileCount: 388,
			sha256: 'bd7c4e5850725a2ed985e7c5f1f531a33e1c2509057052b21a0062454c3a8efe',
		},
		license: 'BSD-3-Clause',
	});
});

test('scanner and runtime are distinct C++20 targets and no unbuilt payload is packaged', () => {
	const cmake = readFileSync(join(hostRoot, 'CMakeLists.txt'), 'utf8');
	assert.match(cmake, /add_executable\(framescaper-ofx-scanner/iu);
	assert.match(cmake, /add_executable\(framescaper-ofx-runtime-host/iu);
	assert.doesNotMatch(cmake, /Electron|node\.h|napi/iu);
	const release = verifyFramescaperOpenFxPayloadManifest({ repositoryRoot });
	assert.deepEqual(release.payload.payloads, []);
	assert.equal(release.payload.targets.length, 5);
	assert.equal(release.payload.targets.every(({ status, payload }) => (
		status === 'pending-external' && payload === null
	)), true);
});

test('future built targets require two exact target-root payloads before derivation', (context) => {
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-openfx-payload-audit-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const copiedHost = join(directory, 'native/framescaper-openfx-host');
	cpSync(hostRoot, copiedHost, { recursive: true });
	// The audit reports a root whose line-ending policy does not pin the host tree, so the
	// fixture root carries the policy the real repository states rather than omitting it.
	cpSync(join(repositoryRoot, '.gitattributes'), join(directory, '.gitattributes'));
	const manifestPath = join(copiedHost, 'source-manifest.json');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	manifest.sourceFiles = sourcePins(copiedHost);
	const scanner = payload(copiedHost, 'linux-x64', 'framescaper-ofx-scanner', 'scanner');
	const runtime = payload(
		copiedHost, 'linux-x64', 'framescaper-ofx-runtime-host', 'runtime',
	);
	manifest.targets['linux-x64'] = {
		runtime: 'linux-x64', status: 'built', blockedBy: null,
		toolchainIdentity: '12'.repeat(32), scannerPayload: scanner,
		runtimeHostPayload: runtime, productionReadiness: null,
	};
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);

	const audit = auditFramescaperOpenFxHost({ repositoryRoot: directory });
	assert.deepEqual(audit.findings, []);
	const derived = deriveFramescaperOpenFxPayloadManifest(audit.manifest);
	assert.deepEqual(derived.payloads, [{
		id: 'linux-x64', runtime: 'linux-x64',
		scannerPayload: scanner, runtimeHostPayload: runtime,
	}]);
	assert.deepEqual(derived.targets[0].payload, {
		scannerPayload: scanner, runtimeHostPayload: runtime,
	});
	assert.equal(derived.targets[0].productionReadiness, null);

	writeFileSync(join(directory, runtime.path), 'tampered-runtime');
	assert.match(
		auditFramescaperOpenFxHost({ repositoryRoot: directory }).findings.join('\n'),
		/runtimeHostPayload bytes disagree with the pin/u,
	);
	manifest.targets['linux-x64'].runtimeHostPayload = {
		...runtime, path: 'native/framescaper-openfx-host/prebuilt/linux-arm64/bin/framescaper-ofx-runtime-host',
	};
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	assert.match(
		auditFramescaperOpenFxHost({ repositoryRoot: directory }).findings.join('\n'),
		/invalid runtimeHostPayload identity/u,
	);
});

test('contract-only scanner and per-fingerprint runtime fixtures self-test separately', (context) => {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++ compiler is not installed on this source-audit host.');
		return;
	}
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-openfx-host-'));
	try {
		const mediaSourceRoot = join(repositoryRoot, 'native/framescaper-media-host/src');
		const common = [
			join(hostRoot, 'src', 'sha256.cpp'),
			join(hostRoot, 'src', 'dynamic_library.cpp'),
			join(hostRoot, 'src', 'host_runtime.cpp'),
			join(hostRoot, 'src', 'loaded_plugin_binary.cpp'),
			join(hostRoot, 'src', 'parameter_values.cpp'),
			join(hostRoot, 'src', 'v12_cancellation_channel.cpp'),
			join(hostRoot, 'src', 'v12_host_invocation.cpp'),
			join(hostRoot, 'src', 'v12_video_timing_grants.cpp'),
			join(hostRoot, 'src', 'v12_output_file.cpp'),
			join(hostRoot, 'src', 'v12_retime_authority.cpp'),
			join(hostRoot, 'src', 'v12_transition_authority.cpp'),
			...[
				'legacy_plan_semantics.cpp', 'legacy_plan_v8_filter_semantics.cpp',
				'media_file_grants.cpp', 'media_plan.cpp', 'sha256.cpp', 'strict_json.cpp',
			].map((source) => join(mediaSourceRoot, source)),
		];
		for (const [source, output, expectedMode] of [
			['ofx_scanner.cpp', 'scanner', 'short-lived-scanner'],
			['ofx_runtime_host.cpp', 'runtime', 'per-binary-fingerprint-runtime'],
		]) {
			const executable = join(directory, output);
			const built = spawnSync('c++', [
				'-std=c++20', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
				'-DFRAMESCAPER_OPENFX_CONTRACT_ONLY=1',
				'-I', join(hostRoot, 'src'), '-I', mediaSourceRoot, ...common,
				join(hostRoot, 'src', source), '-pthread',
				...(process.platform === 'linux' ? ['-ldl'] : []), '-o', executable,
			], { encoding: 'utf8' });
			assert.equal(built.status, 0, built.stderr);
			const selfTest = spawnSync(executable, ['--self-test'], { encoding: 'utf8' });
			assert.equal(selfTest.status, 0, selfTest.stderr);
			const result = JSON.parse(selfTest.stdout);
			assert.equal(result.mode, expectedMode);
			assert.equal(result.openfx, '1.5.1');
			assert.equal(result.networkSuiteExposed, false);
			assert.equal(result.arbitraryFilesystemSuiteExposed, false);
			assert.equal(result.vendorTopLevelWindowsExposed, false);
			assert.equal(result.osIsolationAttested, false);
			assert.equal(result.thirdPartyExecutionEnabled, false);
			assert.deepEqual(result.interactSuiteVersions, [1]);
			assert.equal(
				result.interactSuiteV2,
				'unavailable-upstream-openfx-1.5.1-defines-only-v1',
			);
			if (expectedMode === 'per-binary-fingerprint-runtime') {
				assert.deepEqual(result.overlayInteractVersions, [2]);
				assert.equal(result.offscreenUiAvailable, true);
			}
		}
		const runtime = join(directory, 'runtime');
		assert.notEqual(spawnSync(runtime, ['--fingerprint', 'not-a-digest'], { encoding: 'utf8' }).status, 0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

function payload(copiedHost, target, name, contents) {
	const relativePath = `native/framescaper-openfx-host/prebuilt/${target}/bin/${name}`;
	const path = join(copiedHost, 'prebuilt', target, 'bin', name);
	mkdirSync(join(copiedHost, 'prebuilt', target, 'bin'), { recursive: true });
	writeFileSync(path, contents);
	const bytes = readFileSync(path);
	return {
		path: relativePath, byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
}

function sourcePins(root) {
	const paths = [];
	visit(root);
	return paths.sort().map((path) => {
		const bytes = readFileSync(join(root, path));
		return {
			path, byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		};
	});

	function visit(directory) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory() && entry.name !== 'prebuilt' && entry.name !== 'out') visit(path);
			else if (entry.isFile() && entry.name !== 'source-manifest.json'
				&& statSync(path).isFile()) {
				paths.push(path.slice(root.length + 1).replaceAll('\\', '/'));
			}
		}
	}
}
