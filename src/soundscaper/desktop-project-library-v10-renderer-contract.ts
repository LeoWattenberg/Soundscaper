/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { scapeAudioSourceLayout, type ScapeAudioSource } from '../common/editor/scape-archive-media.ts';
import { parseScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { normalizeAudioTrackFreezeV1 } from '../common/editor/audio-track-freeze-v21.ts';
import { assertSoundscaperProductionProfile } from './editor-project-production-profile.ts';
import { cloneSoundscaperProjectV21, type SoundscaperProjectV21 } from './editor-project-v21.ts';

export const SOUNDSCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
export const SOUNDSCAPER_DESKTOP_V10_FREEZE_ENCODING = 'audio-f32le-chunks-v1' as const;
export const SOUNDSCAPER_DESKTOP_V10_FREEZE_MIME_TYPE =
	'application/vnd.soundscaper.audio-f32le-chunks' as const;

export interface SoundscaperDesktopV10FreezeBody {
	readonly kind: 'audio-freeze';
	readonly encoding: typeof SOUNDSCAPER_DESKTOP_V10_FREEZE_ENCODING;
	readonly bindingId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: typeof SOUNDSCAPER_DESKTOP_V10_FREEZE_MIME_TYPE;
	readonly byteLength: number;
	readonly sha256: string;
}

export type SoundscaperDesktopV10Body = SoundscaperDesktopV10FreezeBody;

export interface SoundscaperDesktopV10ProjectRow {
	readonly id: string;
	readonly projectId: string;
	readonly name: string;
	readonly metadataFile: string;
	readonly preferredProduct: 'soundscaper';
	readonly updatedAtMs: number;
	readonly projectSchemaVersion: 21;
	readonly projectRevision: number;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface SoundscaperDesktopV10Bundle {
	readonly metadataRevision: number;
	readonly project: Readonly<SoundscaperDesktopV10ProjectRow>;
	readonly document: string;
	readonly bodies: readonly Readonly<SoundscaperDesktopV10Body>[];
}

export interface SoundscaperDesktopV10BundleSnapshot {
	readonly bundle: Readonly<SoundscaperDesktopV10Bundle>;
	readonly project: SoundscaperProjectV21;
}

export interface SoundscaperDesktopV10ProjectSummary {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
}

export interface SoundscaperDesktopV10CatalogSnapshot {
	readonly metadataRevision: number;
	readonly projects: readonly Readonly<SoundscaperDesktopV10ProjectSummary>[];
}

export interface SoundscaperDesktopV10RendererBridge {
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

const GLOBAL_NAME = 'soundscaperProjectLibraryDesktop';
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
const BODY_FIELDS = [
	'kind', 'encoding', 'bindingId', 'sourceId', 'storageKey', 'mimeType', 'byteLength', 'sha256',
] as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const BINDING_ID = /^f[a-f0-9]{64}$/u;
const ENTRY_ID = /^[A-Za-z0-9_-]{8,128}$/u;
const PUBLICATION_ID = /^[a-f0-9]{48}$/u;
const MAXIMUM_PROJECT_BYTES = 256 * 1024 * 1024;
const MAXIMUM_BODIES = 4_094;
const MAXIMUM_PROJECTS = 10_000;
const MAXIMUM_TITLE_BYTES = 1_024;

export function resolveSoundscaperDesktopV10RendererBridge(): SoundscaperDesktopV10RendererBridge | null {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_NAME);
	if (!descriptor) return null;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('The Soundscaper desktop V10 global must be an own data property.');
	}
	const container = exactRecord(descriptor.value, ['v10'], 'Soundscaper desktop project library');
	if (!Object.isFrozen(descriptor.value)) throw new TypeError('The Soundscaper desktop project library must be frozen.');
	const apiValue = container.v10;
	const api = exactRecord(apiValue, API_FIELDS, 'Soundscaper desktop V10 bridge');
	if (!Object.isFrozen(apiValue)) throw new TypeError('The Soundscaper desktop V10 bridge must be frozen.');
	for (const field of API_FIELDS) {
		if (typeof api[field] !== 'function') throw new TypeError(`The Soundscaper desktop V10 bridge requires ${field}.`);
	}
	return Object.freeze({
		connect: () => (api.connect as () => Promise<unknown>).call(apiValue),
		handshakeState: () => (api.handshakeState as () => unknown).call(apiValue),
		listProjects: () => (api.listProjects as () => Promise<unknown>).call(apiValue),
		readProjectBundle: (value: string) => (
			api.readProjectBundle as (id: string) => Promise<unknown>
		).call(apiValue, value),
		readBodyChunk: (value: unknown) => (
			api.readBodyChunk as (arg: unknown) => Promise<unknown>
		).call(apiValue, value),
		beginPublication: (value: unknown) => (
			api.beginPublication as (arg: unknown) => Promise<unknown>
		).call(apiValue, value),
		writePublicationChunk: (value: unknown) => (
			api.writePublicationChunk as (arg: unknown) => Promise<unknown>
		).call(apiValue, value),
		finishPublication: (value: unknown) => (
			api.finishPublication as (arg: unknown) => Promise<unknown>
		).call(apiValue, value),
		abortPublication: (value: unknown) => (
			api.abortPublication as (arg: unknown) => Promise<unknown>
		).call(apiValue, value),
		deleteProject: (value: unknown) => (
			api.deleteProject as (arg: unknown) => Promise<unknown>
		).call(apiValue, value),
		duplicateProject: (value: unknown) => (
			api.duplicateProject as (arg: unknown) => Promise<unknown>
		).call(apiValue, value),
	});
}

export function validateSoundscaperDesktopV10RendererHandshake(value: unknown, databaseName: string): void {
	const handshake = exactRecord(value, HANDSHAKE_FIELDS, 'Soundscaper desktop V10 handshake');
	if (handshake.kind !== 'soundscaper-project-library-handshake' || handshake.version !== 1
		|| handshake.owner !== 'soundscaper' || handshake.projectSchemaVersion !== 21
		|| handshake.attachedScapeFormatVersion !== 2 || handshake.storageDatabaseName !== databaseName
		|| handshake.desktopLibrarySchemaVersion !== 10 || handshake.desktopDatabaseUserVersion !== 12) {
		throw new TypeError('The Soundscaper desktop V10 handshake identity is unsupported.');
	}
	exactTuple(handshake.scapeFormatVersions, [1, 2], 'Scape format versions');
	exactTuple(handshake.desktopLibraryScope,
		['kw.media', 'soundscaper-project-library', 'v10'], 'library scope');
}

export function validateSoundscaperDesktopV10CatalogSnapshot(
	value: unknown,
): Readonly<SoundscaperDesktopV10CatalogSnapshot> {
	const raw = exactRecord(value, CATALOG_FIELDS, 'Soundscaper desktop V10 catalog');
	const projects = denseArray(raw.projects, 'Soundscaper desktop V10 project summaries', MAXIMUM_PROJECTS)
		.map(projectSummary);
	if (new Set(projects.map(({ id }) => id)).size !== projects.length) {
		throw new TypeError('The Soundscaper desktop V10 catalog contains duplicate project identities.');
	}
	return Object.freeze({ metadataRevision: nonNegative(raw.metadataRevision, 'metadata revision'), projects: Object.freeze(projects) });
}

export function validateSoundscaperDesktopV10DeleteResult(
	value: unknown,
	expectedProjectId: string,
): Readonly<{ readonly projectId: string; readonly metadataRevision: number; readonly deleted: true }> {
	const raw = exactRecord(value, DELETE_RESULT_FIELDS, 'Soundscaper desktop V10 delete result');
	const projectId = validateSoundscaperDesktopV10ProjectId(raw.projectId);
	if (projectId !== validateSoundscaperDesktopV10ProjectId(expectedProjectId) || raw.deleted !== true) {
		throw new Error('The Soundscaper desktop V10 delete acknowledgement changed its project identity.');
	}
	return Object.freeze({ projectId, metadataRevision: nonNegative(raw.metadataRevision, 'metadata revision'), deleted: true });
}

export function validateSoundscaperDesktopV10Bundle(
	profile: EditorProjectRuntimeProfile,
	value: unknown,
	expectedProjectId: string,
): Readonly<SoundscaperDesktopV10BundleSnapshot> {
	assertSoundscaperProductionProfile(profile);
	const bundle = exactRecord(value, BUNDLE_FIELDS, 'Soundscaper desktop V10 bundle');
	const row = projectRow(bundle.project, expectedProjectId);
	if (typeof bundle.document !== 'string' || bundle.document.length === 0
		|| bundle.document.length > MAXIMUM_PROJECT_BYTES) {
		throw new TypeError('The Soundscaper desktop V10 project document is invalid.');
	}
	const documentBytes = new TextEncoder().encode(bundle.document);
	if (documentBytes.byteLength !== row.byteLength || digestBytes(documentBytes) !== row.sha256) {
		throw new Error('The Soundscaper desktop V10 project document changed bytes or digest.');
	}
	const project = cloneSoundscaperProjectV21(parseScapeProjectDocument(bundle.document));
	if (String(project.id) !== row.projectId || String(project.title) !== row.name
		|| Number(project.revision) !== row.projectRevision || project.schemaVersion !== 21) {
		throw new Error('The Soundscaper desktop V10 V21 project disagrees with its metadata.');
	}
	const expectedBodies = soundscaperDesktopV10BodiesForProject(project, row.sha256).bodies;
	const bodies = denseArray(bundle.bodies, 'Soundscaper desktop V10 freeze bodies', MAXIMUM_BODIES)
		.map(bodyDescriptor);
	if (JSON.stringify(bodies) !== JSON.stringify(expectedBodies)) {
		throw new Error('The Soundscaper desktop V10 freeze body set is incomplete or changed.');
	}
	return Object.freeze({
		bundle: Object.freeze({
			metadataRevision: nonNegative(bundle.metadataRevision, 'metadata revision'),
			project: row, document: bundle.document, bodies: Object.freeze(bodies),
		}),
		project,
	});
}

export function snapshotSoundscaperDesktopV10Project(
	profile: EditorProjectRuntimeProfile,
	projectValue: unknown,
): Readonly<{ project: SoundscaperProjectV21; document: string; byteLength: number; sha256: string }> {
	assertSoundscaperProductionProfile(profile);
	const project = cloneSoundscaperProjectV21(projectValue);
	const document = JSON.stringify(project);
	const bytes = new TextEncoder().encode(document);
	if (bytes.byteLength > MAXIMUM_PROJECT_BYTES) throw new RangeError('The V21 project exceeds the desktop limit.');
	return Object.freeze({ project, document, byteLength: bytes.byteLength, sha256: digestBytes(bytes) });
}

export function soundscaperDesktopV10BodiesForProject(
	projectValue: SoundscaperProjectV21,
	projectSha256: string,
): Readonly<{ readonly bodies: readonly Readonly<SoundscaperDesktopV10Body>[] }> {
	const project = cloneSoundscaperProjectV21(projectValue);
	const sources = project.sources as readonly Readonly<Record<string, unknown>>[];
	const bodies = project.tracks.flatMap((trackValue) => {
		const track = trackValue as Readonly<Record<string, unknown>>;
		if (!Object.hasOwn(track, 'audioFreeze')) return [];
		const freeze = normalizeAudioTrackFreezeV1(track.audioFreeze);
		const matches = sources.filter(({ id }) => id === freeze.derivedSourceId);
		if (matches.length !== 1) throw new Error('A V21 freeze source is missing or ambiguous.');
		const source = matches[0]!;
		return [Object.freeze({
			kind: 'audio-freeze' as const,
			encoding: SOUNDSCAPER_DESKTOP_V10_FREEZE_ENCODING,
			bindingId: freezeBindingId(
				String(project.id), String(source.id), String(source.storageKey),
				Number(project.revision), digest(projectSha256, 'project'),
			),
			sourceId: identity(source.id, 'source id'),
			storageKey: identity(source.storageKey, 'storage key'),
			mimeType: SOUNDSCAPER_DESKTOP_V10_FREEZE_MIME_TYPE,
			byteLength: scapeAudioSourceLayout(source as unknown as ScapeAudioSource).archiveBytes,
			sha256: digest(source.contentSha256, 'freeze source'),
		})];
	});
	return Object.freeze({ bodies: Object.freeze(bodies) });
}

export function validateSoundscaperDesktopV10BodyChunk(value: unknown, length: number): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength !== length) {
		throw new Error('The Soundscaper desktop V10 body chunk changed its exact length.');
	}
	return value.slice();
}

