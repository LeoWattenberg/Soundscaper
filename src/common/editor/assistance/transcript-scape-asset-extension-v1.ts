/* SPDX-License-Identifier: AGPL-3.0-only */

import { aggregateScapeErrors, awaitScapeOperation, throwIfScapeAborted } from '../scape-abort.ts';
import type { ScapeAssetDescriptor, ScapeManifest } from '../scape-archive-envelope.ts';
import { digestScapeBytes, verifyScapeExtractedAsset } from '../scape-archive-media.ts';
import {
	extractScapeVideo,
	SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
	type ScapeVideoWriter,
} from '../scape-archive-video.ts';
import type { PlannedScapeExportAsset } from '../scape-export-plan.ts';
import type {
	ScapeProjectAssetExtension,
	ScapeProjectAssetExtensionExportRequest,
	ScapeProjectAssetExtensionImportRequest,
} from '../scape-project-asset-extension.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../storage/media-content-digest.ts';
import type {
	OwnedMediaAssetPublication,
	OwnedMediaAssetWriter,
} from '../storage/media-asset-write-contract.ts';
import {
	ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
	createAssistanceAssetReferenceV1,
	createAssistanceTranscriptBodyReferenceV1,
	normalizeAssistanceAssetReferencesV1,
	validateAssistanceAssetSourceBindingsV1,
	type AssistanceTranscriptAssetReferenceV1,
	type AssistanceTranscriptBodyReferenceV1,
} from './assistance-asset-reference-v1.ts';
import {
	ASSISTANCE_TRANSCRIPT_SCHEMA_VERSION,
	createAssistanceTranscript,
	type AssistanceTranscript,
	type TranscriptDraft,
} from './transcript.ts';

export const ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1 = 'assistance-transcript';
export const ASSISTANCE_TRANSCRIPT_SCAPE_ENCODING_V1 = 'canonical-json-v1';

const VALIDATION = Symbol('assistance transcript Scape validation');
const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true });

interface BodyGroup {
	readonly body: Readonly<AssistanceTranscriptBodyReferenceV1>;
	readonly references: readonly Readonly<AssistanceTranscriptAssetReferenceV1>[];
}

interface AssistanceTranscriptScapeValidationV1 {
	readonly [VALIDATION]: true;
	readonly groups: readonly Readonly<BodyGroup>[];
	readonly descriptorByStorageKey: ReadonlyMap<string, ScapeAssetDescriptor>;
	readonly sampleRate: number;
}

interface TranscriptMaterial {
	readonly reference: Readonly<AssistanceTranscriptBodyReferenceV1>;
	readonly bytes: Uint8Array;
	readonly assets: readonly Readonly<AssistanceTranscriptAssetReferenceV1>[];
	readonly sampleRate: number;
}

/** Strict portable custody for project-owned, content-addressed transcript bodies. */
export function createAssistanceTranscriptScapeProjectAssetExtensionV1():
	Readonly<ScapeProjectAssetExtension> {
	const extension: ScapeProjectAssetExtension = {
		assetKinds: Object.freeze([ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1]),
		// Transcript references live at the project root; this reserved source
		// kind only satisfies the common extension namespace contract.
		sourceKinds: Object.freeze([ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1]),
		planExportAssets: (request) => planExportAssets(request),
		validateExportAssetBody: (asset, body, signal) => validateExportBody(asset, body, signal),
		validateImportAssets: (project, manifest) => validateImportAssets(project, manifest),
		stageImportAssets: (request) => stageImportAssets(request),
		validateReboundProject: (project) => { projectAssets(project); },
		sourceStorageRole: () => 'none',
	};
	return Object.freeze(extension);
}

