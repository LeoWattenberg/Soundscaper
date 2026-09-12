/* SPDX-License-Identifier: AGPL-3.0-only */

import { join } from 'node:path';
import { extractFile } from '@electron/asar';
import { verifyDesktopAssistanceRuntimeFamilyPackage } from './desktop-assistance-runtime-family-verification.mjs';

const FAMILIES = Object.freeze(['onnxruntime-node', 'whisper-cpp', 'llama-cpp']);
const MANIFEST_PATH = 'config/assistance-runtime-family-supply-candidates.json';

/** Bind release-audit resources to the native authority inside their actual ASAR. */
export async function assertDesktopPackageAssistanceFamilies({ resourcesRoot, runtime, files }) {
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