export function validateSoundscaperDesktopV10Admission(value: unknown, bodyCount: number) {
	const result = exactRecord(value, ['publicationId', 'maximumChunkBytes', 'bodyCount'], 'Soundscaper desktop V10 admission');
	if (typeof result.publicationId !== 'string' || !PUBLICATION_ID.test(result.publicationId)
		|| result.maximumChunkBytes !== SOUNDSCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES
		|| result.bodyCount !== bodyCount) throw new Error('The Soundscaper desktop V10 admission changed.');
	return Object.freeze({ publicationId: result.publicationId, maximumChunkBytes: result.maximumChunkBytes });
}

export function validateSoundscaperDesktopV10Acknowledgement(
	value: unknown, bodyIndex: number, nextOffset: number, complete: boolean,
): void {
	const result = exactRecord(value, ['bodyIndex', 'nextOffset', 'complete'], 'Soundscaper desktop V10 acknowledgement');
	if (result.bodyIndex !== bodyIndex || result.nextOffset !== nextOffset || result.complete !== complete) {
		throw new Error('The Soundscaper desktop V10 acknowledgement changed its sequential write.');
	}
}

export function validateSoundscaperDesktopV10Abort(value: unknown): void {
	if (typeof value !== 'boolean') throw new TypeError('The Soundscaper desktop V10 abort result is invalid.');
}