async function planExportAssets(
	request: Readonly<ScapeProjectAssetExtensionExportRequest>,
): Promise<readonly PlannedScapeExportAsset[]> {
	const { assets, sampleRate } = projectAssets(request.project);
	const result: PlannedScapeExportAsset[] = [];
	for (const group of bodyGroups(assets)) {
		throwIfScapeAborted(request.signal);
		const metadata = await awaitScapeOperation(
			request.store.getMediaAssetMetadata(group.body.storageKey),
			request.signal,
		);
		assertStoredMetadata(metadata, group.body);
		result.push(exportAsset(group, sampleRate));
	}
	return Object.freeze(result);
}

async function validateExportBody(
	asset: PlannedScapeExportAsset,
	bodyValue: Blob,
	signal?: AbortSignal,
): Promise<void> {
	throwIfScapeAborted(signal);
	const { references, sampleRate } = plannedAuthority(asset);
	if (!(bodyValue instanceof Blob) || bodyValue.size !== asset.size
		|| await digestMediaContent(bodyValue, { signal }) !== asset.expectedSha256) {
		throw new Error('An assistance transcript export body changed after admission.');
	}
	const bytes = new Uint8Array(await bodyValue.arrayBuffer());
	authenticateTranscriptBody(bytes, references, sampleRate);
}

function validateImportAssets(
	project: unknown,
	manifest: ScapeManifest,
): Readonly<AssistanceTranscriptScapeValidationV1> {
	const { assets, sampleRate } = projectAssets(project);
	const groups = bodyGroups(assets);
	const descriptors = manifest.assets.filter(
		({ kind }) => kind === ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1,
	);
	if (descriptors.length !== groups.length) {
		throw new Error('The `.scape` assistance transcript inventory is incomplete or unreferenced.');
	}
	const descriptorByStorageKey = new Map<string, ScapeAssetDescriptor>();
	for (const descriptor of descriptors) {
		if (descriptorByStorageKey.has(descriptor.sourceId)) {
			throw new Error(`Assistance transcript body ${descriptor.sourceId} is duplicated.`);
		}
		descriptorByStorageKey.set(descriptor.sourceId, descriptor);
	}
	for (const group of groups) assertDescriptor(descriptorByStorageKey.get(group.body.storageKey), group.body);
	return Object.freeze({
		[VALIDATION]: true as const,
		groups,
		descriptorByStorageKey,
		sampleRate,
	});
}

