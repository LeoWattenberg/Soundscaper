/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors, awaitScapeOperation, throwIfScapeAborted } from '../scape-abort.ts';
import type { ScapeAssetDescriptor, ScapeManifest } from '../scape-archive-envelope.ts';
import { digestScapeBytes, verifyScapeExtractedAsset } from '../scape-archive-media.ts';
import { extractScapeVideo, SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
	type ScapeVideoWriter } from '../scape-archive-video.ts';
import type { PlannedScapeExportAsset } from '../scape-export-plan.ts';
import type { ScapeProjectAssetExtension, ScapeProjectAssetExtensionExportRequest,
	ScapeProjectAssetExtensionImportRequest } from '../scape-project-asset-extension.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../storage/media-content-digest.ts';
import type { OwnedMediaAssetPublication, OwnedMediaAssetWriter } from
	'../storage/media-asset-write-contract.ts';
import {
	ASSISTANCE_TTS_SCRIPT_BODY_MIME_TYPE_V1,
	ASSISTANCE_TTS_SCRIPT_STORAGE_KEY_PREFIX_V1,
	createAssistanceAssetReferenceV1,
	createAssistanceTtsScriptBodyReferenceV1,
	normalizeAssistanceAssetReferencesV1,
	validateAssistanceAssetSourceBindingsV1,
	type AssistanceAssetReferenceV1,
	type AssistanceTtsScriptAssetReferenceV1,
	type AssistanceTtsScriptBodyReferenceV1,
} from './assistance-asset-reference-v1.ts';
import { createAssistanceTtsScriptBodyV1, type AssistanceTtsScriptBodyV1 } from
	'./tts-script-body-publication-v1.ts';

export const ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1 = 'assistance-tts-script';
export const ASSISTANCE_TTS_SCRIPT_SCAPE_ENCODING_V1 = 'canonical-json-v1';

const VALIDATION = Symbol('TTS script Scape validation');
const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true });

interface BodyGroup {
	readonly body: Readonly<AssistanceTtsScriptBodyReferenceV1>;
	readonly references: readonly Readonly<AssistanceTtsScriptAssetReferenceV1>[];
}

interface ImportValidation {
	readonly [VALIDATION]: true;
	readonly groups: readonly Readonly<BodyGroup>[];
	readonly descriptorByStorageKey: ReadonlyMap<string, ScapeAssetDescriptor>;
}

interface ScriptMaterial {
	readonly reference: Readonly<AssistanceTtsScriptBodyReferenceV1>;
	readonly bytes: Uint8Array;
	readonly assets: readonly Readonly<AssistanceTtsScriptAssetReferenceV1>[];
}

export function createAssistanceTtsScriptScapeProjectAssetExtensionV1():
	Readonly<ScapeProjectAssetExtension> {
	return Object.freeze({
		assetKinds: Object.freeze([ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1]),
		sourceKinds: Object.freeze([ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1]),
		planExportAssets,
		validateExportAssetBody: validateExportBody,
		validateImportAssets,
		stageImportAssets,
		validateReboundProject: (project: unknown) => { projectAssets(project); },
		sourceStorageRole: () => 'none' as const,
	});
}

async function planExportAssets(request: Readonly<ScapeProjectAssetExtensionExportRequest>):
	Promise<readonly PlannedScapeExportAsset[]> {
	const { assets } = projectAssets(request.project);
	const result: PlannedScapeExportAsset[] = [];
	for (const group of bodyGroups(assets)) {
		throwIfScapeAborted(request.signal);
		const metadata = await awaitScapeOperation(
			request.store.getMediaAssetMetadata(group.body.storageKey), request.signal);
		assertStoredMetadata(metadata, group.body);
		result.push(exportAsset(group));
	}
	return Object.freeze(result);
}

