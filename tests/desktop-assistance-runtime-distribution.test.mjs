/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createPackage } from '@electron/asar';

import { createAssistanceRuntimeArchive } from '../scripts/lib/desktop-assistance-runtime-archive.mjs';
import {
	validateDesktopAssistanceRuntimeDistribution,
	verifyPackagedAssistanceRuntimeDistribution,
	verifyStagedAssistanceRuntimeDistribution,
} from '../scripts/lib/desktop-assistance-runtime-distribution-verification.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(run) {
	const root = await mkdtemp(join(tmpdir(), 'assistance-distribution-'));
	try {
		const runtimeRoot = join(root, 'runtime');
		const archiveRoot = join(root, 'archives');
		const installPath = 'assistance/whisper-cpp/v1.9.3/linux-x64';
		const path = 'deep/nested/whisper-cli';
		const bytes = Buffer.from('exact native engine');
		await mkdir(join(runtimeRoot, installPath, 'deep/nested'), { recursive: true });
		await writeFile(join(runtimeRoot, installPath, path), bytes, { mode: 0o755 });
		return await run({ runtimeRoot, archiveRoot, installPath, path, bytes });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('distribution archive is immutable, exact USTAR with pinned files and no directory entries', async () => {
	await fixture(async ({ runtimeRoot, archiveRoot, installPath, path, bytes }) => {
		const files = [{ path, byteLength: bytes.length, sha256: digest(bytes), executable: true }];
		const result = await createAssistanceRuntimeArchive({
			familyId: 'whisper-cpp', runtimeVersion: 'v1.9.3', targetId: 'linux-x64',
			runtimePrefix: 'assistance/whisper-cpp/v1.9.3', installPath,
			files, runtimeRoot, archiveRoot,
		});
		assert.equal(result.bundle.archive.url,
			`https://assets.soundscaper.org/runtime/assistance/whisper-cpp/v1.9.3/linux-x64/${result.bundle.archive.sha256}.tar.gz`);
		const archive = await readFile(result.archivePath);
		assert.equal(archive.length, result.bundle.archive.byteLength);
		assert.equal(digest(archive), result.bundle.archive.sha256);
		const tar = gunzipSync(archive);
		assert.equal(tar.toString('utf8', 0, 100).replaceAll('\0', ''), path);
		assert.equal(tar.toString('ascii', 156, 157), '0');
		assert.equal(tar.toString('ascii', 257, 263), 'ustar\0');
		assert.deepEqual(tar.subarray(512, 512 + bytes.length), bytes);
		assert.equal(tar.subarray(-1024).every((byte) => byte === 0), true);
	});
});

test('distribution archive refuses extra files, symlinks and a changed pinned file', async () => {
	await fixture(async ({ runtimeRoot, archiveRoot, installPath, path, bytes }) => {
		const options = {
			familyId: 'whisper-cpp', runtimeVersion: 'v1.9.3', targetId: 'linux-x64',
			runtimePrefix: 'assistance/whisper-cpp/v1.9.3', installPath,
			files: [{ path, byteLength: bytes.length, sha256: digest(bytes), executable: true }],
			runtimeRoot, archiveRoot,
		};
		await writeFile(join(runtimeRoot, installPath, path), 'changed');
		await assert.rejects(createAssistanceRuntimeArchive(options), /digest|length/u);
		await writeFile(join(runtimeRoot, installPath, path), bytes);
		await writeFile(join(runtimeRoot, installPath, 'extra'), 'x');
		await assert.rejects(createAssistanceRuntimeArchive(options), /unexpected|inventory/u);
		await rm(join(runtimeRoot, installPath, 'extra'));
		await symlink('deep/nested/whisper-cli', join(runtimeRoot, installPath, 'extra'));
		await assert.rejects(createAssistanceRuntimeArchive(options), /symlink|inventory/u);
	});
});

test('distribution archive uses the USTAR prefix for a deep Python payload path', async () => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-ustar-prefix-'));
	try {
		const runtimeRoot = join(root, 'runtime');
		const installPath = 'assistance/kokoro-g2p/0.9.4/linux-x64';
		const path = `${'python-libraries/'.repeat(8)}module.so`;
		const bytes = Buffer.from('native payload');
		await mkdir(join(runtimeRoot, installPath, 'python-libraries/'.repeat(8)), { recursive: true });
		await writeFile(join(runtimeRoot, installPath, path), bytes);
		const archive = await createAssistanceRuntimeArchive({ familyId: 'kokoro-g2p',
			runtimeVersion: '0.9.4', targetId: 'linux-x64',
			runtimePrefix: 'assistance/kokoro-g2p/0.9.4', installPath,
			files: [{ path, byteLength: bytes.length, sha256: digest(bytes), executable: false }],
			runtimeRoot, archiveRoot: join(root, 'archives') });
		const tar = gunzipSync(await readFile(archive.archivePath));
		assert.ok(tar.toString('utf8', 345, 500).replaceAll('\0', '').length > 0);
		assert.equal(tar.toString('utf8', 0, 100).replaceAll('\0', ''), 'module.so');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('packaging authority binds all five archive file inventories to ASAR source manifests', async () => {
	const targetId = 'linux-x64';
	const sourceFile = { path: 'engine', byteLength: 6, sha256: 'a'.repeat(64), executable: true };
	const native = { version: '1.13.5', runtimePrefix: 'assistance/sherpa-onnx/1.13.5',
		commonPackage: { name: 'sherpa-onnx-node', files: { engine: { byteLength: 6, sha256: 'a'.repeat(64) } } },
		targets: { [targetId]: { status: 'built', package: { name: 'sherpa-onnx-linux-x64', files: { engine: {
			byteLength: 6, sha256: 'a'.repeat(64) } } } } } };
	const familyIds = ['onnxruntime-node', 'whisper-cpp', 'llama-cpp'];
	const family = { manifests: Object.fromEntries(familyIds.map((familyId) => [familyId, {
		runtimeVersion: '1.0.0', runtimePrefix: `assistance/${familyId}/1.0.0`,
		targets: [{ id: targetId, status: 'authenticated', files: [sourceFile] }],
	}])) };
	const kokoro = { runtimeVersion: '0.9.4', runtimePrefix: 'assistance/kokoro-g2p/0.9.4',
		targetId, executable: 'engine',
		files: [sourceFile] };
	const bundles = ['sherpa-onnx-node', ...familyIds, 'kokoro-g2p'].map((familyId) => {
		const runtimeVersion = familyId === 'sherpa-onnx-node' ? '1.13.5'
			: familyId === 'kokoro-g2p' ? '0.9.4' : '1.0.0';
		const runtimePrefix = familyId === 'sherpa-onnx-node'
			? native.runtimePrefix : `assistance/${familyId}/${runtimeVersion}`;
		const archiveSha = 'b'.repeat(64);
		return { familyId, runtimeVersion, runtimePrefix,
			installPath: familyId === 'sherpa-onnx-node' ? runtimePrefix : `${runtimePrefix}/${targetId}`,
			archive: { url: `https://assets.soundscaper.org/runtime/assistance/${familyId}/${runtimeVersion}/${targetId}/${archiveSha}.tar.gz`,
				byteLength: 42, sha256: archiveSha },
			files: familyId === 'sherpa-onnx-node'
				? ['sherpa-onnx-node', 'sherpa-onnx-linux-x64'].map((name) => ({
					...sourceFile, path: `node_modules/${name}/engine` })) : [sourceFile] };
	});
	const manifestBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, targetId, bundles }));
	const receipt = { targetId, signingFiles: [], manifest: { path: 'config/assistance-runtime-distribution.json',
		byteLength: manifestBytes.length, sha256: digest(manifestBytes) },
		bundles: bundles.map((bundle) => ({ familyId: bundle.familyId, sha256: bundle.archive.sha256,
			byteLength: bundle.archive.byteLength })) };
	const input = { manifestBytes, receipt, targetId,
		nativeManifestBytes: Buffer.from(JSON.stringify(native)),
		familyManifestBytes: Buffer.from(JSON.stringify(family)),
		kokoroManifestBytes: Buffer.from(JSON.stringify(kokoro)) };
	assert.equal(validateDesktopAssistanceRuntimeDistribution(input).bundles.length, 5);
	assert.throws(() => validateDesktopAssistanceRuntimeDistribution({ ...input,
		receipt: { ...receipt, signingFiles: [{ path: 'assistance/unknown',
			original: { byteLength: 1, sha256: 'a'.repeat(64) },
			signed: { byteLength: 1, sha256: 'b'.repeat(64) } }] } }), /build receipt/u);
	const changed = structuredClone({ schemaVersion: 1, targetId, bundles });
	changed.bundles[2].files[0].sha256 = 'c'.repeat(64);
	const changedBytes = Buffer.from(JSON.stringify(changed));
	assert.throws(() => validateDesktopAssistanceRuntimeDistribution({ ...input,
		manifestBytes: changedBytes,
		receipt: { ...receipt, manifest: { ...receipt.manifest, byteLength: changedBytes.length,
			sha256: digest(changedBytes) } } }), /authenticated source manifest/u);
	const root = await mkdtemp(join(tmpdir(), 'assistance-package-'));
	try {
		const app = join(root, '.desktop-build/app');
		const stageManifestPath = join(root, '.desktop-build/stage-manifest.json');
		await mkdir(join(app, 'config'), { recursive: true });
		for (const [name, bytes] of [
			['assistance-runtime-distribution.json', manifestBytes],
			['assistance-native-runtime-manifest.json', input.nativeManifestBytes],
			['assistance-runtime-family-supply-candidates.json', input.familyManifestBytes],
			['assistance-kokoro-g2p-runtime-manifest.json', input.kokoroManifestBytes],
		]) await writeFile(join(app, 'config', name), bytes);
		await writeFile(stageManifestPath, JSON.stringify({ assistanceRuntimeDistribution: receipt }));
		await verifyStagedAssistanceRuntimeDistribution({ repositoryRoot: root,
			stageManifestPath, packagedTarget: targetId });
		const resourcesRoot = join(root, 'resources');
		await mkdir(resourcesRoot);
		await createPackage(app, join(resourcesRoot, 'app.asar'));
		await verifyPackagedAssistanceRuntimeDistribution({ resourcesRoot,
			stage: { assistanceRuntimeDistribution: receipt }, targetId });
		await mkdir(join(resourcesRoot, 'runtime/assistance'), { recursive: true });
		await writeFile(join(resourcesRoot, 'runtime/assistance/engine'), 'preinstalled');
		await assert.rejects(verifyPackagedAssistanceRuntimeDistribution({ resourcesRoot,
			stage: { assistanceRuntimeDistribution: receipt }, targetId }), /preinstalled AI payloads/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
