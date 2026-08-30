/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import {
	editorProjectRuntimeProfilePrerequisiteDefinition,
} from '../common/editor/project-runtime-profile-prerequisite.ts';
import {
	editorProjectStorageProfileNames,
} from '../common/editor/storage/project-storage-profile.ts';
import { scapeAudioSourceLayout, type ScapeAudioSource } from '../common/editor/scape-archive-media.ts';
import { parseScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { normalizeAudioTrackFreezeV1 } from '../common/editor/audio-track-freeze-v21.ts';
import {
	PROJECT_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
} from '../common/editor/project-schema-identity.ts';
import {
	assertSoundscaperProjectProfile,
	soundscaperProjectClone,
} from './editor-project-profile.ts';
import type {
	SoundscaperProject,
} from './editor-project-validation.ts';

export const SOUNDSCAPER_DESKTOP_MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
export const SOUNDSCAPER_DESKTOP_FREEZE_ENCODING = 'audio-f32le-chunks-v1' as const;
export const SOUNDSCAPER_DESKTOP_FREEZE_MIME_TYPE =
	'application/vnd.soundscaper.audio-f32le-chunks' as const;

export interface SoundscaperDesktopFreezeBody {
	readonly kind: 'audio-freeze';
	readonly encoding: typeof SOUNDSCAPER_DESKTOP_FREEZE_ENCODING;
	readonly bindingId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: typeof SOUNDSCAPER_DESKTOP_FREEZE_MIME_TYPE;
	readonly byteLength: number;
	readonly sha256: string;
}

export type SoundscaperDesktopBody = SoundscaperDesktopFreezeBody;

export interface SoundscaperDesktopProjectRow {
	readonly id: string;
	readonly projectId: string;
	readonly name: string;
	readonly metadataFile: string;
	readonly preferredProduct: 'soundscaper';
	readonly schemaFamily: typeof SOUNDSCAPER_PROJECT_SCHEMA_FAMILY;
	readonly updatedAtMs: number;
	readonly schemaVersion: number;
	readonly projectRevision: number;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface SoundscaperDesktopBundle {
	readonly metadataRevision: number;
	readonly project: Readonly<SoundscaperDesktopProjectRow>;
	readonly document: string;
	readonly bodies: readonly Readonly<SoundscaperDesktopBody>[];
}

export interface SoundscaperDesktopBundleSnapshot {
	readonly bundle: Readonly<SoundscaperDesktopBundle>;
	readonly project: SoundscaperProject;
}

export interface SoundscaperDesktopProjectSummary {
	readonly schemaFamily: typeof SOUNDSCAPER_PROJECT_SCHEMA_FAMILY;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
}

export interface SoundscaperDesktopCatalogSnapshot {
	readonly metadataRevision: number;
	readonly projects: readonly Readonly<SoundscaperDesktopProjectSummary>[];
}

export interface SoundscaperDesktopRendererBridge {
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
	persistNativePluginState(bytes: Uint8Array): Promise<unknown>;
	readNativePluginState(bodyId: string): Promise<unknown>;
}

const GLOBAL_NAME = 'soundscaperProjectLibraryDesktop';
const API_FIELDS = [
	'connect', 'handshakeState', 'listProjects', 'readProjectBundle', 'readBodyChunk',
	'beginPublication', 'writePublicationChunk', 'finishPublication', 'abortPublication',
	'deleteProject', 'duplicateProject', 'persistNativePluginState', 'readNativePluginState',
] as const;
const HANDSHAKE_FIELDS = [
	'kind', 'version', 'owner', 'schemaFamily', 'schemaVersion', 'scapeFormatVersions',
	'attachedScapeFormatVersion', 'storageDatabaseName', 'desktopLibrarySchemaVersion',
	'desktopDatabaseUserVersion', 'desktopLibraryScope',
] as const;
const BUNDLE_FIELDS = ['metadataRevision', 'project', 'document', 'bodies'] as const;
const CATALOG_FIELDS = ['metadataRevision', 'projects'] as const;
const SUMMARY_FIELDS = ['schemaFamily', 'schemaVersion', 'id', 'title', 'revision', 'updatedAt'] as const;
const DELETE_RESULT_FIELDS = ['projectId', 'metadataRevision', 'deleted'] as const;
const PROJECT_FIELDS = [
	'id', 'projectId', 'name', 'metadataFile', 'preferredProduct', 'updatedAtMs',
	'schemaFamily', 'schemaVersion', 'projectRevision', 'byteLength', 'sha256',
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

export function resolveSoundscaperDesktopRendererBridge(): SoundscaperDesktopRendererBridge | null {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_NAME);
	if (!descriptor) return null;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('The Soundscaper desktop  global must be an own data property.');
	}
	const container = exactRecord(descriptor.value, ['v1'], 'Soundscaper desktop project library');
	if (!Object.isFrozen(descriptor.value)) throw new TypeError('The Soundscaper desktop project library must be frozen.');
	const apiValue = container.v1;
	const api = exactRecord(apiValue, API_FIELDS, 'Soundscaper desktop  bridge');
	if (!Object.isFrozen(apiValue)) throw new TypeError('The Soundscaper desktop  bridge must be frozen.');
	for (const field of API_FIELDS) {
		if (typeof api[field] !== 'function') throw new TypeError(`The Soundscaper desktop  bridge requires ${field}.`);
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
		persistNativePluginState: (value: Uint8Array) => (
			api.persistNativePluginState as (bytes: Uint8Array) => Promise<unknown>
		).call(apiValue, value),
		readNativePluginState: (value: string) => (
			api.readNativePluginState as (bodyId: string) => Promise<unknown>
		).call(apiValue, value),
	});
}