export function validateSoundscaperDesktopV10ProjectId(value: unknown): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError('A bounded printable Soundscaper desktop project id is required.');
	}
	return value;
}

function projectRow(value: unknown, expectedProjectId: string): Readonly<SoundscaperDesktopV10ProjectRow> {
	const row = exactRecord(value, PROJECT_FIELDS, 'Soundscaper desktop V10 project row');
	const id = typeof row.id === 'string' && ENTRY_ID.test(row.id) ? row.id : invalid('project entry id');
	const projectId = validateSoundscaperDesktopV10ProjectId(row.projectId);
	if (projectId !== validateSoundscaperDesktopV10ProjectId(expectedProjectId)
		|| row.preferredProduct !== 'soundscaper' || row.projectSchemaVersion !== 21) {
		throw new Error('The Soundscaper desktop V10 project row has another owner or identity.');
	}
	const projectRevision = nonNegative(row.projectRevision, 'project revision');
	const sha256Value = digest(row.sha256, 'project');
	const byteLength = positive(row.byteLength, 'project byte length');
	if (byteLength > MAXIMUM_PROJECT_BYTES
		|| row.metadataFile !== `${id}/${String(projectRevision)}-${sha256Value}.json`) {
		throw new Error('The Soundscaper desktop V10 project row has invalid document geometry.');
	}
	if (typeof row.name !== 'string' || !row.name.trim()) throw new TypeError('The project name is invalid.');
	return Object.freeze({
		id, projectId, name: row.name, metadataFile: row.metadataFile,
		preferredProduct: 'soundscaper', updatedAtMs: nonNegative(row.updatedAtMs, 'update time'),
		projectSchemaVersion: 21, projectRevision, byteLength, sha256: sha256Value,
	});
}

