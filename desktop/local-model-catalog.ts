/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The catalog of models the product offers, and what state each one is in.
 *
 * The catalog is data rather than code, so offering a model is a reviewed data
 * change. V2 is authenticated before parsing and binds each offered entry to
 * the canonical digest of one complete, permitted licensing-evidence row.
 * Refused, unresolved, unsigned, and unmirrored models never enter the runtime
 * catalog.
 *
 * Distribution provenance also distinguishes an identity mirror from a
 * reproducible conversion. Identity mirrors must match every upstream byte;
 * conversions instead pin their reviewed recipe, revision, and environment.
 */

import {
	localModelEvidenceSha256,
	verifyLocalModelCatalogSignature,
} from './local-model-catalog-signature.ts';
import type { LocalModelCatalogSignatureOptions } from './local-model-catalog-signature.ts';

export const LOCAL_MODEL_CATALOG_SCHEMA_VERSION = 2;

export const LOCAL_MODEL_TASKS = Object.freeze([
	'voice-activity-detection',
	'speech-recognition',
	'word-alignment',
	'speaker-segmentation',
	'speaker-embedding',
	'speech-enhancement',
	'source-separation',
	'audio-tagging',
	'beat-tracking',
	'face-detection',
	'object-detection',
	'saliency-detection',
	'optical-character-recognition',
	'image-text-embedding',
	'text-embedding',
	'shot-detection',
	'editorial-generation',
] as const);

export type LocalModelTask = (typeof LOCAL_MODEL_TASKS)[number];

export const LOCAL_MODEL_PLATFORMS = Object.freeze([
	'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64',
] as const);

export type LocalModelPlatform = (typeof LOCAL_MODEL_PLATFORMS)[number];

export type LocalModelAvailability =
	| 'installed'
	| 'installable'
	| 'unsupported-platform'
	| 'insufficient-memory';

export interface LocalModelCatalogArtifact {
	readonly fileName: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly url: string;
}

/**
 * Where the upstream bytes came from, pinned to an immutable revision. This is
 * provenance, never the shipped download path: upstream hosts gate, rename,
 * and move their CDNs, so the product serves its own mirror.
 */
export interface LocalModelUpstream {
	readonly source: string;
	readonly revision: string;
	readonly artifacts: readonly LocalModelCatalogArtifact[];
}

export interface LocalModelLicensingEvidencePin {
	readonly id: string;
	readonly sha256: string;
}

export interface LocalModelIdentityDistribution {
	readonly kind: 'identity-mirrored';
}

export interface LocalModelDerivedDistribution {
	readonly kind: 'reproducibly-derived';
	/** Repository-relative, reviewed conversion recipe. */
	readonly recipe: string;
	/** Immutable recipe or conversion-toolchain revision. */
	readonly revision: string;
	/** Digest of the locked conversion environment or container. */
	readonly environmentSha256: string;
}

export type LocalModelDistribution = LocalModelIdentityDistribution | LocalModelDerivedDistribution;

export interface LocalModelCatalogEntry {
	readonly modelId: string;
	readonly version: string;
	readonly task: LocalModelTask;
	readonly platforms: readonly LocalModelPlatform[];
	readonly minimumMemoryBytes: number;
	readonly licensingEvidence: LocalModelLicensingEvidencePin;
	readonly upstream: LocalModelUpstream;
	readonly distribution: LocalModelDistribution;
	readonly artifacts: readonly LocalModelCatalogArtifact[];
}

export const LOCAL_MODEL_JURISDICTIONS = Object.freeze(['eu', 'fedramp'] as const);

export type LocalModelJurisdiction = (typeof LOCAL_MODEL_JURISDICTIONS)[number];

export interface LocalModelPublication {
	readonly bucket: string;
	readonly prefix: string;
	readonly publicBaseUrl: string;
	/**
	 * The R2 jurisdiction the bucket lives in, or null for the default. A
	 * jurisdiction-scoped bucket is invisible to any request that does not name
	 * its jurisdiction, which surfaces as "the specified bucket does not exist"
	 * rather than as a permission error, so it is recorded rather than assumed.
	 */
	readonly jurisdiction: LocalModelJurisdiction | null;
}

export interface LocalModelCatalog {
	readonly schemaVersion: typeof LOCAL_MODEL_CATALOG_SCHEMA_VERSION;
	readonly publication: LocalModelPublication;
	readonly entries: readonly LocalModelCatalogEntry[];
}