/**
 * Admit main's library only if it names the revision this renderer actually runs.
 *
 * Every value compared here already exists on the connecting profile's
 * prerequisite, which is where a revision declares its own document number,
 * database name and desktop-library identity. Writing the numbers out again as
 * literals is how the V23 flip broke the packaged product: the renderer moved to
 * V23's database and schema while this comparison still demanded V21's, so the
 * handshake was refused, the editor never mounted, and the only visible symptom
 * was a packaged smoke that waited out its deadline.
 */
export function validateSoundscaperDesktopRendererHandshake(
	value: unknown,
	profile: EditorProjectRuntimeProfile | unknown,
): void {
	assertSoundscaperProjectProfile(profile);
	const prerequisite = editorProjectRuntimeProfilePrerequisiteDefinition(
		editorProjectRuntimeProfileDefinition(profile).prerequisite,
	);
	const storage = editorProjectStorageProfileNames(prerequisite.storageProfile);
	const handshake = exactRecord(value, HANDSHAKE_FIELDS, 'Soundscaper desktop  handshake');
	if (handshake.kind !== 'soundscaper-project-library-handshake' || handshake.version !== 1
		|| handshake.owner !== prerequisite.owner
		|| handshake.schemaFamily !== SOUNDSCAPER_PROJECT_SCHEMA_FAMILY
		|| handshake.schemaVersion !== prerequisite.desktopProjectSchemaVersion
		|| handshake.attachedScapeFormatVersion !== prerequisite.attachedScapeFormatVersion
		|| handshake.storageDatabaseName !== storage.databaseName
		|| handshake.desktopLibrarySchemaVersion !== prerequisite.desktopLibrarySchemaVersion
		|| handshake.desktopDatabaseUserVersion !== prerequisite.desktopDatabaseUserVersion) {
		throw new TypeError('The Soundscaper desktop  handshake identity is unsupported.');
	}
	exactTuple(handshake.scapeFormatVersions, prerequisite.scapeFormatVersions, 'Scape format versions');
	exactTuple(handshake.desktopLibraryScope, prerequisite.desktopLibraryScope, 'library scope');
}

export function validateSoundscaperDesktopCatalogSnapshot(
	value: unknown,
): Readonly<SoundscaperDesktopCatalogSnapshot> {
	const raw = exactRecord(value, CATALOG_FIELDS, 'Soundscaper desktop  catalog');
	const projects = denseArray(raw.projects, 'Soundscaper desktop  project summaries', MAXIMUM_PROJECTS)
		.map(projectSummary);
	if (new Set(projects.map(({ id }) => id)).size !== projects.length) {
		throw new TypeError('The Soundscaper desktop  catalog contains duplicate project identities.');
	}
	return Object.freeze({ metadataRevision: nonNegative(raw.metadataRevision, 'metadata revision'), projects: Object.freeze(projects) });
}

