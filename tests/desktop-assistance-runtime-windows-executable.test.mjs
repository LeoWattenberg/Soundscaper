/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { assistanceNativeRuntimeStageSummary } from '../desktop/assistance-native-runtime-payload.mjs';
import { stageDesktopAssistanceRuntimeDistribution } from '../scripts/lib/desktop-assistance-runtime-distribution.mjs';
import { validateDesktopAssistanceRuntimeDistribution } from '../scripts/lib/desktop-assistance-runtime-distribution-verification.mjs';

const TARGET_ID = 'win-x64';
const FAMILIES = ['onnxruntime-node', 'whisper-cpp', 'llama-cpp'];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function json(name) {
	return JSON.parse(await readFile(new URL(`../config/${name}`, import.meta.url), 'utf8'));
}

async function stagedFile(root, path, content) {
	const absolute = join(root, path);
	const bytes = Buffer.from(content);
	await mkdir(dirname(absolute), { recursive: true });
	await writeFile(absolute, bytes, { mode: 0o600 });
	return { byteLength: bytes.length, sha256: digest(bytes) };
}

test('Windows Kokoro PE entrypoint is executable even without POSIX mode bits', async () => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-win-executable-'));
	const runtimeRoot = join(root, 'runtime');
	try {
		const native = await json('assistance-native-runtime-manifest.json');
		const commonName = native.commonPackage.name;
		const targetPackage = native.targets[TARGET_ID].package;
		native.commonPackage.files = { 'sherpa-onnx.js': await stagedFile(runtimeRoot,
			`${native.runtimePrefix}/node_modules/${commonName}/sherpa-onnx.js`, 'common') };
		targetPackage.files = { 'sherpa-onnx.node': await stagedFile(runtimeRoot,
			`${native.runtimePrefix}/node_modules/${targetPackage.name}/sherpa-onnx.node`, 'native') };
		const speech = { manifest: native,
			summary: assistanceNativeRuntimeStageSummary(native, TARGET_ID), buildReceipt: null };

		const family = await json('assistance-runtime-family-supply-candidates.json');
		const summaries = [];
		for (const familyId of FAMILIES) {
			const manifest = family.manifests[familyId];
			const entrypoint = familyId === 'onnxruntime-node' ? 'index.js' : `${familyId}.exe`;
			const file = { path: entrypoint,
				...await stagedFile(runtimeRoot,
					`${manifest.runtimePrefix}/${TARGET_ID}/${entrypoint}`, familyId),
				executable: familyId !== 'onnxruntime-node' };
			manifest.targets = manifest.targets.map((target) => target.id === TARGET_ID
				? { id: TARGET_ID, status: 'authenticated', entrypoint, files: [file] } : target);
			summaries.push({ familyId, runtimeVersion: manifest.runtimeVersion, targetId: TARGET_ID,
				files: 1, byteLength: file.byteLength, provenance: null });
		}
		const families = { manifestBytes: Buffer.from(JSON.stringify(family)),
			summary: { targetId: TARGET_ID, families: summaries } };

		const kokoro = { schemaVersion: 1, targetId: TARGET_ID, runtimeVersion: '0.9.4',
			runtimePrefix: 'assistance/kokoro-g2p/0.9.4', executable: 'kokoro-g2p.exe',
			files: [{ path: 'kokoro-g2p.exe', ...await stagedFile(runtimeRoot,
				'assistance/kokoro-g2p/0.9.4/win-x64/kokoro-g2p.exe', 'PE binary') }] };
		const executablePath = join(runtimeRoot, kokoro.runtimePrefix, TARGET_ID, kokoro.executable);
		assert.equal((await lstat(executablePath)).mode & 0o111, 0);
		const g2p = { manifest: kokoro };
		const distribution = await stageDesktopAssistanceRuntimeDistribution({
			targetId: TARGET_ID, runtimeRoot, archiveRoot: join(root, 'archives'),
			assistanceSpeechRuntime: speech, assistanceRuntimeFamilies: families,
			kokoroG2pRuntime: g2p,
		});
		assert.equal(distribution.manifest.bundles[4].files[0].executable, true);
		assert.equal(validateDesktopAssistanceRuntimeDistribution({
			manifestBytes: distribution.manifestBytes, receipt: distribution.summary,
			targetId: TARGET_ID,
			nativeManifestBytes: Buffer.from(JSON.stringify(distribution.speech.manifest)),
			familyManifestBytes: distribution.families.manifestBytes,
			kokoroManifestBytes: distribution.kokoro.manifestBytes,
		}).bundles.length, 5);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
