/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { ScapeVideoProxyArchiveAssetDescriptorV2 } from '../common/editor/scape-video-proxy-archive-plan-v2.ts';
import { planScapeVideoProxyArchiveAssetsV2 } from '../common/editor/scape-video-proxy-archive-plan-v2.ts';
import { parseScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../common/editor/video-timing-asset-reference.ts';
import { cloneFramescaperProjectV18, type FramescaperProjectV18 } from './editor-project-v18.ts';
import { framescaperScapeAttachmentInventoryV18 } from './scape-project-preservation-v18-support.ts';

export const FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;

export interface FramescaperDesktopV10ProxyBody {
	readonly kind: 'video-proxy';
	readonly encoding: 'video-proxy-v1';
	readonly bindingId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperDesktopV10TimingBody {
	readonly kind: 'video-timing';
	readonly encoding: typeof VIDEO_TIMING_ASSET_ENCODING;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: typeof VIDEO_TIMING_ASSET_MIME_TYPE;
	readonly byteLength: number;
	readonly sha256: string;
}

export type FramescaperDesktopV10Body = FramescaperDesktopV10ProxyBody | FramescaperDesktopV10TimingBody;

export interface FramescaperDesktopV10ProjectRow {
	readonly id: string;
	readonly projectId: string;
	readonly name: string;
	readonly metadataFile: string;
	readonly preferredProduct: 'framescaper';
	readonly updatedAtMs: number;
	readonly projectSchemaVersion: 18;
	readonly projectRevision: number;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperDesktopV10Bundle {
	readonly metadataRevision: number;
	readonly project: Readonly<FramescaperDesktopV10ProjectRow>;
	readonly document: string;
	readonly bodies: readonly Readonly<FramescaperDesktopV10Body>[];
}

export interface FramescaperDesktopV10BundleSnapshot {
	readonly bundle: Readonly<FramescaperDesktopV10Bundle>;
	readonly project: FramescaperProjectV18;
	readonly assets: readonly Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>[];
}

export interface FramescaperDesktopV10ProjectSummary {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
}

export interface FramescaperDesktopV10CatalogSnapshot {
	readonly metadataRevision: number;
	readonly projects: readonly Readonly<FramescaperDesktopV10ProjectSummary>[];
}

export interface FramescaperDesktopV10RendererBridge {
	connect(): Promise<unknown>;
	handshakeState(): unknown;
	listProjects(): Promise<unknown>;
	readProjectBundle(projectId: string): Promise<unknown>;
	readBodyChunk(request: unknown): Promise<unknown>;
	beginPublication(request: unknown): Promise<unknown>;
	writePublicationChunk(request: unknown): Promise<unknown>;
	finishPublication(request: unknown): Promise<unknown>;
	abortPublication(request: unknown): Promise<unknown>;
	deleteProject(request: unknown): Promise<unknown>;
	duplicateProject(request: unknown): Promise<unknown>;
}

const GLOBAL_NAME = 'framescaperProjectLibraryDesktop';
const API_FIELDS = [
	'connect', 'handshakeState', 'listProjects', 'readProjectBundle', 'readBodyChunk',
	'beginPublication', 'writePublicationChunk', 'finishPublication', 'abortPublication',
	'deleteProject', 'duplicateProject',
] as const;
const HANDSHAKE_FIELDS = [
	'kind', 'version', 'owner', 'projectSchemaVersion', 'scapeFormatVersions',
	'attachedScapeFormatVersion', 'storageDatabaseName', 'desktopLibrarySchemaVersion',
	'desktopDatabaseUserVersion', 'desktopLibraryScope',
] as const;
const BUNDLE_FIELDS = ['metadataRevision', 'project', 'document', 'bodies'] as const;
const CATALOG_FIELDS = ['metadataRevision', 'projects'] as const;
const SUMMARY_FIELDS = ['id', 'title', 'revision', 'updatedAt'] as const;
const DELETE_RESULT_FIELDS = ['projectId', 'metadataRevision', 'deleted'] as const;
const PROJECT_FIELDS = [
	'id', 'projectId', 'name', 'metadataFile', 'preferredProduct', 'updatedAtMs',
	'projectSchemaVersion', 'projectRevision', 'byteLength', 'sha256',
] as const;
const PROXY_FIELDS = [
	'kind', 'encoding', 'bindingId', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;
const TIMING_FIELDS = [
	'kind', 'encoding', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const BINDING_ID = /^p[a-f0-9]{64}$/u;
const ENTRY_ID = /^[A-Za-z0-9_-]{8,128}$/u;
const PUBLICATION_ID = /^[a-f0-9]{48}$/u;
const MAXIMUM_PROJECT_BYTES = 256 * 1024 * 1024;
const MAXIMUM_BODIES = 4_094;
const MAXIMUM_PROJECTS = 10_000;
const MAXIMUM_TITLE_BYTES = 1_024;

export function resolveFramescaperDesktopV10RendererBridge(): FramescaperDesktopV10RendererBridge | null {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_NAME);
	if (!descriptor) return null;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('The Framescaper desktop V10 global must be an own data property.');
	}
	const container = exactRecord(descriptor.value, ['v10'], 'Framescaper desktop project library');
	if (!Object.isFrozen(descriptor.value)) {
		throw new TypeError('The Framescaper desktop project library must be frozen.');
	}
	const apiValue = container.v10;
	const api = exactRecord(apiValue, API_FIELDS, 'Framescaper desktop V10 bridge');
	if (!Object.isFrozen(apiValue)) throw new TypeError('The Framescaper desktop V10 bridge must be frozen.');
	for (const field of API_FIELDS) {
		if (typeof api[field] !== 'function') throw new TypeError(`The Framescaper desktop V10 bridge requires ${field}.`);
	}
	return Object.freeze({
		connect: () => (api.connect as () => Promise<unknown>).call(apiValue),
		handshakeState: () => (api.handshakeState as () => unknown).call(apiValue),
		listProjects: () => (api.listProjects as () => Promise<unknown>).call(apiValue),
		readProjectBundle: (projectId: string) => (
			(api.readProjectBundle as (value: string) => Promise<unknown>).call(apiValue, projectId)
		),
		readBodyChunk: (request: unknown) => (
			(api.readBodyChunk as (value: unknown) => Promise<unknown>).call(apiValue, request)
		),
		beginPublication: (request: unknown) => (
			(api.beginPublication as (value: unknown) => Promise<unknown>).call(apiValue, request)
		),
		writePublicationChunk: (request: unknown) => (
			(api.writePublicationChunk as (value: unknown) => Promise<unknown>).call(apiValue, request)
		),
		finishPublication: (request: unknown) => (
			(api.finishPublication as (value: unknown) => Promise<unknown>).call(apiValue, request)
		),
		abortPublication: (request: unknown) => (
			(api.abortPublication as (value: unknown) => Promise<unknown>).call(apiValue, request)
		),
		deleteProject: (request: unknown) => (
			(api.deleteProject as (value: unknown) => Promise<unknown>).call(apiValue, request)
		),
		duplicateProject: (request: unknown) => (
			(api.duplicateProject as (value: unknown) => Promise<unknown>).call(apiValue, request)
		),
	});
}

export function validateFramescaperDesktopV10RendererHandshake(value: unknown, databaseName: string): void {
	const handshake = exactRecord(value, HANDSHAKE_FIELDS, 'Framescaper desktop V10 handshake');
	if (handshake.kind !== 'framescaper-project-library-handshake' || handshake.version !== 1
		|| handshake.owner !== 'framescaper' || handshake.projectSchemaVersion !== 18
		|| handshake.attachedScapeFormatVersion !== 2 || handshake.storageDatabaseName !== databaseName
		|| handshake.desktopLibrarySchemaVersion !== 10 || handshake.desktopDatabaseUserVersion !== 12) {
		throw new TypeError('The Framescaper desktop V10 handshake identity is unsupported.');
	}
	exactTuple(handshake.scapeFormatVersions, [1, 2], 'Scape format versions');
	exactTuple(handshake.desktopLibraryScope, ['kw.media', 'scape-project-library', 'v10'], 'library scope');
}

export function validateFramescaperDesktopV10CatalogSnapshot(
	value: unknown,
): Readonly<FramescaperDesktopV10CatalogSnapshot> {
	const raw = exactRecord(value, CATALOG_FIELDS, 'Framescaper desktop V10 catalog');
	const projects = denseArray(raw.projects, 'Framescaper desktop V10 project summaries', MAXIMUM_PROJECTS)
		.map(projectSummary);
	if (new Set(projects.map(({ id }) => id)).size !== projects.length) {
		throw new TypeError('The Framescaper desktop V10 catalog contains duplicate project identities.');
	}
	return Object.freeze({
		metadataRevision: nonNegative(raw.metadataRevision, 'metadata revision'),
		projects: Object.freeze(projects),
	});
}

export function validateFramescaperDesktopV10DeleteResult(
	value: unknown,
	expectedProjectId: string,
): Readonly<{ readonly projectId: string; readonly metadataRevision: number; readonly deleted: true }> {
	const raw = exactRecord(value, DELETE_RESULT_FIELDS, 'Framescaper desktop V10 delete result');
	const projectId = validateFramescaperDesktopV10ProjectId(raw.projectId);
	if (projectId !== validateFramescaperDesktopV10ProjectId(expectedProjectId) || raw.deleted !== true) {
		throw new Error('The Framescaper desktop V10 delete acknowledgement changed its project identity.');
	}
	return Object.freeze({
		projectId,
		metadataRevision: nonNegative(raw.metadataRevision, 'metadata revision'),
		deleted: true,
	});
}

export function validateFramescaperDesktopV10Bundle(
	profile: EditorProjectRuntimeProfile,
	value: unknown,
	expectedProjectId: string,
): Readonly<FramescaperDesktopV10BundleSnapshot> {
	const bundle = exactRecord(value, BUNDLE_FIELDS, 'Framescaper desktop V10 bundle');
	const row = projectRow(bundle.project, expectedProjectId);
	if (typeof bundle.document !== 'string' || bundle.document.length === 0
		|| bundle.document.length > MAXIMUM_PROJECT_BYTES) {
		throw new TypeError('The Framescaper desktop V10 project document is invalid.');
	}
	const documentBytes = new TextEncoder().encode(bundle.document);
	if (documentBytes.byteLength !== row.byteLength || digestBytes(documentBytes) !== row.sha256) {
		throw new Error('The Framescaper desktop V10 project document changed bytes or digest.');
	}
	const parsed = parseScapeProjectDocument(bundle.document);
	const project = cloneFramescaperProjectV18(profile, parsed);
	if (String(project.id) !== row.projectId || String(project.title) !== row.name
		|| Number(project.revision) !== row.projectRevision || project.schemaVersion !== 18) {
		throw new Error('The Framescaper desktop V10 project disagrees with its metadata.');
	}
	const assets = planScapeVideoProxyArchiveAssetsV2(
		framescaperScapeAttachmentInventoryV18(project).references,
	).assets;
	const expectedBodies = bodiesForAssets(row, assets);
	const bodies = denseArray(bundle.bodies, 'Framescaper desktop V10 bodies', MAXIMUM_BODIES)
		.map(bodyDescriptor);
	if (JSON.stringify(bodies) !== JSON.stringify(expectedBodies)) {
		throw new Error('The Framescaper desktop V10 proxy/timing body pair is incomplete or changed.');
	}
	return Object.freeze({
		bundle: Object.freeze({
			metadataRevision: nonNegative(bundle.metadataRevision, 'metadata revision'),
			project: row,
			document: bundle.document,
			bodies: Object.freeze(bodies),
		}),
		project,
		assets,
	});
}

export function snapshotFramescaperDesktopV10Project(
	profile: EditorProjectRuntimeProfile,
	projectValue: unknown,
): Readonly<{ project: FramescaperProjectV18; document: string; byteLength: number; sha256: string }> {
	const project = cloneFramescaperProjectV18(profile, projectValue);
	const document = JSON.stringify(project);
	const bytes = new TextEncoder().encode(document);
	if (bytes.byteLength > MAXIMUM_PROJECT_BYTES) throw new RangeError('The V18 project exceeds the desktop limit.');
	return Object.freeze({ project, document, byteLength: bytes.byteLength, sha256: digestBytes(bytes) });
}

export function framescaperDesktopV10BodiesForProject(
	project: FramescaperProjectV18,
	projectSha256: string,
): Readonly<{
	readonly assets: readonly Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>[];
	readonly bodies: readonly Readonly<FramescaperDesktopV10Body>[];
}> {
	const assets = planScapeVideoProxyArchiveAssetsV2(
		framescaperScapeAttachmentInventoryV18(project).references,
	).assets;
	return Object.freeze({
		assets,
		bodies: bodiesForAssets({
			projectId: String(project.id), projectRevision: Number(project.revision), sha256: digest(projectSha256, 'project'),
		} as FramescaperDesktopV10ProjectRow, assets),
	});
}

export function validateFramescaperDesktopV10BodyChunk(value: unknown, length: number): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength !== length) {
		throw new Error('The Framescaper desktop V10 body chunk changed its exact length.');
	}
	return value.slice();
}

export function validateFramescaperDesktopV10Admission(value: unknown, bodyCount: number) {
	const result = exactRecord(
		value, ['publicationId', 'maximumChunkBytes', 'bodyCount'], 'Framescaper desktop V10 admission',
	);
	if (typeof result.publicationId !== 'string' || !PUBLICATION_ID.test(result.publicationId)
		|| result.maximumChunkBytes !== FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES
		|| result.bodyCount !== bodyCount) throw new Error('The Framescaper desktop V10 admission changed.');
	return Object.freeze({ publicationId: result.publicationId, maximumChunkBytes: result.maximumChunkBytes });
}

export function validateFramescaperDesktopV10Acknowledgement(
	value: unknown,
	bodyIndex: number,
	nextOffset: number,
	complete: boolean,
): void {
	const result = exactRecord(value, ['bodyIndex', 'nextOffset', 'complete'], 'Framescaper desktop V10 acknowledgement');
	if (result.bodyIndex !== bodyIndex || result.nextOffset !== nextOffset || result.complete !== complete) {
		throw new Error('The Framescaper desktop V10 acknowledgement changed its sequential write.');
	}
}

export function validateFramescaperDesktopV10Abort(value: unknown): void {
	if (typeof value !== 'boolean') throw new TypeError('The Framescaper desktop V10 abort result is invalid.');
}

export function validateFramescaperDesktopV10ProjectId(value: unknown): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError('A bounded printable Framescaper desktop project id is required.');
	}
	return value;
}

