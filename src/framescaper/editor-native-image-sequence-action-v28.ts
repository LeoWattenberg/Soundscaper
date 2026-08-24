/* SPDX-License-Identifier: AGPL-3.0-only */

/** Selected-V28 menu composition for pathless, main-admitted image sequences. */

import type { OwnedMediaAssetPublication } from '../common/editor/storage/media-asset-write-contract.ts';
import {
	bindFramescaperNativeProjectActionRuntime,
	composeFramescaperNativeProjectActionRuntimes,
	createFramescaperNativeProjectActionSubsetRuntime,
	framescaperNativeProjectActionRuntimeFor,
	type FramescaperNativeProjectActionRuntime,
} from '../common/editor/ui/framescaper-native-project-actions.ts';
import type { FramescaperNativeServicesBridge } from '../common/editor/ui/framescaper-native-services-bridge.ts';
import {
	createFramescaperImageSequenceProductionPortsV25,
	type FramescaperImageSequenceProductionPortsV25,
} from './editor-native-image-sequence-import-production-ports-v25.ts';
import { composeFramescaperImageSequenceImportV25 } from './editor-native-image-sequence-import-v25.ts';
import { selectFramescaperDesktopImageSequenceV25 } from './editor-native-image-sequence-selection-v25.ts';
import {
	snapshotFramescaperNativeImageSequenceImportRequestV28,
	type FramescaperNativeImageSequenceImportRequestV28,
} from './editor-native-project-action-requests-v28.ts';
import { createFramescaperImageSequenceSourceAdmissionCommandV25 } from './editor-project-v25-source-command.ts';
import { cloneFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';

const SURFACES = Object.freeze(['image-sequence-import'] as const);
const MAXIMUM_BODY_CHUNK_BYTES = 16 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

interface ImageSequenceControllerV28 {
	readonly project: unknown;
	readonly actions: Readonly<{
		readonly edit: Readonly<{
			commit(command: unknown): unknown;
			undo(): unknown;
		}>;
		readonly project: Readonly<{ save(): unknown }>;
	}>;
}

interface ImageSequenceBodyStoreV28 {
	getMediaAssetMetadata(storageKey: string): PromiseLike<unknown> | unknown;
	beginMediaAssetWrite(
		storageKey: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string }>,
	): PromiseLike<unknown> | unknown;
}

export interface BindFramescaperNativeImageSequenceActionV28Options {
	readonly profile: unknown;
	readonly owner: ImageSequenceControllerV28;
	readonly store: ImageSequenceBodyStoreV28;
	readonly bridge: FramescaperNativeImageSequenceActionBridgeV28;
	readonly mintId?: () => string;
}

export type FramescaperNativeImageSequenceActionBridgeV28 = Required<Pick<
	FramescaperNativeServicesBridge,
	'capabilities' | 'selectImageSequence' | 'readImageSequenceFile' | 'releaseImageSequence'
	| 'imageSequenceImport' | 'writeImageSequenceImportChunk' | 'readImageSequenceImportBody'
>>;

export function framescaperNativeImageSequenceActionBridgeAvailableV28(
	value: unknown,
): value is FramescaperNativeImageSequenceActionBridgeV28 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const bridge = value as Readonly<Record<string, unknown>>;
	return [
		'capabilities', 'selectImageSequence', 'readImageSequenceFile', 'releaseImageSequence',
		'imageSequenceImport', 'writeImageSequenceImportChunk', 'readImageSequenceImportBody',
	].every((method) => typeof bridge[method] === 'function');
}

/** Compose into the existing menu action runtime; no new visible UI is created. */
export function bindFramescaperNativeImageSequenceActionV28(
	options: BindFramescaperNativeImageSequenceActionV28Options,
): FramescaperNativeProjectActionRuntime {
	assertOptions(options);
	const existing = framescaperNativeProjectActionRuntimeFor(options.owner);
	if (!existing) throw new Error('Selected V28 image-sequence import requires its existing native action runtime.');
	if (existing.surfaces.includes('image-sequence-import')) {
		throw new Error('Selected V28 image-sequence import is already bound.');
	}
	const mintId = options.mintId ?? (() => `image-sequence-${globalThis.crypto.randomUUID()}`);
	const importSequence = serialize((request: FramescaperNativeImageSequenceImportRequestV28) => (
		importCurrentSequence(options, mintId, request)
	));
	const runtime = composeFramescaperNativeProjectActionRuntimes([
		existing,
		createFramescaperNativeProjectActionSubsetRuntime(SURFACES, {
			'image-sequence-import': (request) => importSequence(
				snapshotFramescaperNativeImageSequenceImportRequestV28(request),
			),
		}),
	]);
	bindFramescaperNativeProjectActionRuntime(options.owner, runtime);
	return runtime;
}

