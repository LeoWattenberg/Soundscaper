/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The catalog of models the product offers, and what state each one is in.
 *
 * The catalog is data rather than code, so offering a model is a reviewed data
 * change. It is bound to the licensing register: a catalog entry must name a
 * model that already carries an evidence record and must not name one the
 * product refused, which makes it impossible to offer a download for weights
 * that never passed licence review.
 *
 * An entry whose artifacts are not yet pinned is legal and is reported as
 * pending rather than hidden. That is the honest state today: the licensing
 * gate blocks every model on `versioned-download-notices-and-hashes` until an
 * artifact is mirrored, so the catalog says so instead of pretending the
 * download exists.
 */

export const LOCAL_MODEL_CATALOG_SCHEMA_VERSION = 1;

export const LOCAL_MODEL_TASKS = Object.freeze([
	'voice-activity-detection',
	'speech-recognition',
	'speaker-segmentation',
	'speaker-embedding',
	'speech-enhancement',
	'source-separation',
	'face-detection',
	'object-detection',
	'saliency-detection',
	'optical-character-recognition',
	'image-text-embedding',
	'text-embedding',
] as const);

export type LocalModelTask = (typeof LOCAL_MODEL_TASKS)[number];

export const LOCAL_MODEL_PLATFORMS = Object.freeze([
	'darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64',
] as const);

export type LocalModelPlatform = (typeof LOCAL_MODEL_PLATFORMS)[number];

export type LocalModelAvailability =
	| 'installed'
	| 'installable'
	| 'pending-artifacts'
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

export interface LocalModelCatalogEntry {
	readonly modelId: string;
	readonly version: string;
	readonly task: LocalModelTask;
	readonly platforms: readonly LocalModelPlatform[];
	readonly minimumMemoryBytes: number;
	/** Null until the upstream artifacts have been pinned and verified. */
	readonly upstream: LocalModelUpstream | null;
	/** Null until those artifacts are mirrored to the product's own host. */
	readonly artifacts: readonly LocalModelCatalogArtifact[] | null;
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
	/** Model ids carrying a licensing evidence record. */
	readonly evidenceIds: readonly string[];
	/** Model ids the product refused to distribute. */
	readonly refusedIds?: readonly string[];
}

const IDENTIFIER_PATTERN = /^[a-z\d][a-z\d.-]*[a-z\d]$/u;
const SHA256_PATTERN = /^[a-f\d]{64}$/u;
const FILE_NAME_PATTERN = /^[A-Za-z\d](?:[A-Za-z\d._-]{0,158}[A-Za-z\d])?$/u;

function fail(message: string): never {
	throw new Error(message);
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

	if (!binding.evidenceIds.includes(modelId)) {
		fail(`${modelId}: catalog entries need a licensing evidence record`);
	}
	if ((binding.refusedIds ?? []).includes(modelId)) {
		fail(`${modelId}: refused models cannot be cataloged`);
	}
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

	const artifacts = candidate.artifacts ?? null;
	if (artifacts !== null && (!Array.isArray(artifacts) || artifacts.length === 0)) {
		fail(`${modelId}: artifacts must be null or a non-empty array`);
	}
	const mirrored = artifacts === null
		? null
		: Object.freeze(artifacts.map((artifact, index) => assertArtifact(artifact, modelId, index)));

	if (mirrored !== null) {
		if (upstream === null) {
			fail(`${modelId}: mirrored artifacts need the upstream they were taken from`);
		}
		// A mirror copies bytes; it never re-encodes them, so the digests must
		// agree file for file. A divergence means the mirror is not the artifact
		// that passed review.
		for (const artifact of mirrored) {
			const origin = upstream.artifacts.find(({ fileName }) => fileName === artifact.fileName);
			if (!origin) fail(`${modelId}: mirrored ${artifact.fileName} has no upstream artifact`);
			if (origin.sha256 !== artifact.sha256 || origin.byteLength !== artifact.byteLength) {
				fail(`${modelId}: mirrored ${artifact.fileName} does not match its upstream bytes`);
			}
		}
	}

	return Object.freeze({
		modelId,
		version: candidate.version,
		task: candidate.task as LocalModelTask,
		platforms: Object.freeze([...platforms] as LocalModelPlatform[]),
		minimumMemoryBytes: candidate.minimumMemoryBytes as number,
		upstream,
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
): LocalModelCatalog {
	if (typeof value !== 'object' || value === null) fail('A local model catalog must be an object');
	const candidate = value as Partial<LocalModelCatalog>;
	if (candidate.schemaVersion !== LOCAL_MODEL_CATALOG_SCHEMA_VERSION) {
		fail('The local model catalog schema version is unsupported');
	}
	if (!Array.isArray(candidate.entries)) fail('A local model catalog needs an array of entries');
	if (!Array.isArray(binding?.evidenceIds)) fail('A local model catalog needs its licensing evidence ids');
	const seen = new Set<string>();
	return Object.freeze({
		schemaVersion: LOCAL_MODEL_CATALOG_SCHEMA_VERSION,
		publication: assertPublication(candidate.publication),
		entries: Object.freeze(candidate.entries.map((entry) => assertEntry(entry, binding, seen))),
	});
}

export interface LocalModelAvailabilityContext {
	readonly platform: string;
	readonly totalMemoryBytes: number;
	readonly installedModelIds: readonly string[];
}

/**
 * What the model manager should show for an entry. Installation is reported
 * before capability, because a model already on disk stays usable and
 * removable on a machine that could no longer install it.
 */
export function describeModelAvailability(
	entry: LocalModelCatalogEntry,
	context: LocalModelAvailabilityContext,
): LocalModelAvailability {
	if (context.installedModelIds.includes(entry.modelId)) return 'installed';
	if (!entry.platforms.includes(context.platform as LocalModelPlatform)) return 'unsupported-platform';
	if (context.totalMemoryBytes < entry.minimumMemoryBytes) return 'insufficient-memory';
	if (entry.artifacts === null) return 'pending-artifacts';
	return 'installable';
}

/** Total download size, or null when the artifacts are not yet pinned. */
export function catalogEntryDownloadBytes(entry: LocalModelCatalogEntry): number | null {
	if (entry.artifacts === null) return null;
	return entry.artifacts.reduce((total, artifact) => total + artifact.byteLength, 0);
}