export function validateSoundscaperDesktopDeleteResult(
	value: unknown,
	expectedProjectId: string,
): Readonly<{ readonly projectId: string; readonly metadataRevision: number; readonly deleted: true }> {
	const raw = exactRecord(value, DELETE_RESULT_FIELDS, 'Soundscaper desktop  delete result');
	const projectId = validateSoundscaperDesktopProjectId(raw.projectId);
	if (projectId !== validateSoundscaperDesktopProjectId(expectedProjectId) || raw.deleted !== true) {
		throw new Error('The Soundscaper desktop  delete acknowledgement changed its project identity.');
	}
	return Object.freeze({ projectId, metadataRevision: nonNegative(raw.metadataRevision, 'metadata revision'), deleted: true });
}

export function validateSoundscaperDesktopBundle(
	profile: EditorProjectRuntimeProfile,
	value: unknown,
	expectedProjectId: string,
): Readonly<SoundscaperDesktopBundleSnapshot> {
	assertSoundscaperProjectProfile(profile);
	const bundle = exactRecord(value, BUNDLE_FIELDS, 'Soundscaper desktop  bundle');
	const row = projectRow(bundle.project, expectedProjectId, desktopProjectSchemaVersion(profile));
	if (typeof bundle.document !== 'string' || bundle.document.length === 0
		|| bundle.document.length > MAXIMUM_PROJECT_BYTES) {
		throw new TypeError('The Soundscaper desktop  project document is invalid.');
	}
	const documentBytes = new TextEncoder().encode(bundle.document);
	if (documentBytes.byteLength !== row.byteLength || digestBytes(documentBytes) !== row.sha256) {
		throw new Error('The Soundscaper desktop  project document changed bytes or digest.');
	}
	const project = soundscaperProjectClone(profile, parseScapeProjectDocument(bundle.document));
	if (String(project.id) !== row.projectId || String(project.title) !== row.name
		|| Number(project.revision) !== row.projectRevision
		|| project.schemaFamily !== row.schemaFamily
		|| project.schemaVersion !== row.schemaVersion) {
		throw new Error('The Soundscaper desktop  project disagrees with its metadata.');
	}
	const expectedBodies = soundscaperDesktopBodiesForProject(profile, project, row.sha256).bodies;
	const legacyBodies = bodiesForProject(profile, project, row.sha256, true);
	const bodies = denseArray(bundle.bodies, 'Soundscaper desktop  freeze bodies', MAXIMUM_BODIES)
		.map(bodyDescriptor);
	if (bodies.length !== expectedBodies.length || bodies.some((body, index) => (
		JSON.stringify(body) !== JSON.stringify(expectedBodies[index])
			&& JSON.stringify(body) !== JSON.stringify(legacyBodies[index])
	))) {
		throw new Error('The Soundscaper desktop  freeze body set is incomplete or changed.');
	}
	return Object.freeze({
		bundle: Object.freeze({
			metadataRevision: nonNegative(bundle.metadataRevision, 'metadata revision'),
			project: row, document: bundle.document, bodies: Object.freeze(bodies),
		}),
		project,
	});
}

export function snapshotSoundscaperDesktopProject(
	profile: EditorProjectRuntimeProfile,
	projectValue: unknown,
): Readonly<{
	project: SoundscaperProject; document: string; byteLength: number; sha256: string;
}> {
	const project = soundscaperProjectClone(profile, projectValue);
	const document = JSON.stringify(project);
	const bytes = new TextEncoder().encode(document);
	if (bytes.byteLength > MAXIMUM_PROJECT_BYTES) throw new RangeError('The project exceeds the desktop limit.');
	return Object.freeze({ project, document, byteLength: bytes.byteLength, sha256: digestBytes(bytes) });
}

export function soundscaperDesktopBodiesForProject(
	profile: EditorProjectRuntimeProfile,
	projectValue: SoundscaperProject,
	projectSha256: string,
): Readonly<{ readonly bodies: readonly Readonly<SoundscaperDesktopBody>[] }> {
	return Object.freeze({ bodies: bodiesForProject(profile, projectValue, projectSha256, false) });
}