async function importCurrentSequence(
	options: BindFramescaperNativeImageSequenceActionV28Options,
	mintId: () => string,
	request: FramescaperNativeImageSequenceImportRequestV28,
): Promise<void> {
	const project = cloneFramescaperProjectV28(options.profile, options.owner.project);
	const bridge = exactBridge(options.bridge);
	const ports = createFramescaperImageSequenceProductionPortsV25({
		bridge, candidateGeneration: 28,
		projectId: stableId(project.id, 'project ID'),
		projectRevision: nonNegativeInteger(project.revision, 'project revision'),
	});
	const sourceId = stableId(mintId(), 'source ID');
	const projectBinClipId = stableId(mintId(), 'Project Bin clip ID');
	await composeFramescaperImageSequenceImportV25({
		profile: options.profile,
		project,
		select: () => selectFramescaperDesktopImageSequenceV25({
			bridge, sourceId, projectBinClipId, name: 'Image-Sequence',
			frameRate: request.frameRate,
		}),
		ports,
		commit: (source, projectBinClip) => commitImportedSequence(
			options, project, ports, source, projectBinClip,
		),
	});
}

async function commitImportedSequence(
	options: BindFramescaperNativeImageSequenceActionV28Options,
	project: FramescaperProjectV28,
	ports: FramescaperImageSequenceProductionPortsV25,
	sourceValue: Readonly<Record<string, unknown>>,
	projectBinClip: Readonly<Record<string, unknown>>,
): Promise<void> {
	assertCurrentProject(options, project);
	const source = createFramescaperImageSequenceSourceAdmissionCommandV25(sourceValue);
	if (own(projectBinClip, 'sourceId') !== source.source.id) {
		throw new Error('The V28 image-sequence Project Bin clip changed source identity.');
	}
	const sequence = record(source.source.imageSequence, 'V28 image-sequence descriptor');
	const publications: OwnedMediaAssetPublication[] = [];
	let committed = false;
	try {
		for (const asset of ['inventory', 'pack'] as const) {
			const reference = record(
				sequence[asset === 'inventory' ? 'inventory' : 'sourcePack'],
				`V28 image-sequence ${asset}`,
			);
			const publication = await mirrorBody(options.store, ports, asset, reference);
			if (publication) publications.push(publication);
		}
		assertCurrentProject(options, project);
		await options.owner.actions.edit.commit({
			type: 'batch', commands: [
				source, { type: 'project-bin/add', clip: projectBinClip },
			],
		});
		committed = true;
		await options.owner.actions.project.save();
	} catch (error) {
		const failures: unknown[] = [error];
		if (committed) {
			try { await options.owner.actions.edit.undo(); }
			catch (undoError) { failures.push(undoError); }
		}
		for (const publication of publications.reverse()) {
			try { await publication.discardIfCurrent(); }
			catch (cleanupError) { failures.push(cleanupError); }
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, 'V28 image-sequence commit rollback failed.', { cause: error });
		}
		throw error;
	}
}

async function mirrorBody(
	store: ImageSequenceBodyStoreV28,
	ports: FramescaperImageSequenceProductionPortsV25,
	asset: 'pack' | 'inventory',
	reference: Readonly<Record<string, unknown>>,
): Promise<OwnedMediaAssetPublication | null> {
	const spec = bodySpec(asset, reference);
	const existing = await store.getMediaAssetMetadata(spec.storageKey);
	if (existing !== null && existing !== undefined) {
		assertBodyMetadata(existing, spec);
		return null;
	}
	const writer = await store.beginMediaAssetWrite(spec.storageKey, {
		name: spec.storageKey, kind: spec.kind, encoding: spec.encoding, mimeType: spec.mimeType,
	}, { expectedBytes: spec.byteLength, expectedSha256: spec.sha256 });
	assertWriter(writer);
	try {
		for (let offset = 0; offset < spec.byteLength;) {
			const length = Math.min(writer.maximumChunkBytes, spec.byteLength - offset);
			const bytes = await ports.readCommittedBody({
				asset, reference: reference as never, offset, length,
			});
			if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
				throw new Error('The V28 image-sequence body mirror returned an inexact range.');
			}
			await writer.write(bytes.slice());
			offset += length;
		}
		const publication = await writer.commitOwned();
		assertPublication(publication, spec);
		return publication;
	} catch (error) {
		try { await writer.abort(); }
		catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError], 'V28 image-sequence body mirror cleanup failed.', { cause: error },
			);
		}
		throw error;
	}
}