async function validateExportBody(asset: PlannedScapeExportAsset, body: Blob,
	signal?: AbortSignal): Promise<void> {
	throwIfScapeAborted(signal);
	const group = plannedAuthority(asset);
	if (!(body instanceof Blob) || body.size !== asset.size
		|| await digestMediaContent(body, { signal }) !== asset.expectedSha256) {
		throw new Error('A TTS script export body changed after admission.');
	}
	authenticateBody(new Uint8Array(await body.arrayBuffer()), group.references);
}

function validateImportAssets(project: unknown, manifest: ScapeManifest): Readonly<ImportValidation> {
	const { assets } = projectAssets(project);
	const groups = bodyGroups(assets);
	const descriptors = manifest.assets.filter(({ kind }) => kind === ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1);
	if (descriptors.length !== groups.length) {
		throw new Error('The Scape TTS script inventory is incomplete or unreferenced.');
	}
	const descriptorByStorageKey = new Map<string, ScapeAssetDescriptor>();
	for (const descriptor of descriptors) {
		if (descriptorByStorageKey.has(descriptor.sourceId)) {
			throw new Error(`TTS script body ${descriptor.sourceId} is duplicated.`);
		}
		descriptorByStorageKey.set(descriptor.sourceId, descriptor);
	}
	for (const group of groups) assertDescriptor(descriptorByStorageKey.get(group.body.storageKey), group.body);
	return Object.freeze({ [VALIDATION]: true as const, groups, descriptorByStorageKey });
}

async function stageImportAssets(request: Readonly<ScapeProjectAssetExtensionImportRequest>): Promise<void> {
	const validation = importValidation(request.validation);
	const archive = projectAssets(request.archiveProject);
	if (!sameAssetCollection(archive.assets, validation.groups.flatMap(({ references }) => references))) {
		throw new Error('TTS script import validation lost its archive project authority.');
	}
	const current = projectAssets(request.project);
	const currentById = new Map(current.assets.map((asset) => [asset.id, asset]));
	if (currentById.size !== archive.assets.length) {
		throw new Error('The rebound project changed the TTS script inventory.');
	}
	const nextById = new Map(currentById);
	for (const group of validation.groups) {
		throwIfScapeAborted(request.signal);
		const descriptor = validation.descriptorByStorageKey.get(group.body.storageKey)!;
		const entry = request.entryByName.get(descriptor.entry);
		if (!entry) throw new Error(`The Scape archive is missing ${descriptor.entry}.`);
		const archiveBytes = await readArchiveBytes(entry, descriptor, group.body, request);
		const script = authenticateBody(archiveBytes, group.references);
		const currentAssets = group.references.map((original) => reboundAsset(original,
			currentById.get(original.id), request.sourceIdMap));
		const targetIds = new Set(currentAssets.map(({ sourceId }) => sourceId));
		if (targetIds.size !== 1) throw new Error('Shared TTS script bytes acquired conflicting sources.');
		const material = reboundMaterial(script, archiveBytes, currentAssets, currentAssets[0]!.sourceId);
		await stageBody(material, request);
		for (const asset of currentAssets) nextById.set(asset.id, createTtsReference({
			...asset, body: material.reference,
		}));
	}
	request.project.assistanceAssets = normalizeAssistanceAssetReferencesV1(
		current.allAssets.map((asset) => nextById.get(asset.id) ?? asset));
}

function projectAssets(project: unknown): Readonly<{
	readonly assets: readonly Readonly<AssistanceTtsScriptAssetReferenceV1>[];
	readonly allAssets: readonly Readonly<AssistanceAssetReferenceV1>[];
}> {
	const row = record(project, 'TTS script project');
	const allAssets = normalizeAssistanceAssetReferencesV1(row.assistanceAssets);
	validateAssistanceAssetSourceBindingsV1(allAssets, row.sources);
	return Object.freeze({ allAssets, assets: Object.freeze(allAssets.filter(
		(asset): asset is AssistanceTtsScriptAssetReferenceV1 => asset.kind === 'tts-script-v1')) });
}