function bodiesForProject(
	profile: EditorProjectRuntimeProfile,
	projectValue: SoundscaperProject,
	projectSha256: string,
	legacy: boolean,
): readonly Readonly<SoundscaperDesktopBody>[] {
	const project = soundscaperProjectClone(profile, projectValue);
	const projectDigest = digest(projectSha256, 'project');
	const sources = project.sources as readonly Readonly<Record<string, unknown>>[];
	const bodies = project.tracks.flatMap((trackValue) => {
		const track = trackValue as Readonly<Record<string, unknown>>;
		if (!Object.hasOwn(track, 'audioFreeze')) return [];
		const freeze = normalizeAudioTrackFreezeV1(track.audioFreeze);
		const matches = sources.filter(({ id }) => id === freeze.derivedSourceId);
		if (matches.length !== 1) throw new Error('A freeze source is missing or ambiguous.');
		const source = matches[0]!;
		const sourceId = identity(source.id, 'source id');
		const storageKey = identity(source.storageKey, 'storage key');
		const byteLength = scapeAudioSourceLayout(source as unknown as ScapeAudioSource).archiveBytes;
		const sha256 = digest(source.contentSha256, 'freeze source');
		return [Object.freeze({
			kind: 'audio-freeze' as const,
			encoding: SOUNDSCAPER_DESKTOP_FREEZE_ENCODING,
			bindingId: legacy
				? legacyFreezeBindingId(
					String(project.id), sourceId, storageKey,
					Number(project.revision), projectDigest,
				)
				: freezeBindingId(sourceId, storageKey, byteLength, sha256),
			sourceId,
			storageKey,
			mimeType: SOUNDSCAPER_DESKTOP_FREEZE_MIME_TYPE,
			byteLength,
			sha256,
		})];
	});
	return Object.freeze(bodies);
}

export function validateSoundscaperDesktopBodyChunk(value: unknown, length: number): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength !== length) {
		throw new Error('The Soundscaper desktop  body chunk changed its exact length.');
	}
	return value.slice();
}

export function validateSoundscaperDesktopAdmission(value: unknown, bodyCount: number) {
	const result = exactRecord(value, ['publicationId', 'maximumChunkBytes', 'bodyCount'], 'Soundscaper desktop  admission');
	if (typeof result.publicationId !== 'string' || !PUBLICATION_ID.test(result.publicationId)
		|| result.maximumChunkBytes !== SOUNDSCAPER_DESKTOP_MAXIMUM_CHUNK_BYTES
		|| result.bodyCount !== bodyCount) throw new Error('The Soundscaper desktop  admission changed.');
	return Object.freeze({ publicationId: result.publicationId, maximumChunkBytes: result.maximumChunkBytes });
}

export function validateSoundscaperDesktopAcknowledgement(
	value: unknown, bodyIndex: number, nextOffset: number, complete: boolean,
): void {
	const result = exactRecord(value, ['bodyIndex', 'nextOffset', 'complete'], 'Soundscaper desktop  acknowledgement');
	if (result.bodyIndex !== bodyIndex || result.nextOffset !== nextOffset || result.complete !== complete) {
		throw new Error('The Soundscaper desktop  acknowledgement changed its sequential write.');
	}
}

export function validateSoundscaperDesktopAbort(value: unknown): void {
	if (typeof value !== 'boolean') throw new TypeError('The Soundscaper desktop  abort result is invalid.');
}

export function validateSoundscaperDesktopProjectId(value: unknown): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError('A bounded printable Soundscaper desktop project id is required.');
	}
	return value;
}

/** The document number the connecting revision's prerequisite declares. */
function desktopProjectSchemaVersion(profile: EditorProjectRuntimeProfile): number {
	return editorProjectRuntimeProfilePrerequisiteDefinition(
		editorProjectRuntimeProfileDefinition(profile).prerequisite,
	).desktopProjectSchemaVersion;
}