function projectRow(value: unknown, expectedProjectId: string): Readonly<FramescaperDesktopV10ProjectRow> {
	const row = exactRecord(value, PROJECT_FIELDS, 'Framescaper desktop V10 project row');
	const id = typeof row.id === 'string' && ENTRY_ID.test(row.id) ? row.id : invalid('project entry id');
	const projectId = validateFramescaperDesktopV10ProjectId(row.projectId);
	if (projectId !== validateFramescaperDesktopV10ProjectId(expectedProjectId)
		|| row.preferredProduct !== 'framescaper' || row.projectSchemaVersion !== 18) {
		throw new Error('The Framescaper desktop V10 project row has another owner or identity.');
	}
	const projectRevision = nonNegative(row.projectRevision, 'project revision');
	const sha256Value = digest(row.sha256, 'project');
	const byteLength = positive(row.byteLength, 'project byte length');
	if (byteLength > MAXIMUM_PROJECT_BYTES
		|| row.metadataFile !== `${id}/${String(projectRevision)}-${sha256Value}.json`) {
		throw new Error('The Framescaper desktop V10 project row has invalid document geometry.');
	}
	if (typeof row.name !== 'string' || !row.name.trim()) throw new TypeError('The project name is invalid.');
	return Object.freeze({
		id, projectId, name: row.name, metadataFile: row.metadataFile,
		preferredProduct: 'framescaper', updatedAtMs: nonNegative(row.updatedAtMs, 'update time'),
		projectSchemaVersion: 18, projectRevision, byteLength, sha256: sha256Value,
	});
}