function bodyGroups(assets: readonly Readonly<AssistanceTtsScriptAssetReferenceV1>[]):
	readonly Readonly<BodyGroup>[] {
	const groups = new Map<string, { body: Readonly<AssistanceTtsScriptBodyReferenceV1>;
		references: AssistanceTtsScriptAssetReferenceV1[] }>();
	for (const asset of assets) {
		const existing = groups.get(asset.body.storageKey);
		if (existing) {
			if (JSON.stringify(existing.body) !== JSON.stringify(asset.body)) {
				throw new Error(`TTS script body ${asset.body.storageKey} has conflicting references.`);
			}
			existing.references.push(asset);
		} else groups.set(asset.body.storageKey, { body: asset.body, references: [asset] });
	}
	return Object.freeze([...groups.values()].map(({ body, references }) =>
		Object.freeze({ body, references: Object.freeze(references) })));
}

function exportAsset(group: Readonly<BodyGroup>): PlannedScapeExportAsset {
	const body = group.body;
	return Object.freeze({
		source: Object.freeze({ kind: ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1,
			id: body.storageKey, storageKey: body.storageKey, name: 'TTS script',
			mimeType: body.mimeType, assistanceReferences: group.references }),
		sourceId: body.storageKey, storageKey: body.storageKey,
		kind: ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1,
		entry: `assistance-tts-script/${body.sha256}.json`,
		encoding: ASSISTANCE_TTS_SCRIPT_SCAPE_ENCODING_V1,
		mimeType: body.mimeType, size: body.byteLength, expectedSha256: body.sha256,
	});
}

function plannedAuthority(asset: PlannedScapeExportAsset): Readonly<BodyGroup> {
	const source = record(asset.source, 'planned TTS script');
	const references = normalizeAssistanceAssetReferencesV1(source.assistanceReferences)
		.filter((value): value is AssistanceTtsScriptAssetReferenceV1 => value.kind === 'tts-script-v1');
	const groups = bodyGroups(references);
	if (groups.length !== 1) throw new Error('A planned TTS script lost its body authority.');
	const expected = exportAsset(groups[0]!);
	if (asset.sourceId !== expected.sourceId || asset.storageKey !== expected.storageKey
		|| asset.kind !== expected.kind || asset.entry !== expected.entry
		|| asset.encoding !== expected.encoding || asset.mimeType !== expected.mimeType
		|| asset.size !== expected.size || asset.expectedSha256 !== expected.expectedSha256) {
		throw new Error('A planned TTS script conflicts with its project authority.');
	}
	return groups[0]!;
}

function assertDescriptor(value: ScapeAssetDescriptor | undefined,
	body: Readonly<AssistanceTtsScriptBodyReferenceV1>): void {
	if (!value || value.sourceId !== body.storageKey
		|| value.kind !== ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1
		|| value.entry !== `assistance-tts-script/${body.sha256}.json`
		|| value.encoding !== ASSISTANCE_TTS_SCRIPT_SCAPE_ENCODING_V1
		|| value.mimeType !== body.mimeType || value.size !== body.byteLength
		|| value.sha256 !== body.sha256) {
		throw new Error('A TTS script descriptor conflicts with its project reference.');
	}
}

function authenticateBody(bytes: Uint8Array,
	references: readonly Readonly<AssistanceTtsScriptAssetReferenceV1>[]): AssistanceTtsScriptBodyV1 {
	let parsed: unknown;
	try { parsed = JSON.parse(UTF8_FATAL.decode(bytes)); }
	catch (cause) { throw new TypeError('A TTS script body must be canonical UTF-8 JSON.', { cause }); }
	const body = createAssistanceTtsScriptBodyV1(parsed);
	if (!sameBytes(UTF8.encode(JSON.stringify(body)), bytes)) {
		throw new Error('A TTS script body is not in exact canonical form.');
	}
	const sha256 = digestScapeBytes(bytes);
	for (const reference of references) {
		if (body.sourceId !== reference.sourceId
			|| body.recipe.id !== reference.recipeId || body.recipe.version !== reference.recipeVersion
			|| JSON.stringify(body.artifactSha256s) !== JSON.stringify(reference.modelArtifactSha256s)
			|| reference.body.byteLength !== bytes.byteLength || reference.body.sha256 !== sha256) {
			throw new Error('A TTS script body conflicts with its project reference.');
		}
	}
	return body;
}

