/* SPDX-License-Identifier: AGPL-3.0-only */

import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { extractFile } from '@electron/asar';
import { verifyDesktopAssistanceRuntimeFamilyPackage } from './desktop-assistance-runtime-family-verification.mjs';
import { verifyPackagedAssistanceRuntimeDistribution } from './desktop-assistance-runtime-distribution-verification.mjs';
import {
	KOKORO_G2P_PREFIX,
	validateDesktopKokoroG2pManifest,
} from './desktop-kokoro-g2p-runtime.mjs';

const FAMILIES = Object.freeze(['onnxruntime-node', 'whisper-cpp', 'llama-cpp']);
const MANIFEST_PATH = 'config/assistance-runtime-family-supply-candidates.json';

/** Bind release-audit resources to the native authority inside their actual ASAR. */
export async function assertDesktopPackageAssistanceFamilies({ resourcesRoot, runtime, files }) {
	if (runtime.assistanceRuntimeDistribution) {
		if (files.some(({ path }) => path.startsWith('runtime/assistance/')
			|| path.startsWith('app.asar.unpacked/runtime/assistance/'))) {
			throw new Error('The installed desktop package contains preinstalled Local Assistance engines.');
		}
		return verifyPackagedAssistanceRuntimeDistribution({ resourcesRoot, stage: runtime,
			targetId: `${runtime.target.platform}-${runtime.target.arch}` });
	}
	assertDesktopPackageKokoroG2p({ resourcesRoot, runtime, files });
	const engineFiles = files.filter(({ path }) => FAMILIES.some((family) =>
		path.startsWith(`runtime/assistance/${family}/`)));
	const summary = runtime.assistanceRuntimeFamilies;
	if (summary === undefined && engineFiles.length === 0) return; // Earlier package schema.
	if (!summary) throw new Error('Packaged Local Assistance engine files have no build receipt.');
	const targetId = `${runtime.target.platform}-${runtime.target.arch}`;
	const manifestBytes = extractFile(join(resourcesRoot, 'app.asar'), MANIFEST_PATH);
	await verifyDesktopAssistanceRuntimeFamilyPackage({
		manifestBytes, summary, targetId, runtimeRoot: join(resourcesRoot, 'runtime'),
	});
	const manifest = JSON.parse(manifestBytes.toString('utf8'));
	const expected = new Set(FAMILIES.flatMap((family) => {
		const definition = manifest.manifests[family];
		const target = definition.targets.find(({ id }) => id === targetId);
		return target.files.map(({ path }) => `runtime/${definition.runtimePrefix}/${targetId}/${path}`);
	}));
	if (engineFiles.length !== expected.size || engineFiles.some(({ path }) => !expected.has(path))) {
		throw new Error('The installed desktop resource closure has unexpected Local Assistance engine files.');
	}
}

function assertDesktopPackageKokoroG2p({ resourcesRoot, runtime, files }) {
	const prefix = `runtime/${KOKORO_G2P_PREFIX}/`;
	const installed = files.filter(({ path }) => path.startsWith(prefix));
	const summary = runtime.kokoroG2pRuntime;
	if (summary === undefined && installed.length === 0) return; // Earlier package schema.
	if (!summary || !runtime.target) throw new Error('Packaged Kokoro G2P files have no build receipt.');
	const targetId = `${runtime.target.platform}-${runtime.target.arch}`;
	const bytes = extractFile(join(resourcesRoot, 'app.asar'),
		'config/assistance-kokoro-g2p-runtime-manifest.json');
	if (bytes.byteLength > 4 * 1024 * 1024
		|| summary.targetId !== targetId
		|| summary.manifest?.path !== 'config/assistance-kokoro-g2p-runtime-manifest.json'
		|| summary.manifest.byteLength !== bytes.byteLength
		|| summary.manifest.sha256 !== createHash('sha256').update(bytes).digest('hex')) {
		throw new Error('The packaged Kokoro G2P manifest differs from its build receipt.');
	}
	const manifest = JSON.parse(bytes.toString('utf8'));
	validateDesktopKokoroG2pManifest(manifest, targetId);
	const expected = new Map(manifest.files.map((file) => [
		`${prefix}${targetId}/${file.path}`, file,
	]));
	if (installed.length !== expected.size || summary.fileCount !== expected.size
		|| installed.some((file) => {
			const pin = expected.get(file.path);
			return !pin || pin.byteLength !== file.byteLength || pin.sha256 !== file.sha256;
		})
		|| summary.byteLength !== manifest.files.reduce((sum, file) => sum + file.byteLength, 0)) {
		throw new Error('The installed Kokoro G2P closure differs from its authenticated manifest.');
	}
}