export interface LocalModelCatalogBinding {
	/** Complete register rows; catalog entries pin their canonical digest. */
	readonly licensingEvidence: readonly unknown[];
	/** Model ids the product refused to distribute. */
	readonly refusedIds?: readonly string[];
}

const IDENTIFIER_PATTERN = /^[a-z\d][a-z\d.-]*[a-z\d]$/u;
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const FILE_NAME_PATTERN = /^[A-Za-z\d](?:[A-Za-z\d._-]{0,158}[A-Za-z\d])?$/u;
const RECIPE_PATH_PATTERN = /^[A-Za-z\d](?:[A-Za-z\d._/-]*[A-Za-z\d])?$/u;

function fail(message: string): never {
	throw new Error(message);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertArtifact(value: unknown, modelId: string, index: number): LocalModelCatalogArtifact {
	if (typeof value !== 'object' || value === null) fail(`${modelId}: artifact ${index} must be an object`);
	const candidate = value as Partial<LocalModelCatalogArtifact>;
	if (typeof candidate.fileName !== 'string' || !FILE_NAME_PATTERN.test(candidate.fileName)) {
		fail(`${modelId}: artifact ${index} needs a plain relative file name`);
	}
	if (!Number.isSafeInteger(candidate.byteLength) || (candidate.byteLength as number) <= 0) {
		fail(`${modelId}: artifact ${index} byte length is out of range`);
	}
	if (typeof candidate.sha256 !== 'string' || !SHA256_PATTERN.test(candidate.sha256)) {
		fail(`${modelId}: artifact ${index} needs a lowercase SHA-256 digest`);
	}
	if (typeof candidate.url !== 'string' || !candidate.url.startsWith('https://')) {
		fail(`${modelId}: artifact ${index} must be downloaded over https`);
	}
	return Object.freeze({
		fileName: candidate.fileName,
		byteLength: candidate.byteLength as number,
		sha256: candidate.sha256,
		url: candidate.url,
	});
}

function assertLicensingEvidence(
	value: unknown,
	modelId: string,
	binding: LocalModelCatalogBinding,
): LocalModelLicensingEvidencePin {
	if (!plainRecord(value)
		|| value.id !== modelId
		|| typeof value.sha256 !== 'string'
		|| !SHA256_PATTERN.test(value.sha256)) {
		fail(`${modelId}: licensingEvidence must pin its exact evidence row`);
	}
	const matching = binding.licensingEvidence.filter((record) => plainRecord(record) && record.id === modelId);
	if (matching.length !== 1) {
		fail(`${modelId}: needs exactly one licensing evidence record`);
	}
	if ((binding.refusedIds ?? []).includes(modelId)) {
		fail(`${modelId}: refused models cannot be cataloged`);
	}
	const record = matching[0] as Record<string, unknown>;
	if (record.distributionStatus !== 'permitted') {
		fail(`${modelId}: licensing evidence distribution status must be permitted`);
	}
	if (!Array.isArray(record.blockedBy) || record.blockedBy.length !== 0) {
		fail(`${modelId}: permitted licensing evidence cannot retain blockers`);
	}
	if (!plainRecord(record.requirements) || Object.keys(record.requirements).length === 0) {
		fail(`${modelId}: licensing evidence needs recorded requirements`);
	}
	for (const [requirementId, requirement] of Object.entries(record.requirements)) {
		if (!plainRecord(requirement) || requirement.status !== 'recorded') {
			fail(`${modelId}: licensing requirement ${requirementId} must be recorded`);
		}
	}
	if (localModelEvidenceSha256(record) !== value.sha256) {
		fail(`${modelId}: licensing evidence digest does not match the reviewed row`);
	}
	return Object.freeze({ id: modelId, sha256: value.sha256 });
}

function assertDistribution(value: unknown, modelId: string): LocalModelDistribution {
	if (!plainRecord(value)) fail(`${modelId}: distribution must describe the shipped artifacts`);
	if (value.kind === 'identity-mirrored') {
		if (Object.keys(value).length !== 1) {
			fail(`${modelId}: identity-mirrored distribution cannot carry a derivation recipe`);
		}
		return Object.freeze({ kind: 'identity-mirrored' });
	}
	if (value.kind !== 'reproducibly-derived') {
		fail(`${modelId}: distribution kind is unrecognised`);
	}
	if (typeof value.recipe !== 'string'
		|| !RECIPE_PATH_PATTERN.test(value.recipe)
		|| value.recipe.split('/').includes('..')
		|| typeof value.revision !== 'string'
		|| value.revision.trim() === ''
		|| typeof value.environmentSha256 !== 'string'
		|| !SHA256_PATTERN.test(value.environmentSha256)) {
		fail(`${modelId}: reproducibly-derived distribution needs a pinned recipe, revision, and environment`);
	}
	return Object.freeze({
		kind: 'reproducibly-derived',
		recipe: value.recipe,
		revision: value.revision,
		environmentSha256: value.environmentSha256,
	});
}

function assertEntry(
	value: unknown,
	binding: LocalModelCatalogBinding,
	seen: Set<string>,
): LocalModelCatalogEntry {
	if (typeof value !== 'object' || value === null) fail('A catalog entry must be an object');
	const candidate = value as Partial<LocalModelCatalogEntry>;
	const modelId = candidate.modelId;
	if (typeof modelId !== 'string' || !IDENTIFIER_PATTERN.test(modelId)) {
		fail('A catalog entry needs a lowercase, dot or dash separated model id');
	}
	if (seen.has(modelId)) fail(`${modelId}: duplicate catalog entry`);
	seen.add(modelId);

	const licensingEvidence = assertLicensingEvidence(candidate.licensingEvidence, modelId, binding);
	if (typeof candidate.version !== 'string' || candidate.version.trim() === '') {
		fail(`${modelId}: version must be a non-empty string`);
	}
	if (!LOCAL_MODEL_TASKS.includes(candidate.task as LocalModelTask)) {
		fail(`${modelId}: task is unrecognised`);
	}
	const platforms = candidate.platforms;
	if (!Array.isArray(platforms) || platforms.length === 0
		|| platforms.some((platform) => !LOCAL_MODEL_PLATFORMS.includes(platform as LocalModelPlatform))) {
		fail(`${modelId}: platforms must name at least one supported platform`);
	}
	if (!Number.isSafeInteger(candidate.minimumMemoryBytes) || (candidate.minimumMemoryBytes as number) <= 0) {
		fail(`${modelId}: minimumMemoryBytes must be a positive integer`);
	}
	const upstream = assertUpstream(candidate.upstream ?? null, modelId);
	if (upstream === null) fail(`${modelId}: offered models need pinned upstream provenance`);
	const distribution = assertDistribution(candidate.distribution, modelId);

	const artifacts = candidate.artifacts ?? null;
	if (!Array.isArray(artifacts) || artifacts.length === 0) {
		fail(`${modelId}: distribution artifacts must be a non-empty array`);
	}
	const mirrored = Object.freeze(artifacts.map((artifact, index) => assertArtifact(artifact, modelId, index)));
	const mirroredNames = new Set<string>();
	for (const artifact of mirrored) {
		if (mirroredNames.has(artifact.fileName)) fail(`${modelId}: distribution repeats ${artifact.fileName}`);
		mirroredNames.add(artifact.fileName);
	}

	if (distribution.kind === 'identity-mirrored') {
		// A mirror copies bytes; it never re-encodes them, so the digests must
		// agree file for file. A divergence means the mirror is not the artifact
		// that passed review.
		for (const artifact of mirrored) {
			const origin = upstream.artifacts.find(({ fileName }) => fileName === artifact.fileName);
			if (!origin) fail(`${modelId}: identity-mirrored ${artifact.fileName} has no upstream artifact`);
			if (origin.sha256 !== artifact.sha256 || origin.byteLength !== artifact.byteLength) {
				fail(`${modelId}: identity-mirrored ${artifact.fileName} does not match its upstream bytes`);
			}
		}
		if (mirrored.length !== upstream.artifacts.length) {
			fail(`${modelId}: identity-mirrored distribution must include every upstream artifact`);
		}
	}

	return Object.freeze({
		modelId,
		version: candidate.version,
		task: candidate.task as LocalModelTask,
		platforms: Object.freeze([...platforms] as LocalModelPlatform[]),
		minimumMemoryBytes: candidate.minimumMemoryBytes as number,
		licensingEvidence,
		upstream,
		distribution,
		artifacts: mirrored,
	});
}

function assertUpstream(value: unknown, modelId: string): LocalModelUpstream | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'object') fail(`${modelId}: upstream must be an object or null`);
	const candidate = value as Partial<LocalModelUpstream>;
	if (typeof candidate.source !== 'string' || !candidate.source.startsWith('https://')) {
		fail(`${modelId}: upstream source must be an https URL`);
	}
	if (typeof candidate.revision !== 'string' || candidate.revision.trim() === '') {
		fail(`${modelId}: upstream revision must pin an immutable point`);
	}
	const artifacts = candidate.artifacts;
	if (!Array.isArray(artifacts) || artifacts.length === 0) {
		fail(`${modelId}: upstream needs at least one artifact`);
	}
	const seen = new Set<string>();
	const pinned = artifacts.map((artifact, index) => {
		const asserted = assertArtifact(artifact, modelId, index);
		if (seen.has(asserted.fileName)) fail(`${modelId}: upstream repeats ${asserted.fileName}`);
		seen.add(asserted.fileName);
		return asserted;
	});
	return Object.freeze({
		source: candidate.source,
		revision: candidate.revision,
		artifacts: Object.freeze(pinned),
	});
}