function reboundAsset(original: Readonly<AssistanceTtsScriptAssetReferenceV1>,
	currentValue: Readonly<AssistanceTtsScriptAssetReferenceV1> | undefined,
	sourceIdMap: ReadonlyMap<string, string>): Readonly<AssistanceTtsScriptAssetReferenceV1> {
	if (!currentValue) throw new Error(`Rebound TTS script ${original.id} is missing.`);
	const current = createTtsReference(currentValue);
	if (current.sourceId !== (sourceIdMap.get(original.sourceId) ?? original.sourceId)
		|| JSON.stringify({ ...current, sourceId: original.sourceId }) !== JSON.stringify(original)) {
		throw new Error(`TTS script ${original.id} did not follow its exact source rebind.`);
	}
	return current;
}

function reboundMaterial(body: AssistanceTtsScriptBodyV1, archiveBytes: Uint8Array,
	assets: readonly Readonly<AssistanceTtsScriptAssetReferenceV1>[],
	targetSourceId: string): Readonly<ScriptMaterial> {
	const rebound = body.sourceId === targetSourceId ? body : createAssistanceTtsScriptBodyV1({
		...body, sourceId: targetSourceId,
	});
	const bytes = rebound === body ? archiveBytes : UTF8.encode(JSON.stringify(rebound));
	const sha256 = digestScapeBytes(bytes);
	const reference = createAssistanceTtsScriptBodyReferenceV1({
		storageKey: `${ASSISTANCE_TTS_SCRIPT_STORAGE_KEY_PREFIX_V1}${sha256}`,
		mimeType: ASSISTANCE_TTS_SCRIPT_BODY_MIME_TYPE_V1,
		byteLength: bytes.byteLength, sha256,
	});
	const reboundAssets = Object.freeze(assets.map((asset) => createTtsReference({
		...asset, body: reference,
	})));
	authenticateBody(bytes, reboundAssets);
	return Object.freeze({ reference, bytes, assets: reboundAssets });
}

async function readArchiveBytes(entry: Parameters<typeof extractScapeVideo>[0],
	descriptor: ScapeAssetDescriptor, body: Readonly<AssistanceTtsScriptBodyReferenceV1>,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let bytesWritten = 0;
	const writer: ScapeVideoWriter = {
		maximumChunkBytes: SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
		get bytesWritten() { return bytesWritten; },
		async write(value) {
			if (value.byteLength > body.byteLength - bytesWritten) {
				throw new RangeError('A TTS script archive body exceeded its admitted size.');
			}
			chunks.push(value.slice()); bytesWritten += value.byteLength;
		},
		async commit() { return {}; }, async abort() {},
	};
	const extracted = await extractScapeVideo(entry, writer, request.signal, request.expandedByteBudget);
	verifyScapeExtractedAsset(descriptor, extracted.digest, extracted.size, body.storageKey);
	const bytes = new Uint8Array(body.byteLength);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	if (offset !== bytes.byteLength) throw new Error('A TTS script archive body ended early.');
	return bytes;
}