function projectSummary(value: unknown): Readonly<FramescaperDesktopV10ProjectSummary> {
	const raw = exactRecord(value, SUMMARY_FIELDS, 'Framescaper desktop V10 project summary');
	if (typeof raw.title !== 'string' || !raw.title.trim()
		|| new TextEncoder().encode(raw.title).byteLength > MAXIMUM_TITLE_BYTES) {
		throw new TypeError('The Framescaper desktop V10 project title is invalid.');
	}
	return Object.freeze({
		id: validateFramescaperDesktopV10ProjectId(raw.id),
		title: raw.title,
		revision: nonNegative(raw.revision, 'project revision'),
		updatedAt: canonicalTimestamp(raw.updatedAt),
	});
}

function bodiesForAssets(
	project: Pick<FramescaperDesktopV10ProjectRow, 'projectId' | 'projectRevision' | 'sha256'>,
	assets: readonly Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>[],
): readonly Readonly<FramescaperDesktopV10Body>[] {
	return Object.freeze(assets.map((asset): Readonly<FramescaperDesktopV10Body> => {
		const common = {
			sourceId: asset.sourceId, storageKey: asset.sourceId, mimeType: asset.mimeType,
			byteLength: asset.size, sha256: asset.sha256,
		};
		return asset.kind === 'video-proxy' ? Object.freeze({
			kind: 'video-proxy', encoding: 'video-proxy-v1',
			bindingId: proxyBindingId(project.projectId, asset.sourceId, project.projectRevision, project.sha256),
			...common,
		}) : Object.freeze({
			kind: 'video-timing', encoding: VIDEO_TIMING_ASSET_ENCODING, ...common,
			mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		});
	}));
}

