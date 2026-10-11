/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPortV2, PhotoLibraryDevelopSnapshotV2, PhotoLibraryDevelopCommandV2 } from '../../common/editor/photo-library-develop-port-v2.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import type { PhotoCatalogRepositoryV2 } from '../catalog/photo-catalog-repository-v2.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { field, id, integer, name, oneOf, record, utcTimestamp } from '../catalog/value-validation.ts';
import type { PhotoCommandOwnerV2 } from './photo-command-owner-v2.ts';
import { normalizePhotoDevelopWorkspaceCommandV2, PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V2 } from './photo-develop-workspace-commands-v2.ts';
import { createPhotoLibraryDevelopSettingsSessionV2, type PhotoLibraryDevelopSettingsSessionHostV2 } from './photo-library-develop-settings-session-v2.ts';
import { createPhotoLibraryDevelopPresetsSessionV2, type PhotoLibraryDevelopPresetStorageV2 } from './photo-library-develop-presets-session-v2.ts';
import { createPhotoLibraryDevelopOriginalSessionV2, type PhotoLibraryDevelopOriginalSessionHostV2 } from './photo-library-develop-original-session-v2.ts';
import type { PhotoLibraryDevelopMaskRasterPortV1 } from '../../common/editor/photo-library-develop-mask-raster-port-v1.ts';

