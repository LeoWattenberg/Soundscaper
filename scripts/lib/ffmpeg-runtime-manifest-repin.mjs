/* SPDX-License-Identifier: AGPL-3.0-only */

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

export function createFfmpegRuntimeEvidenceRepinner({
	assert,
	canonicalJson,
	evidencePaths,
	manifestPath: defaultManifestPath,
	parseJson,
	readRegularFile,
	sha256,
	validateManifestShape,
}) {
	return async function repinFfmpegRuntimeEvidence({
		repositoryRoot,
		manifestPath = defaultManifestPath,
	} = {}) {
		assert(typeof repositoryRoot === 'string' && repositoryRoot, 'repositoryRoot is required');
		const root = await realpath(resolve(repositoryRoot));
		const originalText = String(await readRegularFile(root, manifestPath, 'FFmpeg runtime manifest'));
		const manifest = parseJson(originalText, 'FFmpeg runtime manifest');
		validateManifestShape(manifest);

		const refreshed = [];
		for (const [id, expectedPath] of Object.entries(evidencePaths)) {
			const descriptor = manifest.evidence[id];
			assert(descriptor.path === expectedPath, `evidence.${id}.path must be ${expectedPath}`);
			refreshed.push(await repinDescriptor(root, descriptor, `runtime evidence ${id}`));
		}
		refreshed.push(await repinDescriptor(root, manifest.publication.cors, 'runtime CORS policy'));
		refreshed.push(await repinDescriptor(root, manifest.publication.policy, 'runtime publication policy'));

		const payload = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'review'));
		manifest.review.payloadSha256 = sha256(Buffer.from(canonicalJson(payload)));
		const manifestText = `${JSON.stringify(manifest, null, '\t')}\n`;
		return Object.freeze({
			manifestText,
			changed: manifestText !== originalText,
			refreshed: Object.freeze(refreshed),
		});
	};

	async function repinDescriptor(root, descriptor, label) {
		const bytes = await readRegularFile(root, descriptor.path, label);
		descriptor.byteLength = bytes.byteLength;
		descriptor.sha256 = sha256(bytes);
		return Object.freeze({ path: descriptor.path, byteLength: descriptor.byteLength, sha256: descriptor.sha256 });
	}
}