function projectSummary(value: unknown): Readonly<SoundscaperDesktopV10ProjectSummary> {
	const raw = exactRecord(value, SUMMARY_FIELDS, 'Soundscaper desktop V10 project summary');
	if (typeof raw.title !== 'string' || !raw.title.trim()
		|| new TextEncoder().encode(raw.title).byteLength > MAXIMUM_TITLE_BYTES) {
		throw new TypeError('The Soundscaper desktop V10 project title is invalid.');
	}
	return Object.freeze({
		id: validateSoundscaperDesktopV10ProjectId(raw.id), title: raw.title,
		revision: nonNegative(raw.revision, 'project revision'), updatedAt: canonicalTimestamp(raw.updatedAt),
	});
}

function bodyDescriptor(value: unknown): Readonly<SoundscaperDesktopV10Body> {
	const raw = exactRecord(value, BODY_FIELDS, 'Soundscaper desktop V10 freeze body');
	if (raw.kind !== 'audio-freeze' || raw.encoding !== SOUNDSCAPER_DESKTOP_V10_FREEZE_ENCODING
		|| raw.mimeType !== SOUNDSCAPER_DESKTOP_V10_FREEZE_MIME_TYPE
		|| typeof raw.bindingId !== 'string' || !BINDING_ID.test(raw.bindingId)) {
		throw new TypeError('The Soundscaper desktop freeze body identity is invalid.');
	}
	return Object.freeze({
		kind: 'audio-freeze', encoding: SOUNDSCAPER_DESKTOP_V10_FREEZE_ENCODING,
		bindingId: raw.bindingId, sourceId: identity(raw.sourceId, 'source id'),
		storageKey: identity(raw.storageKey, 'storage key'),
		mimeType: SOUNDSCAPER_DESKTOP_V10_FREEZE_MIME_TYPE,
		byteLength: positive(raw.byteLength, 'body length'), sha256: digest(raw.sha256, 'body'),
	});
}

