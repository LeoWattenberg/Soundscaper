/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPortV2, PhotoLibraryDevelopSnapshotV2, PhotoLibraryDevelopCommandV2 } from '../../common/editor/photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopPortV3, PhotoLibraryDevelopSnapshotV3, PhotoLibraryDevelopCommandV3 } from '../../common/editor/photo-library-develop-port-v3.ts';
import type { PhotoLibraryDevelopMaskRasterPortV1 } from '../../common/editor/photo-library-develop-mask-raster-port-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../common/editor/imaging/image-develop-state-current-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import type { PhotoCatalogRepositoryV2 } from '../catalog/photo-catalog-repository-v2.ts';
import type { PhotoCatalogRepositoryCurrentV1 } from '../catalog/photo-catalog-repository-current-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { field, id, integer, name, oneOf, record, utcTimestamp } from '../catalog/value-validation.ts';
import type { PhotoCommandOwnerV2 } from './photo-command-owner-v2.ts';
import type { PhotoCommandOwnerCurrentV1 } from './photo-command-owner-current-v1.ts';
import { normalizePhotoDevelopWorkspaceCommandV2, PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V2 } from './photo-develop-workspace-commands-v2.ts';
import { normalizePhotoDevelopWorkspaceCommandCurrentV1 } from './photo-develop-workspace-commands-current-v1.ts';
import { createPhotoLibraryDevelopSettingsSessionV2, type PhotoLibraryDevelopSettingsSessionHostV2 } from './photo-library-develop-settings-session-v2.ts';
import { createPhotoLibraryDevelopPresetsSessionV2, type PhotoLibraryDevelopPresetStorageV2 } from './photo-library-develop-presets-session-v2.ts';
import { createPhotoLibraryDevelopOriginalSessionV2, type PhotoLibraryDevelopOriginalSessionHostV2 } from './photo-library-develop-original-session-v2.ts';
import { createPhotoLibraryDevelopOriginalSessionCurrentV1, type PhotoLibraryDevelopOriginalSessionHostCurrentV1 } from './photo-library-develop-original-session-current-v1.ts';