function assertPublication(value: unknown): LocalModelPublication {
	if (typeof value !== 'object' || value === null) fail('A local model catalog needs a publication block');
	const candidate = value as Partial<LocalModelPublication>;
	if (typeof candidate.bucket !== 'string' || !/^[a-z\d][a-z\d.-]{1,61}[a-z\d]$/u.test(candidate.bucket)) {
		fail('The publication bucket name is invalid');
	}
	if (typeof candidate.prefix !== 'string' || !/^[a-z\d][a-z\d/-]*[a-z\d]$/u.test(candidate.prefix)) {
		fail('The publication prefix must be a plain lowercase path segment');
	}
	if (typeof candidate.publicBaseUrl !== 'string' || !candidate.publicBaseUrl.startsWith('https://')
		|| !candidate.publicBaseUrl.endsWith('/')) {
		fail('The publication base URL must be an https URL ending in a slash');
	}
	const jurisdiction = candidate.jurisdiction ?? null;
	if (jurisdiction !== null && !LOCAL_MODEL_JURISDICTIONS.includes(jurisdiction)) {
		fail('The publication jurisdiction is unrecognised');
	}
	return Object.freeze({
		bucket: candidate.bucket,
		prefix: candidate.prefix,
		publicBaseUrl: candidate.publicBaseUrl,
		jurisdiction,
	});
}