function freezeBindingId(projectId: string, sourceId: string, storageKey: string, revision: number, projectSha256: string): string {
	return `f${digestBytes(new TextEncoder().encode(JSON.stringify([
		SOUNDSCAPER_DESKTOP_V10_FREEZE_ENCODING, projectId, revision, projectSha256,
		JSON.stringify([sourceId, storageKey]),
	])))}`;
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

function ownData(value: object, field: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${field} must be an own data property.`);
	}
	return descriptor.value;
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`${name} must be a bounded dense array.`);
	return value.map((_, index) => ownData(value, String(index), name));
}

function exactTuple(value: unknown, expected: readonly unknown[], name: string): void {
	const actual = denseArray(value, name, expected.length);
	if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
		throw new TypeError(`${name} changed.`);
	}
}

function canonicalTimestamp(value: unknown): string {
	if (typeof value !== 'string' || new Date(value).toISOString() !== value) throw new TypeError('Timestamp is invalid.');
	return value;
}

function identity(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).byteLength > 4 * 1024) {
		throw new TypeError(`The Soundscaper desktop V10 ${label} is invalid.`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) throw new TypeError(`The ${label} digest is invalid.`);
	return value;
}

function digestBytes(value: Uint8Array): string { return bytesToHex(sha256(value)); }
function nonNegative(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} is invalid.`);
	return value;
}
function positive(value: unknown, label: string): number {
	const result = nonNegative(value, label);
	if (result === 0) throw new RangeError(`${label} is invalid.`);
	return result;
}
function invalid(label: string): never { throw new TypeError(`The ${label} is invalid.`); }