async function stageBody(material: Readonly<ScriptMaterial>,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>): Promise<void> {
	const existing = await awaitScapeOperation(
		request.store.getMediaAssetMetadata(material.reference.storageKey), request.signal);
	if (existing !== null && existing !== undefined) {
		assertStoredMetadata(existing, material.reference);
		await verifyStoredBody(material, request);
		return;
	}
	const writerValue = await awaitScapeOperation(request.store.beginMediaAssetWrite(
		material.reference.storageKey,
		{ name: `${material.reference.sha256}.json`, mimeType: material.reference.mimeType,
			kind: ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1,
			encoding: ASSISTANCE_TTS_SCRIPT_SCAPE_ENCODING_V1 },
		{ expectedBytes: material.reference.byteLength,
			expectedSha256: material.reference.sha256,
			...(request.signal ? { signal: request.signal } : {}) },
	), request.signal);
	if (!writerValue || typeof writerValue.commitOwned !== 'function'
		|| writerValue.maximumChunkBytes !== SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES) {
		throw new TypeError('TTS script import requires an exact bounded owned media writer.');
	}
	const writer = writerValue as OwnedMediaAssetWriter;
	let publication: OwnedMediaAssetPublication | null = null;
	let tracked = false;
	try {
		for (let offset = 0; offset < material.bytes.byteLength; offset += writer.maximumChunkBytes) {
			throwIfScapeAborted(request.signal);
			await writer.write(material.bytes.subarray(offset, offset + writer.maximumChunkBytes),
				request.signal ? { signal: request.signal } : {});
		}
		publication = await writer.commitOwned(request.signal ? { signal: request.signal } : {});
		request.transaction.trackProvisionalMedia(publication);
		tracked = true;
		throwIfScapeAborted(request.signal);
		assertStoredMetadata(publication.metadata, material.reference);
	} catch (error) {
		if (tracked) throw error;
		try {
			if (publication) await publication.discardIfCurrent(); else await writer.abort();
		} catch (cleanupError) {
			throw aggregateScapeErrors(error, [cleanupError], 'TTS script write and cleanup failed.');
		}
		throw error;
	}
}

async function verifyStoredBody(material: Readonly<ScriptMaterial>,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>): Promise<void> {
	if (typeof request.store.loadMediaAsset !== 'function') {
		throw new TypeError('TTS script import requires immutable media-body reads.');
	}
	const loaded = await awaitScapeOperation(request.store.loadMediaAsset(
		material.reference.storageKey, request.signal ? { signal: request.signal } : {}), request.signal);
	if (!loaded) throw new Error('A stored TTS script body is unavailable.');
	const blob = canonicalMediaContentBlob(loaded);
	if (blob.size !== material.reference.byteLength
		|| await digestMediaContent(blob, { signal: request.signal }) !== material.reference.sha256) {
		throw new Error('A stored TTS script body conflicts with immutable content.');
	}
	authenticateBody(new Uint8Array(await blob.arrayBuffer()), material.assets);
}

function assertStoredMetadata(value: unknown, reference: Readonly<AssistanceTtsScriptBodyReferenceV1>): void {
	const row = record(value, `stored TTS script ${reference.storageKey} metadata`);
	if (row.sourceId !== reference.storageKey || row.size !== reference.byteLength
		|| row.sha256 !== reference.sha256 || row.mimeType !== reference.mimeType
		|| row.kind !== ASSISTANCE_TTS_SCRIPT_SCAPE_KIND_V1
		|| row.encoding !== ASSISTANCE_TTS_SCRIPT_SCAPE_ENCODING_V1) {
		throw new Error(`TTS script body ${reference.storageKey} has conflicting metadata.`);
	}
}

function importValidation(value: unknown): ImportValidation {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (value as Partial<ImportValidation>)[VALIDATION] !== true
		|| !Array.isArray((value as Partial<ImportValidation>).groups)
		|| !((value as Partial<ImportValidation>).descriptorByStorageKey instanceof Map)) {
		throw new TypeError('Exact TTS script Scape import validation is required.');
	}
	return value as ImportValidation;
}

function sameAssetCollection(left: readonly Readonly<AssistanceTtsScriptAssetReferenceV1>[],
	right: readonly Readonly<AssistanceTtsScriptAssetReferenceV1>[]): boolean {
	const byId = new Map(left.map((asset) => [asset.id, JSON.stringify(asset)]));
	return left.length === right.length
		&& right.every((asset) => byId.get(asset.id) === JSON.stringify(asset));
}

function createTtsReference(value: AssistanceTtsScriptAssetReferenceV1):
	Readonly<AssistanceTtsScriptAssetReferenceV1> {
	const result = createAssistanceAssetReferenceV1(value);
	if (result.kind !== 'tts-script-v1') throw new TypeError('A TTS script reference changed kind.');
	return result;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}