/**
 * The object key and public URL a mirrored artifact takes. Keys carry the
 * model version so a new revision publishes beside the old one rather than
 * replacing bytes an installed manifest still names.
 */
export function plannedMirrorLocation(
	catalog: LocalModelCatalog,
	entry: LocalModelCatalogEntry,
	fileName: string,
): { readonly key: string; readonly url: string } {
	const key = `${catalog.publication.prefix}/${entry.modelId}/${entry.version}/${fileName}`;
	return Object.freeze({ key, url: `${catalog.publication.publicBaseUrl}${entry.modelId}/${entry.version}/${fileName}` });
}

/** Validates a catalog against the licensing register it must agree with. */
export function validateLocalModelCatalog(
	value: unknown,
	binding: LocalModelCatalogBinding,
	signatureOptions: LocalModelCatalogSignatureOptions = {},
): LocalModelCatalog {
	const candidate = verifyLocalModelCatalogSignature(value, signatureOptions) as Partial<LocalModelCatalog>;
	if (candidate.schemaVersion !== LOCAL_MODEL_CATALOG_SCHEMA_VERSION) {
		fail('The local model catalog schema version is unsupported');
	}
	if (!Array.isArray(candidate.entries)) fail('A local model catalog needs an array of entries');
	if (!Array.isArray(binding?.licensingEvidence)) {
		fail('A local model catalog needs its complete licensing evidence rows');
	}
	const publication = assertPublication(candidate.publication);
	const seen = new Set<string>();
	return Object.freeze({
		schemaVersion: LOCAL_MODEL_CATALOG_SCHEMA_VERSION,
		publication,
		entries: Object.freeze(candidate.entries.map((entry) => assertEntry(entry, binding, seen))),
	});
}

export interface LocalModelAvailabilityContext {
	readonly platform: string;
	readonly totalMemoryBytes: number;
	readonly installedModelIds: readonly string[];
}

/** What the model manager should show for an entry on this machine. */
export function describeModelAvailability(
	entry: LocalModelCatalogEntry,
	context: LocalModelAvailabilityContext,
): LocalModelAvailability {
	if (!entry.platforms.includes(context.platform as LocalModelPlatform)) return 'unsupported-platform';
	if (context.totalMemoryBytes < entry.minimumMemoryBytes) return 'insufficient-memory';
	if (context.installedModelIds.includes(entry.modelId)) return 'installed';
	return 'installable';
}

/** Total digest-pinned download size. */
export function catalogEntryDownloadBytes(entry: LocalModelCatalogEntry): number {
	return entry.artifacts.reduce((total, artifact) => total + artifact.byteLength, 0);
}