function bodyDescriptor(value: unknown): Readonly<FramescaperDesktopV10Body> {
	const kind = ownData(value, 'kind', 'Framescaper desktop V10 body');
	const raw = exactRecord(value, kind === 'video-proxy' ? PROXY_FIELDS : TIMING_FIELDS, 'Framescaper desktop V10 body');
	const common = {
		sourceId: identity(raw.sourceId, 'source id'), storageKey: identity(raw.storageKey, 'storage key'),
		mimeType: identity(raw.mimeType, 'MIME type'), byteLength: positive(raw.byteLength, 'body length'),
		sha256: digest(raw.sha256, 'body'),
	};
	if (common.sourceId !== common.storageKey) throw new Error('Desktop body source and storage identities differ.');
	if (kind === 'video-proxy') {
		if (raw.encoding !== 'video-proxy-v1' || typeof raw.bindingId !== 'string' || !BINDING_ID.test(raw.bindingId)) {
			throw new TypeError('The desktop proxy body identity is invalid.');
		}
		return Object.freeze({ kind, encoding: 'video-proxy-v1', bindingId: raw.bindingId, ...common });
	}
	if (kind !== 'video-timing' || raw.encoding !== VIDEO_TIMING_ASSET_ENCODING
		|| common.mimeType !== VIDEO_TIMING_ASSET_MIME_TYPE) throw new TypeError('The desktop timing body is invalid.');
	return Object.freeze({
		kind, encoding: VIDEO_TIMING_ASSET_ENCODING, ...common,
		mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
	}) as FramescaperDesktopV10TimingBody;
}