async function stageImportAssets(
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<void> {
	const validation = importValidation(request.validation);
	const archive = projectAssets(request.archiveProject);
	if (!sameAssetCollection(archive.assets, validation.groups.flatMap(({ references }) => references))) {
		throw new Error('The assistance transcript import validation lost its archive project authority.');
	}
	const current = projectAssets(request.project);
	if (current.sampleRate !== validation.sampleRate) {
		throw new Error('The rebound project changed the assistance transcript sample rate.');
	}
	const currentById = new Map(current.assets.map((asset) => [asset.id, asset]));
	const nextById = new Map(currentById);
	if (currentById.size !== archive.assets.length) {
		throw new Error('The rebound project changed the assistance transcript inventory.');
	}
	for (const group of validation.groups) {
		throwIfScapeAborted(request.signal);
		const descriptor = validation.descriptorByStorageKey.get(group.body.storageKey)!;
		const entry = request.entryByName.get(descriptor.entry);
		if (!entry) throw new Error(`The .scape archive is missing ${descriptor.entry}.`);
		const archiveBytes = await readArchiveBytes(entry, descriptor, group.body, request);
		const transcript = authenticateTranscriptBody(archiveBytes, group.references, validation.sampleRate);
		const currentAssets = group.references.map((original) => reboundAsset(
			original,
			currentById.get(original.id),
			request.sourceIdMap,
		));
		const targetSourceIds = new Set(currentAssets.map(({ sourceId }) => sourceId));
		if (targetSourceIds.size !== 1) {
			throw new Error('Shared assistance transcript bytes acquired conflicting rebound sources.');
		}
		const targetSourceId = currentAssets[0]!.sourceId;
		const material = reboundMaterial(transcript, archiveBytes, currentAssets, targetSourceId);
		await stageBody(material, request);
		for (const asset of currentAssets) nextById.set(asset.id, createAssistanceAssetReferenceV1({
			...asset,
			body: material.reference,
		}));
	}
	request.project.assistanceAssets = normalizeAssistanceAssetReferencesV1(
		current.assets.map(({ id }) => nextById.get(id)!),
	);
}

function exportAsset(group: Readonly<BodyGroup>, sampleRate: number): PlannedScapeExportAsset {
	const body = group.body;
	return Object.freeze({
		source: Object.freeze({
			kind: ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1,
			id: body.storageKey,
			storageKey: body.storageKey,
			name: 'Assistance transcript',
			mimeType: body.mimeType,
			assistanceReferences: group.references,
			projectSampleRate: sampleRate,
		}),
		sourceId: body.storageKey,
		storageKey: body.storageKey,
		kind: ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1,
		entry: `assistance-transcript/${body.sha256}.json`,
		encoding: ASSISTANCE_TRANSCRIPT_SCAPE_ENCODING_V1,
		mimeType: body.mimeType,
		size: body.byteLength,
		expectedSha256: body.sha256,
	});
}

function assertDescriptor(
	value: ScapeAssetDescriptor | undefined,
	body: Readonly<AssistanceTranscriptBodyReferenceV1>,
): asserts value is ScapeAssetDescriptor {
	if (!value || value.sourceId !== body.storageKey
		|| value.kind !== ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1
		|| value.entry !== `assistance-transcript/${body.sha256}.json`
		|| value.encoding !== ASSISTANCE_TRANSCRIPT_SCAPE_ENCODING_V1
		|| value.mimeType !== body.mimeType
		|| value.size !== body.byteLength
		|| value.sha256 !== body.sha256) {
		throw new Error('An assistance transcript descriptor conflicts with its project reference.');
	}
}

async function readArchiveBytes(
	entry: Parameters<typeof extractScapeVideo>[0],
	descriptor: ScapeAssetDescriptor,
	body: Readonly<AssistanceTranscriptBodyReferenceV1>,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let bytesWritten = 0;
	const writer: ScapeVideoWriter = {
		maximumChunkBytes: SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
		get bytesWritten() { return bytesWritten; },
		async write(value) {
			if (value.byteLength > body.byteLength - bytesWritten) {
				throw new RangeError('An assistance transcript archive body exceeded its admitted size.');
			}
			chunks.push(value.slice());
			bytesWritten += value.byteLength;
		},
		async commit() { return {}; },
		async abort() {},
	};
	const extracted = await extractScapeVideo(
		entry, writer, request.signal, request.expandedByteBudget,
	);
	verifyScapeExtractedAsset(descriptor, extracted.digest, extracted.size, body.storageKey);
	const bytes = new Uint8Array(body.byteLength);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	if (offset !== bytes.byteLength) {
		throw new Error('An assistance transcript archive body ended before its admitted size.');
	}
	return bytes;
}

function reboundMaterial(
	transcript: AssistanceTranscript,
	archiveBytes: Uint8Array,
	assets: readonly Readonly<AssistanceTranscriptAssetReferenceV1>[],
	targetSourceId: string,
): Readonly<TranscriptMaterial> {
	const body = targetSourceId === transcript.sourceId ? transcript : createAssistanceTranscript({
		sourceId: targetSourceId,
		sampleRate: transcript.sampleRate,
		language: transcript.language,
		modelId: transcript.modelId,
		segments: transcript.segments,
	});
	const bytes = body === transcript ? archiveBytes : UTF8.encode(JSON.stringify(body));
	const sha256 = digestScapeBytes(bytes);
	const reference = createAssistanceTranscriptBodyReferenceV1({
		storageKey: `assistance-transcript-sha256:${sha256}`,
		mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
		byteLength: bytes.byteLength,
		sha256,
	});
	const reboundAssets = assets.map((asset) => createAssistanceAssetReferenceV1({
		...asset,
		body: reference,
	}));
	authenticateTranscriptBody(bytes, reboundAssets, transcript.sampleRate);
	return Object.freeze({
		reference,
		bytes,
		assets: Object.freeze(reboundAssets),
		sampleRate: transcript.sampleRate,
	});
}

async function stageBody(
	material: Readonly<TranscriptMaterial>,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<void> {
	const existing = await awaitScapeOperation(
		request.store.getMediaAssetMetadata(material.reference.storageKey),
		request.signal,
	);
	if (existing !== null && existing !== undefined) {
		assertStoredMetadata(existing, material.reference);
		await verifyStoredBody(material, request);
		return;
	}
	const writerValue = await awaitScapeOperation(request.store.beginMediaAssetWrite(
		material.reference.storageKey,
		{
			name: `${material.reference.sha256}.json`,
			mimeType: material.reference.mimeType,
			kind: ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1,
			encoding: ASSISTANCE_TRANSCRIPT_SCAPE_ENCODING_V1,
		},
		{
			expectedBytes: material.reference.byteLength,
			expectedSha256: material.reference.sha256,
			...(request.signal ? { signal: request.signal } : {}),
		},
	), request.signal);
	if (!writerValue || typeof writerValue.commitOwned !== 'function'
		|| writerValue.maximumChunkBytes !== SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES) {
		throw new TypeError('Assistance transcript import requires an exact bounded owned media writer.');
	}
	const writer = writerValue as OwnedMediaAssetWriter;
	let publication: OwnedMediaAssetPublication | null = null;
	let tracked = false;
	try {
		for (let offset = 0; offset < material.bytes.byteLength; offset += writer.maximumChunkBytes) {
			throwIfScapeAborted(request.signal);
			await writer.write(
				material.bytes.subarray(offset, offset + writer.maximumChunkBytes),
				request.signal ? { signal: request.signal } : {},
			);
		}
		publication = await writer.commitOwned(request.signal ? { signal: request.signal } : {});
		request.transaction.trackProvisionalMedia(publication);
		tracked = true;
		throwIfScapeAborted(request.signal);
		assertStoredMetadata(publication.metadata, material.reference);
	} catch (error) {
		if (tracked) throw error;
		return cleanupWriter(error, writer, publication);
	}
}

async function verifyStoredBody(
	material: Readonly<TranscriptMaterial>,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<void> {
	if (typeof request.store.loadMediaAsset !== 'function') {
		throw new TypeError('Assistance transcript import requires immutable media-body reads.');
	}
	const loaded = await awaitScapeOperation(request.store.loadMediaAsset(
		material.reference.storageKey,
		request.signal ? { signal: request.signal } : {},
	), request.signal);
	if (!loaded) throw new Error('A stored assistance transcript body is unavailable.');
	const body = canonicalMediaContentBlob(loaded);
	if (body.size !== material.reference.byteLength
		|| await digestMediaContent(body, { signal: request.signal }) !== material.reference.sha256) {
		throw new Error('A stored assistance transcript body conflicts with immutable content.');
	}
	authenticateTranscriptBody(
		new Uint8Array(await body.arrayBuffer()),
		material.assets,
		material.sampleRate,
	);
}

function authenticateTranscriptBody(
	bytes: Uint8Array,
	references: readonly Readonly<AssistanceTranscriptAssetReferenceV1>[],
	sampleRate: number,
): AssistanceTranscript {
	let parsed: unknown;
	try {
		parsed = JSON.parse(UTF8_FATAL.decode(bytes));
	} catch (error) {
		throw new TypeError('An assistance transcript body must be canonical UTF-8 JSON.', { cause: error });
	}
	const record = dataRecord(parsed, 'assistance transcript body');
	if (record.schemaVersion !== ASSISTANCE_TRANSCRIPT_SCHEMA_VERSION) {
		throw new RangeError('An assistance transcript body has an unsupported schema version.');
	}
	const transcript = createAssistanceTranscript(record as unknown as TranscriptDraft);
	const canonical = UTF8.encode(JSON.stringify(transcript));
	if (!sameBytes(canonical, bytes)) {
		throw new Error('An assistance transcript body is not in exact canonical form.');
	}
	if (transcript.sampleRate !== sampleRate) {
		throw new Error('An assistance transcript body changed its project sample rate.');
	}
	for (const reference of references) {
		if (transcript.sourceId !== reference.sourceId) {
			throw new Error('An assistance transcript body source identity conflicts with its project reference.');
		}
		if (reference.body.byteLength !== bytes.byteLength
			|| reference.body.sha256 !== digestScapeBytes(bytes)) {
			throw new Error('An assistance transcript body bytes conflict with their project reference.');
		}
		for (const segment of transcript.segments) {
			if (segment.startFrame < reference.sourceStartFrame
				|| segment.endFrame > reference.sourceEndFrame) {
				throw new RangeError('An assistance transcript body exceeds its selected source range.');
			}
		}
	}
	return transcript;
}

function projectAssets(project: unknown): Readonly<{
	readonly assets: readonly Readonly<AssistanceTranscriptAssetReferenceV1>[];
	readonly sampleRate: number;
}> {
	const record = dataRecord(project, 'assistance transcript project');
	const assets = normalizeAssistanceAssetReferencesV1(record.assistanceAssets);
	validateAssistanceAssetSourceBindingsV1(assets, record.sources);
	const sampleRate = positiveInteger(record.sampleRate, 'project sample rate');
	return Object.freeze({ assets, sampleRate });
}

function bodyGroups(
	assets: readonly Readonly<AssistanceTranscriptAssetReferenceV1>[],
): readonly Readonly<BodyGroup>[] {
	const groups = new Map<string, {
		body: Readonly<AssistanceTranscriptBodyReferenceV1>;
		references: Readonly<AssistanceTranscriptAssetReferenceV1>[];
	}>();
	for (const asset of assets) {
		const existing = groups.get(asset.body.storageKey);
		if (existing) {
			if (!sameBodyReference(existing.body, asset.body)) {
				throw new Error(`Assistance transcript body ${asset.body.storageKey} has conflicting references.`);
			}
			existing.references.push(asset);
		} else {
			groups.set(asset.body.storageKey, { body: asset.body, references: [asset] });
		}
	}
	return Object.freeze([...groups.values()].map(({ body, references }) => Object.freeze({
		body,
		references: Object.freeze(references),
	})));
}

function plannedAuthority(asset: PlannedScapeExportAsset): Readonly<{
	readonly references: readonly Readonly<AssistanceTranscriptAssetReferenceV1>[];
	readonly sampleRate: number;
}> {
	const source = asset.source as Readonly<Record<string, unknown>>;
	const references = normalizeAssistanceAssetReferencesV1(source.assistanceReferences);
	const sampleRate = positiveInteger(source.projectSampleRate, 'planned transcript sample rate');
	const groups = bodyGroups(references);
	if (groups.length !== 1) throw new Error('A planned transcript body lost its single-body authority.');
	const expected = exportAsset(groups[0]!, sampleRate);
	if (asset.sourceId !== expected.sourceId || asset.storageKey !== expected.storageKey
		|| asset.kind !== expected.kind || asset.entry !== expected.entry
		|| asset.encoding !== expected.encoding || asset.mimeType !== expected.mimeType
		|| asset.size !== expected.size || asset.expectedSha256 !== expected.expectedSha256) {
		throw new Error('A planned transcript body conflicts with its project authority.');
	}
	return Object.freeze({ references, sampleRate });
}

function reboundAsset(
	original: Readonly<AssistanceTranscriptAssetReferenceV1>,
	currentValue: Readonly<AssistanceTranscriptAssetReferenceV1> | undefined,
	sourceIdMap: ReadonlyMap<string, string>,
): Readonly<AssistanceTranscriptAssetReferenceV1> {
	if (!currentValue) throw new Error(`Rebound assistance asset ${original.id} is missing.`);
	const current = createAssistanceAssetReferenceV1(currentValue);
	const expectedSourceId = sourceIdMap.get(original.sourceId) ?? original.sourceId;
	if (current.sourceId !== expectedSourceId
		|| !sameBodyReference(current.body, original.body)
		|| !sameReferenceApartFromRebind(current, original)) {
		throw new Error(`Assistance asset ${original.id} did not follow its exact source rebind.`);
	}
	return current;
}

function sameReferenceApartFromRebind(
	left: Readonly<AssistanceTranscriptAssetReferenceV1>,
	right: Readonly<AssistanceTranscriptAssetReferenceV1>,
): boolean {
	return left.id === right.id && left.kind === right.kind
		&& left.sourceSha256 === right.sourceSha256
		&& left.sourceStartFrame === right.sourceStartFrame
		&& left.sourceEndFrame === right.sourceEndFrame
		&& left.sourceVideoTimingSha256 === right.sourceVideoTimingSha256
		&& left.recipeId === right.recipeId && left.recipeVersion === right.recipeVersion
		&& JSON.stringify(left.modelArtifactSha256s) === JSON.stringify(right.modelArtifactSha256s);
}

function sameAssetCollection(
	left: readonly Readonly<AssistanceTranscriptAssetReferenceV1>[],
	right: readonly Readonly<AssistanceTranscriptAssetReferenceV1>[],
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function assertStoredMetadata(
	value: unknown,
	reference: Readonly<AssistanceTranscriptBodyReferenceV1>,
): void {
	const metadata = dataRecord(value, `stored transcript ${reference.storageKey} metadata`);
	if (metadata.sourceId !== reference.storageKey
		|| metadata.size !== reference.byteLength
		|| metadata.sha256 !== reference.sha256
		|| metadata.mimeType !== reference.mimeType
		|| metadata.kind !== ASSISTANCE_TRANSCRIPT_SCAPE_KIND_V1
		|| metadata.encoding !== ASSISTANCE_TRANSCRIPT_SCAPE_ENCODING_V1) {
		throw new Error(`Assistance transcript body ${reference.storageKey} is unavailable or has conflicting metadata.`);
	}
}

async function cleanupWriter(
	primary: unknown,
	writer: OwnedMediaAssetWriter,
	publication: OwnedMediaAssetPublication | null,
): Promise<never> {
	try {
		if (publication) await publication.discardIfCurrent();
		else await writer.abort();
	} catch (cleanupError) {
		throw aggregateScapeErrors(
			primary,
			[cleanupError],
			'The assistance transcript write and cleanup both failed.',
		);
	}
	throw primary;
}

function importValidation(value: unknown): AssistanceTranscriptScapeValidationV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (value as Partial<AssistanceTranscriptScapeValidationV1>)[VALIDATION] !== true
		|| !Array.isArray((value as Partial<AssistanceTranscriptScapeValidationV1>).groups)
		|| !((value as Partial<AssistanceTranscriptScapeValidationV1>).descriptorByStorageKey instanceof Map)) {
		throw new TypeError('Exact assistance transcript Scape import validation is required.');
	}
	return value as AssistanceTranscriptScapeValidationV1;
}

function sameBodyReference(
	left: Readonly<AssistanceTranscriptBodyReferenceV1>,
	right: Readonly<AssistanceTranscriptBodyReferenceV1>,
): boolean {
	return left.storageKey === right.storageKey && left.mimeType === right.mimeType
		&& left.byteLength === right.byteLength && left.sha256 === right.sha256;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}