interface BodySpec {
	readonly storageKey: string;
	readonly kind: 'image-sequence-inventory' | 'image-sequence-source-pack';
	readonly encoding: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

function bodySpec(asset: 'pack' | 'inventory', value: Readonly<Record<string, unknown>>): BodySpec {
	const storageKey = stableId(own(value, 'storageKey'), 'body storage key');
	const sha256 = digest(own(value, 'sha256'));
	const byteLength = positiveInteger(own(value, 'byteLength'), 'body byte length');
	const inventory = asset === 'inventory';
	const kind = inventory ? 'image-sequence-inventory' : 'image-sequence-source-pack';
	if (own(value, 'kind') !== kind || storageKey !== `${inventory
		? 'image-sequence-inventory-sha256:' : 'image-sequence-pack-sha256:'}${sha256}`) {
		throw new Error('The V28 image-sequence body reference is not digest-bound.');
	}
	return Object.freeze({
		storageKey, kind,
		encoding: inventory
			? 'framescaper-image-sequence-inventory-v1'
			: 'framescaper-image-sequence-source-pack-v1',
		mimeType: inventory ? 'application/json'
			: 'application/vnd.soundscaper.image-sequence-pack',
		byteLength, sha256,
	});
}

function assertBodyMetadata(value: unknown, spec: BodySpec): void {
	const row = record(value, 'V28 image-sequence body metadata');
	if (row.sourceId !== spec.storageKey || row.kind !== spec.kind
		|| row.encoding !== spec.encoding || row.mimeType !== spec.mimeType
		|| row.size !== spec.byteLength || row.sha256 !== spec.sha256) {
		throw new Error('A local V28 image-sequence body conflicts with its immutable descriptor.');
	}
}

function assertPublication(value: unknown, spec: BodySpec): asserts value is OwnedMediaAssetPublication {
	const publication = value as Partial<OwnedMediaAssetPublication> | null;
	if (!publication || typeof publication.discardIfCurrent !== 'function') {
		throw new TypeError('The V28 image-sequence body publication is not rollback-owned.');
	}
	assertBodyMetadata(publication.metadata, spec);
}

function assertWriter(value: unknown): asserts value is Readonly<{
	readonly maximumChunkBytes: number;
	write(bytes: Uint8Array): PromiseLike<void> | void;
	commitOwned(): PromiseLike<OwnedMediaAssetPublication> | OwnedMediaAssetPublication;
	abort(): PromiseLike<void> | void;
}> {
	const writer = value as Readonly<Record<string, unknown>> | null;
	if (!writer || !Number.isSafeInteger(writer.maximumChunkBytes)
		|| Number(writer.maximumChunkBytes) < 1
		|| Number(writer.maximumChunkBytes) > MAXIMUM_BODY_CHUNK_BYTES
		|| ['write', 'commitOwned', 'abort'].some((method) => typeof writer[method] !== 'function')) {
		throw new TypeError('V28 image-sequence mirroring requires an exact bounded owned writer.');
	}
}

function exactBridge(value: unknown): FramescaperNativeImageSequenceActionBridgeV28 {
	if (!framescaperNativeImageSequenceActionBridgeAvailableV28(value)) {
		throw new Error('Selected V28 image-sequence import requires the complete authenticated desktop bridge.');
	}
	return value;
}

function assertCurrentProject(
	options: BindFramescaperNativeImageSequenceActionV28Options,
	expected: FramescaperProjectV28,
): void {
	const current = cloneFramescaperProjectV28(options.profile, options.owner.project);
	if (current.id !== expected.id || current.revision !== expected.revision) {
		throw new Error('The selected V28 project changed during image-sequence admission.');
	}
}

function assertOptions(options: BindFramescaperNativeImageSequenceActionV28Options): void {
	cloneFramescaperProjectV28(options.profile, options.owner?.project);
	if (!options.store || typeof options.store.getMediaAssetMetadata !== 'function'
		|| typeof options.store.beginMediaAssetWrite !== 'function'
		|| !options.owner?.actions || typeof options.owner.actions.edit?.commit !== 'function'
		|| typeof options.owner.actions.edit.undo !== 'function'
		|| typeof options.owner.actions.project?.save !== 'function'
		|| (options.mintId !== undefined && typeof options.mintId !== 'function')) {
		throw new TypeError('Selected V28 image-sequence action options are invalid.');
	}
	exactBridge(options.bridge);
}

function serialize<Request>(
	operation: (request: Request) => Promise<void>,
): (request: Request) => Promise<void> {
	let tail = Promise.resolve();
	return (request) => {
		const run = (): Promise<void> => operation(request);
		const result = tail.then(run, run);
		tail = result.then(() => undefined, () => undefined);
		return result;
	};
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function own(value: Readonly<Record<string, unknown>>, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`V28 image-sequence ${field} must be an own data property.`);
	}
	return descriptor.value;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) {
		throw new TypeError(`The V28 image-sequence ${label} is invalid.`);
	}
	return value;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError('The V28 image-sequence body digest is invalid.');
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new TypeError(`The V28 image-sequence ${label} is invalid.`);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new TypeError(`The V28 image-sequence ${label} is invalid.`);
	}
	return Number(value);
}
