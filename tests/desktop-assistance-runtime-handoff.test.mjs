/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { assistanceNativeRuntimeStageSummary } from '../desktop/assistance-native-runtime-payload.mjs';
import { createAssistanceRuntimeArchive } from '../scripts/lib/desktop-assistance-runtime-archive.mjs';
import {
	exportDesktopAssistanceRuntimeHandoff,
	readDesktopAssistanceRuntimeHandoff,
	stageDesktopAssistanceRuntimeHandoff,
} from '../scripts/lib/desktop-assistance-runtime-handoff.mjs';

const SOURCE_REVISION = 'a'.repeat(40);
const TARGET_ID = 'linux-x64';
const FAMILIES = ['sherpa-onnx-node', 'onnxruntime-node', 'whisper-cpp', 'llama-cpp', 'kokoro-g2p'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const fileRecord = (path, bytes) => ({ path, byteLength: bytes.length, sha256: sha256(bytes), executable: true });
const descriptor = (path, bytes) => ({ path, byteLength: bytes.length, sha256: sha256(bytes) });

function packageRecord(name, fileName, bytes, common = false) {
	return { name, version: '1.13.5', sourceUrl: `https://registry.npmjs.org/${name}/-/${name}-1.13.5.tgz`,
		integrity: 'sha512-AAAA', ...(common ? { entry: 'sherpa-onnx.js' } : {}),
		files: { [fileName]: { byteLength: bytes.length, sha256: sha256(bytes) } } };
}

async function fixture(run) {
	const root = await mkdtemp(join(tmpdir(), 'assistance-handoff-'));
	try {
		const buildRoot = join(root, '.desktop-build');
		const archiveRoot = join(buildRoot, 'assistance-distribution');
		const runtimeRoot = join(root, 'runtime');
		const handoffRoot = join(root, 'handoff');
		const engine = Buffer.from('exact engine');
		const common = Buffer.from('exact common');
		const native = { schemaVersion: 1, runtimeId: 'sherpa-onnx-node', version: '1.13.5',
			runtimePrefix: 'assistance/sherpa-onnx/1.13.5',
			commonPackage: packageRecord('sherpa-onnx-node', 'sherpa-onnx.js', common, true),
			targets: Object.fromEntries(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']
				.map((target) => [target, target === TARGET_ID
					? { status: 'built', package: packageRecord('sherpa-onnx-linux-x64', 'engine', engine) }
					: { status: 'unsupported', blockedBy: 'Not built in this fixture.' }])) };
		const family = { schemaVersion: 1, manifests: Object.fromEntries(FAMILIES.slice(1, 4)
			.map((familyId) => [familyId, { runtimeVersion: '1.0.0',
				runtimePrefix: `assistance/${familyId}/1.0.0`,
				targets: [{ id: TARGET_ID, status: 'authenticated', files: [fileRecord('engine', engine)] }] }])) };
		const kokoro = { schemaVersion: 1, runtimeVersion: '0.9.4', targetId: TARGET_ID,
			runtimePrefix: 'assistance/kokoro-g2p/0.9.4', executable: 'kokoro-g2p',
			files: [{ path: 'kokoro-g2p', byteLength: engine.length, sha256: sha256(engine) }] };
		const manifests = {
			'assistance-native-runtime-manifest.json': jsonBytes(native),
			'assistance-runtime-family-supply-candidates.json': jsonBytes(family),
			'assistance-kokoro-g2p-runtime-manifest.json': jsonBytes(kokoro),
		};
		const archiveInputs = [
			{ familyId: FAMILIES[0], runtimeVersion: '1.13.5', runtimePrefix: native.runtimePrefix,
				installPath: native.runtimePrefix, files: [
					fileRecord('node_modules/sherpa-onnx-node/sherpa-onnx.js', common),
					fileRecord('node_modules/sherpa-onnx-linux-x64/engine', engine)] },
			...FAMILIES.slice(1, 4).map((familyId) => ({ familyId, runtimeVersion: '1.0.0',
				runtimePrefix: `assistance/${familyId}/1.0.0`,
				installPath: `assistance/${familyId}/1.0.0/${TARGET_ID}`, files: [fileRecord('engine', engine)] })),
			{ familyId: 'kokoro-g2p', runtimeVersion: '0.9.4', runtimePrefix: kokoro.runtimePrefix,
				installPath: `${kokoro.runtimePrefix}/${TARGET_ID}`, files: [fileRecord('kokoro-g2p', engine)] },
		];
		const bundles = [];
		for (const input of archiveInputs) {
			for (const file of input.files) {
				const path = join(runtimeRoot, input.installPath, file.path);
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, file.path.endsWith('sherpa-onnx.js') ? common : engine);
			}
			bundles.push((await createAssistanceRuntimeArchive({ ...input, targetId: TARGET_ID,
				runtimeRoot, archiveRoot })).bundle);
		}
		const distributionBytes = jsonBytes({ schemaVersion: 1, targetId: TARGET_ID, bundles });
		manifests['assistance-runtime-distribution.json'] = distributionBytes;
		const receipt = { targetId: TARGET_ID,
			manifest: descriptor('config/assistance-runtime-distribution.json', distributionBytes),
			signingFiles: [], bundles: bundles.map(({ familyId, archive }) => ({ familyId,
				byteLength: archive.byteLength, sha256: archive.sha256 })) };
		const familyBytes = manifests['assistance-runtime-family-supply-candidates.json'];
		const familySummary = { targetId: TARGET_ID,
			manifest: descriptor('config/assistance-runtime-family-supply-candidates.json', familyBytes),
			families: FAMILIES.slice(1, 4).map((familyId) => ({ familyId, runtimeVersion: '1.0.0',
				targetId: TARGET_ID, files: 1, byteLength: engine.length, provenance: null })) };
		const kokoroSummary = { targetId: TARGET_ID, fileCount: 1, byteLength: engine.length,
			manifest: descriptor('config/assistance-kokoro-g2p-runtime-manifest.json',
				manifests['assistance-kokoro-g2p-runtime-manifest.json']) };
		await mkdir(join(buildRoot, 'app/config'), { recursive: true });
		for (const [name, bytes] of Object.entries(manifests)) {
			await writeFile(join(buildRoot, 'app/config', name), bytes);
		}
		await writeFile(join(buildRoot, 'stage-manifest.json'), jsonBytes({
			sourceRevision: SOURCE_REVISION, target: { platform: 'linux', arch: 'x64' },
			assistanceNativeRuntime: assistanceNativeRuntimeStageSummary(native, TARGET_ID),
			assistanceNativeBuild: null, assistanceRuntimeFamilies: familySummary,
			assistanceRuntimeDistribution: receipt, kokoroG2pRuntime: kokoroSummary,
		}));
		return await run({ buildRoot, handoffRoot, native, archiveRoot, bundles });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('publisher handoff imports the exact five target archives without rebuilding', async () => {
	await fixture(async ({ buildRoot, handoffRoot, native, bundles }) => {
		const options = { buildRoot, handoffRoot, sourceRevision: SOURCE_REVISION,
			targetId: TARGET_ID, sourceNativeManifest: native };
		await exportDesktopAssistanceRuntimeHandoff(options);
		const packageRoot = join(handoffRoot, '..', 'package-archives');
		const imported = await stageDesktopAssistanceRuntimeHandoff({ ...options, archiveRoot: packageRoot });
		assert.equal(imported.distribution.manifest.bundles.length, 5);
		assert.equal(imported.speech.summary.status, 'built');
		for (const bundle of bundles) {
			const path = join(packageRoot, bundle.familyId, bundle.runtimeVersion, TARGET_ID,
				`${bundle.archive.sha256}.tar.gz`);
			const bytes = await readFile(path);
			assert.equal(sha256(bytes), bundle.archive.sha256);
		}
	});
});

test('handoff rejects a different commit, target, altered archive, and surplus file', async () => {
	await fixture(async ({ buildRoot, handoffRoot, native, bundles }) => {
		const options = { buildRoot, handoffRoot, sourceRevision: SOURCE_REVISION,
			targetId: TARGET_ID, sourceNativeManifest: native };
		await exportDesktopAssistanceRuntimeHandoff(options);
		await assert.rejects(readDesktopAssistanceRuntimeHandoff({ ...options,
			sourceRevision: 'b'.repeat(40) }), /source revision or target/u);
		await assert.rejects(readDesktopAssistanceRuntimeHandoff({ ...options,
			targetId: 'linux-arm64' }), /source revision or target/u);
		await writeFile(join(handoffRoot, 'surplus'), 'x');
		await assert.rejects(readDesktopAssistanceRuntimeHandoff(options), /file inventory/u);
		await rm(join(handoffRoot, 'surplus'));
		const bundle = bundles[2];
		const archive = join(handoffRoot, 'assistance-distribution', bundle.familyId,
			bundle.runtimeVersion, TARGET_ID, `${bundle.archive.sha256}.tar.gz`);
		const original = await readFile(archive);
		await writeFile(archive, Buffer.concat([original, Buffer.from('tampered')]));
		await assert.rejects(readDesktopAssistanceRuntimeHandoff(options), /digest|length/u);
		await copyFile(join(buildRoot, 'assistance-distribution', bundle.familyId,
			bundle.runtimeVersion, TARGET_ID, `${bundle.archive.sha256}.tar.gz`), archive);
		const handoffPath = join(handoffRoot, 'handoff.json');
		const handoff = JSON.parse(await readFile(handoffPath, 'utf8'));
		handoff.assistanceRuntimeFamilies.families[0].byteLength += 1;
		await writeFile(handoffPath, jsonBytes(handoff));
		await assert.rejects(readDesktopAssistanceRuntimeHandoff(options), /family totals/u);
	});
});