function projectRow(
	value: unknown,
	expectedProjectId: string,
	schemaVersion: number,
): Readonly<SoundscaperDesktopProjectRow> {
	const row = exactRecord(value, PROJECT_FIELDS, 'Soundscaper desktop  project row');
	const id = typeof row.id === 'string' && ENTRY_ID.test(row.id) ? row.id : invalid('project entry id');
	const projectId = validateSoundscaperDesktopProjectId(row.projectId);
	if (projectId !== validateSoundscaperDesktopProjectId(expectedProjectId)
		|| row.preferredProduct !== 'soundscaper'
		|| row.schemaFamily !== SOUNDSCAPER_PROJECT_SCHEMA_FAMILY
		|| row.schemaVersion !== schemaVersion) {
		throw new Error('The Soundscaper desktop  project row has another owner or identity.');
	}
	const projectRevision = nonNegative(row.projectRevision, 'project revision');
	const sha256Value = digest(row.sha256, 'project');
	const byteLength = positive(row.byteLength, 'project byte length');
	if (byteLength > MAXIMUM_PROJECT_BYTES
		|| row.metadataFile !== `${id}/${String(projectRevision)}-${sha256Value}.json`) {
		throw new Error('The Soundscaper desktop  project row has invalid document geometry.');
	}
	if (typeof row.name !== 'string' || !row.name.trim()) throw new TypeError('The project name is invalid.');
	return Object.freeze({
		id, projectId, name: row.name, metadataFile: row.metadataFile,
		preferredProduct: 'soundscaper', updatedAtMs: nonNegative(row.updatedAtMs, 'update time'),
		schemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion, projectRevision, byteLength, sha256: sha256Value,
	});
}

function projectSummary(value: unknown): Readonly<SoundscaperDesktopProjectSummary> {
	const raw = exactRecord(value, SUMMARY_FIELDS, 'Soundscaper desktop  project summary');
	if (raw.schemaFamily !== SOUNDSCAPER_PROJECT_SCHEMA_FAMILY
		|| raw.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new TypeError('The Soundscaper desktop project summary identity is unsupported.');
	}
	if (typeof raw.title !== 'string' || !raw.title.trim()
		|| new TextEncoder().encode(raw.title).byteLength > MAXIMUM_TITLE_BYTES) {
		throw new TypeError('The Soundscaper desktop  project title is invalid.');
	}
	return Object.freeze({
		schemaFamily: SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		id: validateSoundscaperDesktopProjectId(raw.id), title: raw.title,
		revision: nonNegative(raw.revision, 'project revision'), updatedAt: canonicalTimestamp(raw.updatedAt),
	});
}

function bodyDescriptor(value: unknown): Readonly<SoundscaperDesktopBody> {
	const raw = exactRecord(value, BODY_FIELDS, 'Soundscaper desktop  freeze body');
	if (raw.kind !== 'audio-freeze' || raw.encoding !== SOUNDSCAPER_DESKTOP_FREEZE_ENCODING
		|| raw.mimeType !== SOUNDSCAPER_DESKTOP_FREEZE_MIME_TYPE
		|| typeof raw.bindingId !== 'string' || !BINDING_ID.test(raw.bindingId)) {
		throw new TypeError('The Soundscaper desktop freeze body identity is invalid.');
	}
	return Object.freeze({
		kind: 'audio-freeze', encoding: SOUNDSCAPER_DESKTOP_FREEZE_ENCODING,
		bindingId: raw.bindingId, sourceId: identity(raw.sourceId, 'source id'),
		storageKey: identity(raw.storageKey, 'storage key'),
		mimeType: SOUNDSCAPER_DESKTOP_FREEZE_MIME_TYPE,
		byteLength: positive(raw.byteLength, 'body length'), sha256: digest(raw.sha256, 'body'),
	});
}

function freezeBindingId(sourceId: string, storageKey: string, byteLength: number, contentSha256: string): string {
	return `f${digestBytes(new TextEncoder().encode(JSON.stringify([
		SOUNDSCAPER_DESKTOP_FREEZE_ENCODING, sourceId, storageKey, byteLength, contentSha256,
	])))}`;
}

function legacyFreezeBindingId(
	projectId: string,
	sourceId: string,
	storageKey: string,
	revision: number,
	projectSha256: string,
): string {
	return `f${digestBytes(new TextEncoder().encode(JSON.stringify([
		SOUNDSCAPER_DESKTOP_FREEZE_ENCODING, projectId, revision, projectSha256,
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
		throw new TypeError(`The Soundscaper desktop  ${label} is invalid.`);
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
