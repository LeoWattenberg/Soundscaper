/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createPackage } from '@electron/asar';
import candidates from '../config/assistance-runtime-family-supply-candidates.json' with { type: 'json' };
import { stageDesktopAssistanceRuntimeFamilies } from '../scripts/lib/desktop-assistance-runtime-families.mjs';
import { auditExtractedDesktopPackageContent, writeDesktopPackageContentManifest } from '../scripts/lib/desktop-package-content-manifest.mjs';
import { packageTree } from './helpers/desktop-package-content-fixture.js';

async function fixture(context) {
	const value = await packageTree(context);
	const runtimeRoot = join(value.resourcesRoot, 'runtime');
	const stage = async (familyId) => {
		const manifest = structuredClone(candidates.manifests[familyId]);
		const entrypoint = familyId === 'onnxruntime-node' ? 'index.js' : 'whisper-cli';
		const bytes = Buffer.from(`authenticated test engine ${familyId}`);
		const targetRoot = join(runtimeRoot, manifest.runtimePrefix, 'linux-x64');
		await mkdir(targetRoot, { recursive: true });
		await writeFile(join(targetRoot, entrypoint), bytes);
		manifest.targets = manifest.targets.map((target) => target.id !== 'linux-x64' ? target : {
			id: target.id, status: 'authenticated', entrypoint,
			files: [{ path: entrypoint, executable: familyId === 'whisper-cpp', byteLength: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex') }],
		});
		return { manifest };
	};
	const families = await stageDesktopAssistanceRuntimeFamilies({ targetId: 'linux-x64', runtimeRoot,
		stageOnnx: () => stage('onnxruntime-node'), stageWhisper: () => stage('whisper-cpp') });
	const application = join(value.extractedRoot, '..', 'application');
	await mkdir(join(application, 'config'), { recursive: true });
	await writeFile(join(application, families.summary.manifest.path), families.manifestBytes);
	await createPackage(application, join(value.resourcesRoot, 'app.asar'));
	value.runtimeManifest.assistanceRuntimeFamilies = families.summary;
	const save = () => writeFile(value.runtimeManifestPath, `${JSON.stringify(value.runtimeManifest, null, 2)}\n`);
	await save();
	return { ...value, save, runtimeRoot, write: () => writeDesktopPackageContentManifest({
		resourcesRoot: value.resourcesRoot, runtimeManifestPath: value.runtimeManifestPath,
		productId: 'soundscaper', targetId: 'linux-x64',
	}) };
}

test('release audit binds ONNX and Whisper files to the manifest inside the actual ASAR', async (context) => {
	const value = await fixture(context);
	const written = await value.write();
	const audited = await auditExtractedDesktopPackageContent({ extractedRoot: value.extractedRoot,
		runtimeManifestBytes: await readFile(value.runtimeManifestPath), productId: 'soundscaper', targetId: 'linux-x64' });
	assert.equal(audited.contentManifestSha256, written.contentManifestSha256);
});

test('release audit refuses missing, modified or extra engine bytes before sealing content', async (context) => {
	for (const mode of ['missing', 'modified', 'extra-target']) {
		const value = await fixture(context);
		const engine = join(value.runtimeRoot, 'assistance/whisper-cpp/v1.9.3/linux-x64/whisper-cli');
		if (mode === 'missing') await rm(engine);
		if (mode === 'modified') await writeFile(engine, 'replaced engine');
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
