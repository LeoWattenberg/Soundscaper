/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeAssetDescriptor } from './scape-archive-envelope.ts';

interface ScapeProjectWithSources {
	readonly sources: readonly unknown[];
}

interface ScapeManifestAssets {
	readonly assets: readonly ScapeAssetDescriptor[];
}

/**
 * Validates the source identity boundary after project migration and returns
 * the manifest descriptors keyed by their canonical project source IDs.
 */
export function indexScapeProjectAssets(
	project: unknown,
	manifest: ScapeManifestAssets,
): ReadonlyMap<string, ScapeAssetDescriptor> {
	const sources = projectSources(project);
	if (sources.length !== manifest.assets.length) {
		throw new Error('The .scape project sources and manifest assets do not form a one-to-one mapping.');
	}
	const assetBySourceId = new Map<string, ScapeAssetDescriptor>();
	for (const asset of manifest.assets) {
		if (assetBySourceId.has(asset.sourceId)) {
			throw new Error(`Duplicate .scape source asset: ${asset.sourceId}.`);
		}
		assetBySourceId.set(asset.sourceId, asset);
	}

	const projectSourceIds = new Set<string>();
	for (const value of sources) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError('The migrated .scape project contains an invalid source.');
		}
		const source = value as Record<string, unknown>;
		if (typeof source.id !== 'string' || !source.id) {
			throw new TypeError('The migrated .scape project contains an invalid source ID.');
		}
		if (source.kind !== 'audio' && source.kind !== 'video') {
			throw new TypeError(`Source ${source.id} has an unsupported kind.`);
		}
		if (projectSourceIds.has(source.id)) {
			throw new Error(`The migrated .scape project contains duplicate source ${source.id}.`);
		}
		projectSourceIds.add(source.id);
		const asset = assetBySourceId.get(source.id);
		if (!asset) throw new Error(`The .scape archive is missing source ${source.id}.`);
		if (source.kind !== asset.kind) {
			throw new Error(`Source ${source.id} has an incompatible asset kind.`);
		}
	}
	return assetBySourceId;
}

function projectSources(project: unknown): readonly unknown[] {
	if (!project || typeof project !== 'object' || !Array.isArray((project as Partial<ScapeProjectWithSources>).sources)) {
		throw new TypeError('The migrated .scape project has invalid sources.');
	}
	return (project as ScapeProjectWithSources).sources;
}