export interface PhotoLibraryDevelopSessionHostV2 extends PhotoLibraryDevelopSettingsSessionHostV2 {
	readonly maskRasters?: Readonly<PhotoLibraryDevelopMaskRasterPortV1>;
	readonly originalSource?: Pick<PhotoLibraryDevelopOriginalSessionHostV2, 'loadOriginal' | 'withFrame'>;
	readonly presetStorage?: PhotoLibraryDevelopPresetStorageV2;
	readonly repository: Pick<PhotoCatalogRepositoryV2, 'loadPhoto'>;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly edit: <Result>(photoId: string, run: (owner: PhotoCommandOwnerV2, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
}
export interface PhotoLibraryDevelopSessionHostV3 {
	readonly repository: Pick<PhotoCatalogRepositoryCurrentV1, 'loadPhoto'>;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly edit: <Result>(photoId: string, run: (owner: PhotoCommandOwnerCurrentV1, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly originalSource?: Pick<PhotoLibraryDevelopOriginalSessionHostCurrentV1, 'loadOriginal' | 'withFrame'>;
	readonly maskRasters?: Readonly<PhotoLibraryDevelopMaskRasterPortV1>;
}
type Profile = 'legacy2' | 'current3';
type Host = PhotoLibraryDevelopSessionHostV2 | PhotoLibraryDevelopSessionHostV3;
type Port = PhotoLibraryDevelopPortV2 | PhotoLibraryDevelopPortV3;
type Snapshot = PhotoLibraryDevelopSnapshotV2 | PhotoLibraryDevelopSnapshotV3;
type Command = PhotoLibraryDevelopCommandV2 | PhotoLibraryDevelopCommandV3;
type Owner = Pick<PhotoCommandOwnerCurrentV1, 'history' | 'execute'>;

export function createPhotoLibraryDevelopSessionForProfileV1(profile: 'legacy2', host: PhotoLibraryDevelopSessionHostV2): Readonly<PhotoLibraryDevelopPortV2>;
export function createPhotoLibraryDevelopSessionForProfileV1(profile: 'current3', host: PhotoLibraryDevelopSessionHostV3): Readonly<PhotoLibraryDevelopPortV3>;
/** One joined read/write/ACK loop; only named owners select a fixed admission profile. */
export function createPhotoLibraryDevelopSessionForProfileV1(profile: Profile, host: Host): Readonly<Port> {
	assertProfile(profile);
	const legacy = profile === 'legacy2' ? host as PhotoLibraryDevelopSessionHostV2 : null;
	const repository = host.repository, originalSource = host.originalSource, presetStorage = legacy?.presetStorage, maskRasters = host.maskRasters;
	const initialize = host.ready, readPhoto = repository.loadPhoto, borrowedOperation = host.operation, borrowedEdit = host.edit;
	const borrowedMutate = legacy?.mutate;
	if ([initialize, readPhoto, borrowedOperation, borrowedEdit].some(method => typeof method !== 'function')) throw new TypeError('Complete Develop host capabilities are required.');
	const ready = (): Promise<string> => Reflect.apply(initialize, host, []) as Promise<string>;
	const operation = <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> => Reflect.apply(borrowedOperation<Result>, host, [run, signal]);
	const edit = <Result>(photoId: string, run: (owner: Owner, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> => Reflect.apply(borrowedEdit, host, [photoId, run, signal]);
	const loadPhoto = (catalogId: string, photoId: string) => Reflect.apply(readPhoto, repository, [catalogId, photoId]) as ReturnType<typeof readPhoto>;
	const children = legacy ? legacyChildren(legacy, ready, operation, loadPhoto, originalSource, presetStorage, borrowedMutate!) : {
		...(originalSource ? { original: currentOriginal(originalSource, ready, operation, loadPhoto) } : {}),
	};
	return Object.freeze({ schemaVersion: profile === 'legacy2' ? 2 : 3,
		...(maskRasters ? { maskRasters } : {}), ...children,
		async read(value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}) {
			const { signal } = readPhotoDevelopSignalOptionsV2(options);
			if (profile === 'current3') check(signal);
			let photoId: string, versionId: string | undefined;
			try {
				const input = request(profile, value, ['schemaVersion', 'photoId', 'versionId'], ['schemaVersion', 'photoId']);
				photoId = id(field(input, 'photoId'), 'develop photo ID');
				versionId = Object.hasOwn(input, 'versionId') ? id(field(input, 'versionId'), 'develop version ID') : undefined;
			} catch (error) { if (profile === 'current3') check(signal); throw error; }
			check(signal);
			return operation(async admitted => {
				const catalogId = await ready(); check(admitted);
				const raw = await loadPhoto(catalogId, photoId); check(admitted);
				if (!raw) throw new ReferenceError('The photo is missing.');
				const photo = profile === 'legacy2' ? normalizePhotoDocumentV1OrV2(raw) : normalizePhotoDocumentCurrentV1(raw); check(admitted);
				if (photo.id !== photoId || photo.catalogId !== catalogId) throw new ReferenceError('The photo changed its requested identity.');
				return readPhotoLibraryDevelopSnapshotForProfileV1(profile, photo, versionId);
			}, signal);
		},
		async apply(value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}) {
			const { signal } = readPhotoDevelopSignalOptionsV2(options);
			if (profile === 'current3') check(signal);
			let photoId: string, expected: number, command: Command;
			try {
				const input = request(profile, value, ['schemaVersion', 'photoId', 'expectedRevision', 'command'], ['schemaVersion', 'photoId', 'expectedRevision', 'command']);
				photoId = id(field(input, 'photoId'), 'develop photo ID');
				expected = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'expected develop photo revision');
				command = normalizePhotoLibraryDevelopCommandForProfileV1(profile, field(input, 'command'));
			} catch (error) { if (profile === 'current3') check(signal); throw error; }
			check(signal); const completed: { snapshot: Snapshot | null } = { snapshot: null };
			try {
				const snapshot = await edit(photoId, async (owner, admitted) => {
					if (owner.history.present.revision !== expected) throw new PhotoCatalogRevisionConflictError('photo');
					const photo = await owner.execute(command, { signal: admitted });
					const selected = command.type === 'delete-virtual-copy' || command.type === 'create-virtual-copy' ? undefined : command.versionId;
					// Preserve the real native ACK before selected lease cleanup can fail.
					completed.snapshot = readPhotoLibraryDevelopSnapshotForProfileV1(profile, photo, selected); return completed.snapshot;
				}, signal);
				return Object.freeze({ schemaVersion: profile === 'legacy2' ? 2 : 3, snapshot, notices: Object.freeze([]) });
			} catch (error) {
				if (completed.snapshot === null) throw error;
				return Object.freeze({ schemaVersion: profile === 'legacy2' ? 2 : 3, snapshot: completed.snapshot, notices: Object.freeze(['cleanup-failed'] as const) });
			}
		},
	}) as Readonly<Port>;
}

function legacyChildren(host: PhotoLibraryDevelopSessionHostV2, ready: () => Promise<string>, operation: PhotoLibraryDevelopSessionHostV2['operation'],
	loadPhoto: PhotoLibraryDevelopSessionHostV2['repository']['loadPhoto'] | PhotoLibraryDevelopSessionHostV3['repository']['loadPhoto'],
	originalSource: Host['originalSource'], presetStorage: PhotoLibraryDevelopPresetStorageV2 | undefined, borrowedMutate: PhotoLibraryDevelopSessionHostV2['mutate']) {
	const mutate: PhotoLibraryDevelopSessionHostV2['mutate'] = (run, signal) => Reflect.apply(borrowedMutate, host, [run, signal]);
	return { ...(originalSource ? { original: createPhotoLibraryDevelopOriginalSessionV2({ repository: { loadPhoto: loadPhoto as PhotoLibraryDevelopSessionHostV2['repository']['loadPhoto'] },
		ready, operation, ...originalSource }) } : {}), settings: createPhotoLibraryDevelopSettingsSessionV2(host),
		...(presetStorage ? { presets: createPhotoLibraryDevelopPresetsSessionV2({ storage: presetStorage, ready, operation, mutate }) } : {}) };
}
function currentOriginal(source: NonNullable<Host['originalSource']>, ready: () => Promise<string>, operation: PhotoLibraryDevelopSessionHostV3['operation'],
	loadPhoto: PhotoLibraryDevelopSessionHostV3['repository']['loadPhoto']) {
	const reader = source.loadOriginal, decoder = source.withFrame;
	if (typeof reader !== 'function' || (decoder !== undefined && typeof decoder !== 'function')) throw new TypeError('Complete original pixel capabilities are required.');
	const withFrame: typeof decoder = decoder ? (value, consume, dependencies) => Reflect.apply(decoder, source, [value, consume, dependencies]) : undefined;
	return createPhotoLibraryDevelopOriginalSessionCurrentV1({ repository: { loadPhoto }, ready, operation,
		loadOriginal: (...args) => Reflect.apply(reader, source, args),
		...(withFrame ? { withFrame } : {}),
	});
}

export function readPhotoLibraryDevelopSnapshotForProfileV1(profile: 'legacy2', value: unknown, selected?: string): PhotoLibraryDevelopSnapshotV2;
export function readPhotoLibraryDevelopSnapshotForProfileV1(profile: 'current3', value: unknown, selected?: string): PhotoLibraryDevelopSnapshotV3;
export function readPhotoLibraryDevelopSnapshotForProfileV1(profile: Profile, value: unknown, selected?: string): Snapshot;
export function readPhotoLibraryDevelopSnapshotForProfileV1(profile: Profile, value: unknown, selected?: string): Snapshot {
	assertProfile(profile);
	const photo = profile === 'legacy2' ? normalizePhotoDocumentV1OrV2(value) : normalizePhotoDocumentCurrentV1(value), versionId = selected ?? photo.activeVersionId;
	const version = photo.versions.find(candidate => candidate.id === versionId);
	if (!version) throw new ReferenceError('The requested photo version is missing.');
	const entries = version.workspace?.entries ?? [{ label: 'Initial settings', createdAt: version.createdAt }];
	return Object.freeze({ schemaVersion: profile === 'legacy2' ? 2 : 3, catalogId: photo.catalogId, photoId: photo.id, revision: photo.revision, activeVersionId: photo.activeVersionId, versionId,
		versions: Object.freeze(photo.versions.map(candidate => Object.freeze({ id: candidate.id, name: candidate.name, kind: candidate.kind }))),
		develop: profile === 'legacy2' ? normalizeImageDevelopStateV1OrV2(version.develop) : normalizeImageDevelopStateCurrentV1(version.develop),
		history: Object.freeze({ cursor: version.workspace?.cursor ?? 0,
			entries: Object.freeze(entries.map((entry, index) => Object.freeze({ index, label: entry.label, createdAt: entry.createdAt }))) }),
		snapshots: Object.freeze((version.workspace?.snapshots ?? []).map(snapshot => Object.freeze({ id: snapshot.id, name: snapshot.name, createdAt: snapshot.createdAt }))),
	}) as Snapshot;
}
export function normalizePhotoLibraryDevelopCommandForProfileV1(profile: 'legacy2', value: unknown): PhotoLibraryDevelopCommandV2;
export function normalizePhotoLibraryDevelopCommandForProfileV1(profile: 'current3', value: unknown): PhotoLibraryDevelopCommandV3;
export function normalizePhotoLibraryDevelopCommandForProfileV1(profile: Profile, value: unknown): Command;
export function normalizePhotoLibraryDevelopCommandForProfileV1(profile: Profile, value: unknown): Command {
	assertProfile(profile);
	const input = record(value, 'library develop command', ['type', 'versionId', 'develop', 'label', 'createdAt', 'cursor', 'id', 'name', 'snapshotId', 'sourceVersionId'], ['type']);
	const type = oneOf(field(input, 'type'), [...PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V2,
		'create-virtual-copy', 'activate-version', 'delete-virtual-copy', 'rename-virtual-copy'] as const, 'library develop command type');
	if (type === 'create-virtual-copy') {
		record(input, 'library develop virtual copy', ['type', 'id', 'name', 'createdAt', 'sourceVersionId']);
		return Object.freeze({ type, id: id(field(input, 'id'), 'virtual copy ID'), name: name(field(input, 'name'), 'virtual copy name'),
			createdAt: utcTimestamp(field(input, 'createdAt'), 'virtual copy time'), sourceVersionId: id(field(input, 'sourceVersionId'), 'virtual copy source ID') });
	}
	const versionId = id(field(input, 'versionId'), 'develop version ID');
	if (type === 'rename-virtual-copy') {
		record(input, 'library develop version name', ['type', 'versionId', 'name']);
		return Object.freeze({ type, versionId, name: name(field(input, 'name'), 'virtual copy name') });
	}
	if (type === 'activate-version' || type === 'delete-virtual-copy') { record(input, 'library develop version selection', ['type', 'versionId']); return Object.freeze({ type, versionId }); }
	const command = profile === 'legacy2' ? normalizePhotoDevelopWorkspaceCommandV2(input) : normalizePhotoDevelopWorkspaceCommandCurrentV1(input);
	return Object.freeze({ ...command, versionId });
}
function request(profile: Profile, value: unknown, allowed: readonly string[], required: readonly string[]) {
	const input = record(value, 'library develop request', allowed, required);
	if (field(input, 'schemaVersion') !== (profile === 'legacy2' ? 2 : 3)) throw new RangeError('Unsupported library develop request version.');
	return input;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }
function assertProfile(value: unknown): asserts value is Profile {
	if (value !== 'legacy2' && value !== 'current3') throw new RangeError('Unsupported Develop Session profile.');
}
