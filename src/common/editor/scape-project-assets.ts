/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeAssetDescriptor } from './scape-archive-envelope.ts';
import {
	normalizeProjectFeatureRequirements,
	type ProjectFeatureFallback,
	type ProjectFeatureRequirementsManifest,
} from './project-feature-requirements.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from './project-schema-version.ts';

interface ScapeProjectWithSources {
	readonly schemaVersion?: unknown;
	readonly featureRequirements?: unknown;
	readonly sources: readonly unknown[];
	readonly clips?: readonly unknown[];
	readonly tracks?: readonly unknown[];
	readonly sampleRate?: unknown;
	readonly sequences?: readonly Readonly<Record<string, unknown>>[];
	readonly primarySequenceId?: unknown;
}

interface ScapeManifestAssets {
	readonly assets: readonly ScapeAssetDescriptor[];
}

export type ScapeProjectFallbackClaim = ProjectFeatureFallback;

const NO_FALLBACK_CLAIMS: readonly ScapeProjectFallbackClaim[] = Object.freeze([]);
const NO_FALLBACK_SNAPSHOT: ScapeProjectFallbackSnapshot = Object.freeze({
	featureRequirements: null,
	claims: NO_FALLBACK_CLAIMS,
});

export interface ScapeProjectFallbackSnapshot {
	readonly featureRequirements: ProjectFeatureRequirementsManifest | null;
	readonly claims: readonly ScapeProjectFallbackClaim[];
}

export interface ScapeProjectAssetIndexOptions {
	readonly currentProjectSchemaVersion?: number;
}

/**
 * Validates the source identity boundary after project migration and returns
 * the manifest descriptors keyed by their canonical project source IDs.
 */
export function indexScapeProjectAssets(
	project: unknown,
	manifest: ScapeManifestAssets,
	options: ScapeProjectAssetIndexOptions = {},
): ReadonlyMap<string, ScapeAssetDescriptor> {
	const sources = projectSources(project);
	const currentProjectSchemaVersion = scapeAssetSchemaVersion(options);
	const sourceAssets = manifest.assets.filter(({ kind }) => kind !== 'video-timing');
	if (sources.length !== sourceAssets.length) {
		throw new Error('The .scape project sources and manifest assets do not form a one-to-one mapping.');
	}
	const assetBySourceId = new Map<string, ScapeAssetDescriptor>();
	for (const asset of sourceAssets) {
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
		if ((project as ScapeProjectWithSources).schemaVersion === currentProjectSchemaVersion
			&& source.kind === 'video' && source.contentSha256 !== undefined) {
			if (typeof source.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(source.contentSha256)) {
				throw new TypeError(`Source ${source.id} has an invalid source content SHA-256.`);
			}
			if (asset.sha256 !== source.contentSha256) {
				throw new Error(`Source ${source.id} original asset digest does not match its source content SHA-256.`);
			}
		}
	}
	assertScapeProjectFallbackAssets(snapshotScapeProjectFallbackIntegrity(project).claims, assetBySourceId);
	indexScapeProjectTimingAssets(project, manifest);
	return assetBySourceId;
}

function scapeAssetSchemaVersion(options: ScapeProjectAssetIndexOptions): number {
	const value = options.currentProjectSchemaVersion ?? AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION;
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError('The current Scape project schema version must be a positive safe integer.');
	}
	return value;
}

export function indexScapeProjectTimingAssets(
	project: unknown,
	manifest: ScapeManifestAssets,
): ReadonlyMap<string, ScapeAssetDescriptor> {
	const timingAssets = manifest.assets.filter(({ kind }) => kind === 'video-timing');
	const byStorageKey = new Map(timingAssets.map((asset) => [asset.sourceId, asset]));
	if (byStorageKey.size !== timingAssets.length) throw new Error('The .scape archive contains duplicate timing assets.');
	const referenced = new Set<string>();
	for (const value of projectSources(project)) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
		const source = value as Record<string, unknown>;
		if (source.kind !== 'video' || source.timingAsset == null) continue;
		if (!source.timingAsset || typeof source.timingAsset !== 'object' || Array.isArray(source.timingAsset)) {
			throw new TypeError(`Source ${String(source.id)} has an invalid timing reference.`);
		}
		const reference = source.timingAsset as Record<string, unknown>;
		const storageKey = String(reference.storageKey);
		const asset = byStorageKey.get(storageKey);
		if (!asset || asset.sha256 !== reference.sha256 || asset.size !== reference.byteLength
			|| asset.encoding !== reference.encoding) {
			throw new Error(`The .scape archive is missing the bound timing asset for source ${String(source.id)}.`);
		}
		referenced.add(storageKey);
	}
	if (referenced.size !== timingAssets.length) throw new Error('The .scape archive contains an unreferenced timing asset.');
	return byStorageKey;
}

/** Snapshots the bounded normalized fallback contract from the exact current project schema. */
export function snapshotScapeProjectFallbackIntegrity(project: unknown): ScapeProjectFallbackSnapshot {
	if (!project || typeof project !== 'object' || Array.isArray(project)) {
		throw new TypeError('The migrated .scape project must be an object.');
	}
	const candidate = project as ScapeProjectWithSources;
	if (candidate.schemaVersion !== AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION) return NO_FALLBACK_SNAPSHOT;
	const sources = projectSources(project) as readonly Readonly<{ id?: unknown; kind?: unknown }>[];
	const clips = Array.isArray(candidate.clips)
		? candidate.clips as readonly Readonly<Record<string, unknown>>[]
		: [];
	const tracks = Array.isArray(candidate.tracks)
		? candidate.tracks as readonly Readonly<Record<string, unknown>>[]
		: [];
	const manifest = normalizeProjectFeatureRequirements(candidate.featureRequirements, {
		sources,
		clips,
		tracks,
		schemaVersion: candidate.schemaVersion,
		sampleRate: candidate.sampleRate,
		sequences: candidate.sequences,
		primarySequenceId: candidate.primarySequenceId,
	});
	const claims = Object.freeze(manifest.requirements.flatMap((requirement) => (
		requirement.disposition === 'rendered-fallback' && requirement.fallback
			? [Object.freeze({ ...requirement.fallback })]
			: []
	)));
	return Object.freeze({ featureRequirements: manifest, claims });
}

/** Binds serialized fallback claims to the completed canonical asset descriptors. */
export function assertScapeProjectFallbackAssets(
	claims: readonly ScapeProjectFallbackClaim[],
	assetBySourceId: ReadonlyMap<string, ScapeAssetDescriptor>,
): void {
	for (const claim of claims) {
		const asset = assetBySourceId.get(claim.sourceId);
		if (!asset) throw new Error(`The .scape archive is missing rendered fallback source ${claim.sourceId}.`);
		if (claim.kind !== asset.kind) {
			throw new Error(`Rendered fallback source ${claim.sourceId} kind does not match its .scape asset.`);
		}
		if (claim.sha256 !== asset.sha256) {
			throw new Error(`Rendered fallback source ${claim.sourceId} SHA-256 does not match its .scape asset.`);
		}
	}
}

function projectSources(project: unknown): readonly unknown[] {
	if (!project || typeof project !== 'object' || !Array.isArray((project as Partial<ScapeProjectWithSources>).sources)) {
		throw new TypeError('The migrated .scape project has invalid sources.');
	}
	return (project as ScapeProjectWithSources).sources;
}