function proxyBindingId(projectId: string, storageKey: string, revision: number, projectSha256: string): string {
	const bytes = new TextEncoder().encode(JSON.stringify([
		'video-proxy-v1', projectId, revision, projectSha256, storageKey,
	]));
	return `p${digestBytes(bytes)}`;
}

function exactRecord<const Field extends string>(value: unknown, fields: readonly Field[], name: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${name} has missing or unsupported fields.`);
	}
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) result[field] = ownData(value, field, name);
	return result;
}

function ownData(value: unknown, field: string, name: string): unknown {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be a record.`);
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${field} must be data.`);
	return descriptor.value;
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`${name} must be a bounded dense array.`);
	return value.map((_, index) => ownData(value, String(index), name));
}

function exactTuple(value: unknown, expected: readonly unknown[], name: string): void {
	const tuple = denseArray(value, name, expected.length);
	if (tuple.length !== expected.length || tuple.some((item, index) => item !== expected[index])) {
		throw new TypeError(`The Framescaper desktop V10 ${name} is unsupported.`);
	}
}

function identity(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`The Framescaper desktop V10 ${name} is invalid.`);
	return value;
}

function canonicalTimestamp(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('The Framescaper desktop V10 timestamp is invalid.');
	const time = Date.parse(value);
	if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
		throw new TypeError('The Framescaper desktop V10 timestamp is invalid.');
	}
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) throw new TypeError(`The ${name} digest is invalid.`);
	return value;
}

function nonNegative(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`The ${name} is invalid.`);
	return Number(value);
}

function positive(value: unknown, name: string): number {
	const result = nonNegative(value, name);
	if (result === 0) throw new RangeError(`The ${name} must be positive.`);
	return result;
}

function digestBytes(value: Uint8Array): string { return bytesToHex(sha256(value)); }
function invalid(name: string): never { throw new TypeError(`The Framescaper desktop V10 ${name} is invalid.`); }
