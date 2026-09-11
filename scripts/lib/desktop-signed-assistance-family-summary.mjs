/* SPDX-License-Identifier: AGPL-3.0-only */

/** Recompute derived totals after signing updates native file descriptors. */
export function signedAssistanceFamilySummary(summary, packageManifest) {
	if (!Array.isArray(summary?.families) || summary.families.length !== 2
		|| new Set(summary.families.map(({ familyId }) => familyId)).size !== 2) {
		throw new Error('Signed Local Assistance runtime summaries are incomplete.');
	}
	return { ...summary, families: summary.families.map((family) => {
		const manifest = packageManifest.manifests?.[family.familyId];
		const target = manifest?.targets.find(({ id }) => id === summary.targetId);
		if (!['onnxruntime-node', 'whisper-cpp'].includes(family.familyId)
			|| family.targetId !== summary.targetId || family.runtimeVersion !== manifest?.runtimeVersion
			|| target?.status !== 'authenticated' || !Array.isArray(target.files)) {
			throw new Error('Signed Local Assistance runtime summary disagrees with its manifest.');
		}
		const byteLength = target.files.reduce((sum, file) => sum + file.byteLength, 0);
		let provenance = family.provenance;
		if (provenance && typeof provenance === 'object') {
			provenance = { ...provenance };
			if (Object.hasOwn(provenance, 'byteLength')) provenance.byteLength = byteLength;
			if (Object.hasOwn(provenance, 'installedBytes')) provenance.installedBytes = byteLength;
		}
		return { ...family, files: target.files.length, byteLength, provenance };
	}) };
}
