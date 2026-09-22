/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createPackage } from '@electron/asar';
import candidates from '../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import { stageDesktopAssistanceRuntimeFamilies } from '../scripts/lib/desktop-assistance-runtime-families.mjs';
import { stageDesktopKokoroG2pRuntime } from '../scripts/lib/desktop-kokoro-g2p-runtime.mjs';
import { auditExtractedDesktopPackageContent, writeDesktopPackageContentManifest } from '../scripts/lib/desktop-package-content-manifest.mjs';
import { packageTree } from './helpers/desktop-package-content-fixture.js';

async function fixture(context) {
	const value = await packageTree(context);
	const runtimeRoot = join(value.resourcesRoot, 'runtime');
	const stage = async (familyId) => {
		const manifest = structuredClone(candidates.manifests[familyId]);
		const entrypoint = familyId === 'onnxruntime-node' ? 'index.js' : familyId === 'llama-cpp' ? 'llama-completion' : 'whisper-cli';
		const bytes = Buffer.from(`authenticated test engine ${familyId}`);
		const targetRoot = join(runtimeRoot, manifest.runtimePrefix, 'linux-x64');
		await mkdir(targetRoot, { recursive: true });
		await writeFile(join(targetRoot, entrypoint), bytes);
		manifest.targets = manifest.targets.map((target) => target.id !== 'linux-x64' ? target : {
			id: target.id, status: 'authenticated', entrypoint,
			files: [{ path: entrypoint, executable: familyId !== 'onnxruntime-node', byteLength: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex') }],
		});
		return { manifest };
	};
	const families = await stageDesktopAssistanceRuntimeFamilies({ targetId: 'linux-x64', runtimeRoot,
		stageOnnx: () => stage('onnxruntime-node'), stageWhisper: () => stage('whisper-cpp'),
		stageLlama: () => stage('llama-cpp') });
	const g2pBundle = join(value.extractedRoot, '..', 'kokoro-g2p-bundle');
	await mkdir(g2pBundle, { recursive: true });
	await writeFile(join(g2pBundle, 'kokoro-g2p'), 'frozen helper', { mode: 0o755 });
	const notice = Buffer.from('fixture license\n');
	await mkdir(join(g2pBundle, 'licenses/python/example'), { recursive: true });
	await writeFile(join(g2pBundle, 'licenses/python/example/LICENSE'), notice);
	await writeFile(join(g2pBundle, 'python-license-inventory.json'), `${JSON.stringify({
		schemaVersion: 1,
		packages: [{ name: 'example', version: '1.0.0', notices: [{
			path: 'licenses/python/example/LICENSE', byteLength: notice.byteLength,
			sha256: createHash('sha256').update(notice).digest('hex'),
		}] }],
	})}\n`);
	const kokoro = await stageDesktopKokoroG2pRuntime({ targetId: 'linux-x64', bundleRoot: g2pBundle,
		runtimeRoot });
	const application = join(value.extractedRoot, '..', 'application');
	await mkdir(join(application, 'config'), { recursive: true });
	await writeFile(join(application, families.summary.manifest.path), families.manifestBytes);
	await writeFile(join(application, 'config/assistance-kokoro-g2p-runtime-manifest.json'), kokoro.manifestBytes);
	await createPackage(application, join(value.resourcesRoot, 'app.asar'));
	value.runtimeManifest.assistanceRuntimeFamilies = families.summary;
	value.runtimeManifest.kokoroG2pRuntime = {
		...kokoro.summary,
		manifest: { path: 'config/assistance-kokoro-g2p-runtime-manifest.json',
			byteLength: kokoro.manifestBytes.byteLength,
			sha256: createHash('sha256').update(kokoro.manifestBytes).digest('hex') },
	};
	const save = () => writeFile(value.runtimeManifestPath, `${JSON.stringify(value.runtimeManifest, null, 2)}\n`);
	await save();
	return { ...value, save, runtimeRoot, write: () => writeDesktopPackageContentManifest({
		resourcesRoot: value.resourcesRoot, runtimeManifestPath: value.runtimeManifestPath,
		productId: 'soundscaper', targetId: 'linux-x64',
	}) };
}

test('release audit binds ONNX, Whisper and llama files to the manifest inside the actual ASAR', async (context) => {
	const value = await fixture(context);
	const written = await value.write();
	const audited = await auditExtractedDesktopPackageContent({ extractedRoot: value.extractedRoot,
		runtimeManifestBytes: await readFile(value.runtimeManifestPath), productId: 'soundscaper', targetId: 'linux-x64' });
	assert.equal(audited.contentManifestSha256, written.contentManifestSha256);
});

test('release audit refuses missing, modified or extra engine bytes before sealing content', async (context) => {
	for (const mode of ['missing', 'modified', 'extra-target', 'changed-llama']) {
		const value = await fixture(context);
		const engine = join(value.runtimeRoot, 'assistance/whisper-cpp/v1.9.3/linux-x64/whisper-cli');
		if (mode === 'missing') await rm(engine);
		if (mode === 'modified') await writeFile(engine, 'replaced engine');
		if (mode === 'changed-llama') await writeFile(join(value.runtimeRoot, 'assistance/llama-cpp/b10509/linux-x64/llama-completion'), 'replaced editorial engine');
		if (mode === 'extra-target') {
			const foreign = join(value.runtimeRoot, 'assistance/onnxruntime-node/1.29.0/win-x64');
			await mkdir(foreign, { recursive: true });
			await writeFile(join(foreign, 'native.node'), 'foreign engine');
		}
		await assert.rejects(value.write(), /engine.*authentication|unexpected.*engine/iu, mode);
	}
});

test('release audit refuses unbound engine manifests and omitted build receipts', async (context) => {
	for (const mode of ['wrong-manifest', 'missing-receipt']) {
		const value = await fixture(context);
		if (mode === 'wrong-manifest') value.runtimeManifest.assistanceRuntimeFamilies.manifest.sha256 = '0'.repeat(64);
		else delete value.runtimeManifest.assistanceRuntimeFamilies;
		await value.save();
		await assert.rejects(value.write(), /engine.*receipt|manifest.*receipt/iu, mode);
	}
});

test('release audit refuses modified or unbound Kokoro G2P files', async (context) => {
	for (const mode of ['modified', 'extra', 'wrong-manifest', 'missing-receipt']) {
		const value = await fixture(context);
		const helper = join(value.runtimeRoot, 'assistance/kokoro-g2p/0.9.4/linux-x64/kokoro-g2p');
		if (mode === 'modified') await writeFile(helper, 'replaced helper');
		if (mode === 'extra') await writeFile(join(value.runtimeRoot,
			'assistance/kokoro-g2p/0.9.4/linux-x64/foreign.txt'), 'foreign helper');
		if (mode === 'wrong-manifest') value.runtimeManifest.kokoroG2pRuntime.manifest.sha256 = '0'.repeat(64);
		if (mode === 'missing-receipt') delete value.runtimeManifest.kokoroG2pRuntime;
		await value.save();
		await assert.rejects(value.write(), /Kokoro G2P/u, mode);
	}
});
