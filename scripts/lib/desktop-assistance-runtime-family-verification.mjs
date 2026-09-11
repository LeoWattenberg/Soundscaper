/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	describeAssistanceRuntimeFamilyAvailability,
	validateAssistanceRuntimeFamilyManifestV1,
} from '../../desktop/assistance-runtime-family-manifest.ts';

/** Recheck the packaged manifest and both engine closures at each packaging boundary. */
export async function verifyDesktopAssistanceRuntimeFamilyPackage({
	manifestBytes, summary, targetId, runtimeRoot,
}) {
	if (summary?.targetId !== targetId
		|| summary.manifest?.path !== 'config/assistance-runtime-family-supply-candidates.json'
		|| summary.manifest.byteLength !== manifestBytes.byteLength
		|| summary.manifest.sha256 !== createHash('sha256').update(manifestBytes).digest('hex')) {
		throw new Error('The packaged Local Assistance engine manifest does not match its build receipt.');
	}
	const [operatingSystem, architecture] = targetId.split('-');
	const platform = { mac: 'darwin', linux: 'linux', win: 'win32' }[operatingSystem];
	const packageManifest = JSON.parse(manifestBytes.toString('utf8'));
	if (packageManifest?.schemaVersion !== 1) throw new Error('The packaged Local Assistance manifest is invalid.');
	for (const familyId of ['onnxruntime-node', 'whisper-cpp']) {
		const manifest = validateAssistanceRuntimeFamilyManifestV1(packageManifest.manifests?.[familyId]);
		const availability = await describeAssistanceRuntimeFamilyAvailability({
			familyId, manifest, runtimeRoot, platform, architecture,
			totalMemoryBytes: Number.MAX_SAFE_INTEGER,
		});
		if (availability.status !== 'available') {
			throw new Error(`The packaged ${familyId} engine failed authentication: ${availability.detail}`);
		}
	}
}