export interface PhotoLibraryDevelopSessionHostV2 extends PhotoLibraryDevelopSettingsSessionHostV2 {
	readonly maskRasters?: Readonly<PhotoLibraryDevelopMaskRasterPortV1>;
	readonly originalSource?: Pick<PhotoLibraryDevelopOriginalSessionHostV2, 'loadOriginal' | 'withFrame'>;
	readonly presetStorage?: PhotoLibraryDevelopPresetStorageV2;
	readonly repository: Pick<PhotoCatalogRepositoryV2, 'loadPhoto'>;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly edit: <Result>(photoId: string, run: (owner: PhotoCommandOwnerV2, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
}

/** Borrows the existing Session's lifetime, single writer and durable photo owner. */
export function createPhotoLibraryDevelopSessionV2(host: PhotoLibraryDevelopSessionHostV2): Readonly<PhotoLibraryDevelopPortV2> {
	const repository = host.repository, originalSource = host.originalSource, presetStorage = host.presetStorage, maskRasters = host.maskRasters;
	const initialize = host.ready, readPhoto = repository.loadPhoto, borrowedOperation = host.operation, borrowedEdit = host.edit, borrowedMutate = host.mutate;
	if ([initialize, readPhoto, borrowedOperation, borrowedEdit].some(method => typeof method !== 'function')) throw new TypeError('Complete Develop host capabilities are required.');
	const ready = (): Promise<string> => Reflect.apply(initialize, host, []) as Promise<string>;
	const operation: PhotoLibraryDevelopSessionHostV2['operation'] = (run, signal) => Reflect.apply(borrowedOperation, host, [run, signal]);
	const edit: PhotoLibraryDevelopSessionHostV2['edit'] = (photoId, run, signal) => Reflect.apply(borrowedEdit, host, [photoId, run, signal]);
	const mutate: PhotoLibraryDevelopSessionHostV2['mutate'] = (run, signal) => Reflect.apply(borrowedMutate, host, [run, signal]);
	const loadPhoto: typeof readPhoto = (...args) => Reflect.apply(readPhoto, repository, args);
	return Object.freeze({ schemaVersion: 2,
		...(maskRasters ? { maskRasters } : {}),
		...(originalSource ? { original: createPhotoLibraryDevelopOriginalSessionV2({ repository: { loadPhoto },
			ready, operation, ...originalSource }) } : {}),
		settings: createPhotoLibraryDevelopSettingsSessionV2(host),
		...(presetStorage ? { presets: createPhotoLibraryDevelopPresetsSessionV2({ storage: presetStorage,
			ready, operation, mutate }) } : {}),
		async read(value, options = {}) {
			const { signal } = readPhotoDevelopSignalOptionsV2(options);
			const input = request(value, ['schemaVersion', 'photoId', 'versionId'], ['schemaVersion', 'photoId']);
			const photoId = id(field(input, 'photoId'), 'develop photo ID');
			const versionId = Object.hasOwn(input, 'versionId') ? id(field(input, 'versionId'), 'develop version ID') : undefined;
			check(signal);
			return operation(async admitted => {
				const catalogId = await ready(); check(admitted);
				const raw = await loadPhoto(catalogId, photoId); check(admitted);
				if (!raw) throw new ReferenceError('The photo is missing.');
				const photo = normalizePhotoDocumentV1OrV2(raw); check(admitted);
				if (photo.id !== photoId || photo.catalogId !== catalogId) throw new ReferenceError('The photo changed its requested identity.');
				return readPhotoLibraryDevelopSnapshotV2(photo, versionId);
			}, signal);
		},
		async apply(value, options = {}) {
			const { signal } = readPhotoDevelopSignalOptionsV2(options);
			const input = request(value, ['schemaVersion', 'photoId', 'expectedRevision', 'command'], ['schemaVersion', 'photoId', 'expectedRevision', 'command']);
			const photoId = id(field(input, 'photoId'), 'develop photo ID');
			const expected = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'expected develop photo revision');
			const command = normalizePhotoLibraryDevelopCommandV2(field(input, 'command'));
			check(signal);
			const completed: { snapshot: PhotoLibraryDevelopSnapshotV2 | null } = { snapshot: null };
			try {
				const snapshot = await edit(photoId, async (owner, admitted) => {
					if (owner.history.present.revision !== expected) throw new PhotoCatalogRevisionConflictError('photo');
					const photo = await owner.execute(command, { signal: admitted });
					// Capture the durable result before the borrowed catalog lease finishes cleanup.
					const selected = command.type === 'delete-virtual-copy' || command.type === 'create-virtual-copy' ? undefined : command.versionId;
					completed.snapshot = readPhotoLibraryDevelopSnapshotV2(photo, selected);
					return completed.snapshot;
				}, signal);
				return Object.freeze({ schemaVersion: 2 as const, snapshot, notices: Object.freeze([]) });
			} catch (error) {
				if (completed.snapshot === null) throw error;
				return Object.freeze({ schemaVersion: 2 as const, snapshot: completed.snapshot, notices: Object.freeze(['cleanup-failed'] as const) });
			}
		},
	} satisfies PhotoLibraryDevelopPortV2);
}

export function readPhotoLibraryDevelopSnapshotV2(value: unknown, selected?: string): PhotoLibraryDevelopSnapshotV2 {
	const photo = normalizePhotoDocumentV1OrV2(value), versionId = selected ?? photo.activeVersionId;
	const version = photo.versions.find(candidate => candidate.id === versionId);
	if (!version) throw new ReferenceError('The requested photo version is missing.');
	const entries = version.workspace?.entries ?? [{ label: 'Initial settings', createdAt: version.createdAt }];
	return Object.freeze({ schemaVersion: 2, catalogId: photo.catalogId, photoId: photo.id, revision: photo.revision, activeVersionId: photo.activeVersionId, versionId,
		versions: Object.freeze(photo.versions.map(candidate => Object.freeze({ id: candidate.id, name: candidate.name, kind: candidate.kind }))),
		develop: normalizeImageDevelopStateV1OrV2(version.develop),
		history: Object.freeze({ cursor: version.workspace?.cursor ?? 0,
			entries: Object.freeze(entries.map((entry, index) => Object.freeze({ index, label: entry.label, createdAt: entry.createdAt }))) }),
		snapshots: Object.freeze((version.workspace?.snapshots ?? []).map(snapshot => Object.freeze({ id: snapshot.id, name: snapshot.name, createdAt: snapshot.createdAt }))),
	});
}

/** A closed, detached subset of photo commands. Metadata, attributes and opaque future types do not enter this port. */
export function normalizePhotoLibraryDevelopCommandV2(value: unknown): PhotoLibraryDevelopCommandV2 {
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
	if (type === 'activate-version' || type === 'delete-virtual-copy') {
		record(input, 'library develop version selection', ['type', 'versionId']);
		return Object.freeze({ type, versionId });
	}
	const command = normalizePhotoDevelopWorkspaceCommandV2(input);
	return Object.freeze({ ...command, versionId });
}

function request(value: unknown, allowed: readonly string[], required: readonly string[]) {
	const input = record(value, 'library develop request', allowed, required);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported library develop request version.');
	return input;
}

const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }
