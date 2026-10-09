/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPortV1, PhotoLibraryDevelopSnapshotV1, PhotoLibraryDevelopCommandV1 } from '../../common/editor/photo-library-develop-port-v1.ts';
import { normalizePhotoDevelopV1 } from '../catalog/develop-state.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { readPhotoStackSignalOptionsV1 } from '../catalog/photo-stack-repository-v1.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { field, id, integer, name, oneOf, record, utcTimestamp } from '../catalog/value-validation.ts';
import type { PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';
import type { PhotoCommandOwnerV1 } from './photo-command-owner.ts';
import { normalizePhotoDevelopWorkspaceCommandV1, PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V1 } from './photo-develop-workspace-commands-v1.ts';
import { createPhotoLibraryDevelopSettingsSessionV1, type PhotoLibraryDevelopSettingsSessionHostV1 } from './photo-library-develop-settings-session-v1.ts';
import { createPhotoLibraryDevelopPresetsSessionV1, type PhotoLibraryDevelopPresetStorageV1 } from './photo-library-develop-presets-session-v1.ts';
import { createPhotoLibraryDevelopOriginalSessionV1, type PhotoLibraryDevelopOriginalSessionHostV1 } from './photo-library-develop-original-session-v1.ts';

export interface PhotoLibraryDevelopSessionHostV1 extends PhotoLibraryDevelopSettingsSessionHostV1 {
	readonly originalSource?: Pick<PhotoLibraryDevelopOriginalSessionHostV1, 'loadOriginal' | 'withFrame'>;
	readonly presetStorage?: PhotoLibraryDevelopPresetStorageV1;
	readonly repository: Pick<PhotoLibrarySessionPortsV1['catalog'], 'loadPhoto'>;
	readonly ready: () => Promise<string>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly edit: <Result>(photoId: string, run: (owner: PhotoCommandOwnerV1, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
}

/** Borrows the existing Session's lifetime, single writer and durable photo owner. */
export function createPhotoLibraryDevelopSessionV1(host: PhotoLibraryDevelopSessionHostV1): Readonly<PhotoLibraryDevelopPortV1> {
	return Object.freeze({
		...(host.originalSource ? { original: createPhotoLibraryDevelopOriginalSessionV1({ repository: host.repository,
			ready: host.ready, operation: host.operation, ...host.originalSource }) } : {}),
		settings: createPhotoLibraryDevelopSettingsSessionV1(host),
		...(host.presetStorage ? { presets: createPhotoLibraryDevelopPresetsSessionV1({ storage: host.presetStorage,
			ready: host.ready, operation: host.operation, mutate: host.mutate }) } : {}),
		async read(value, options = {}) {
			const input = request(value, ['schemaVersion', 'photoId', 'versionId'], ['schemaVersion', 'photoId']);
			const photoId = id(field(input, 'photoId'), 'develop photo ID');
			const versionId = Object.hasOwn(input, 'versionId') ? id(field(input, 'versionId'), 'develop version ID') : undefined;
			const { signal } = readPhotoStackSignalOptionsV1(options);
			return host.operation(async admitted => {
				const catalogId = await host.ready(); admitted.throwIfAborted();
				const photo = await host.repository.loadPhoto(catalogId, photoId); admitted.throwIfAborted();
				if (!photo) throw new ReferenceError('The photo is missing.');
				return readPhotoLibraryDevelopSnapshotV1(photo, versionId);
			}, signal);
		},
		async apply(value, options = {}) {
			const input = request(value, ['schemaVersion', 'photoId', 'expectedRevision', 'command'], ['schemaVersion', 'photoId', 'expectedRevision', 'command']);
			const photoId = id(field(input, 'photoId'), 'develop photo ID');
			const expected = integer(field(input, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'expected develop photo revision');
			const command = normalizePhotoLibraryDevelopCommandV1(field(input, 'command'));
			const { signal } = readPhotoStackSignalOptionsV1(options);
			const completed: { snapshot: PhotoLibraryDevelopSnapshotV1 | null } = { snapshot: null };
			try {
				const snapshot = await host.edit(photoId, async (owner, admitted) => {
					if (owner.history.present.revision !== expected) throw new PhotoCatalogRevisionConflictError('photo');
					const photo = await owner.execute(command, { signal: admitted });
					// Capture the durable result before the borrowed catalog lease finishes cleanup.
					const selected = command.type === 'delete-virtual-copy' || command.type === 'create-virtual-copy' ? undefined : command.versionId;
					completed.snapshot = readPhotoLibraryDevelopSnapshotV1(photo, selected);
					return completed.snapshot;
				}, signal);
				return Object.freeze({ snapshot, notices: Object.freeze([]) });
			} catch (error) {
				if (completed.snapshot === null) throw error;
				return Object.freeze({ snapshot: completed.snapshot, notices: Object.freeze(['cleanup-failed'] as const) });
			}
		},
	} satisfies PhotoLibraryDevelopPortV1);
}

export function readPhotoLibraryDevelopSnapshotV1(photo: PhotoDocumentV1, versionId = photo.activeVersionId): PhotoLibraryDevelopSnapshotV1 {
	const version = photo.versions.find(candidate => candidate.id === versionId);
	if (!version) throw new ReferenceError('The requested photo version is missing.');
	const entries = version.workspace?.entries ?? [{ label: 'Initial settings', createdAt: version.createdAt }];
	return Object.freeze({ schemaVersion: 1, catalogId: photo.catalogId, photoId: photo.id, revision: photo.revision, activeVersionId: photo.activeVersionId, versionId,
		versions: Object.freeze(photo.versions.map(candidate => Object.freeze({ id: candidate.id, name: candidate.name, kind: candidate.kind }))),
		develop: normalizePhotoDevelopV1(version.develop),
		history: Object.freeze({ cursor: version.workspace?.cursor ?? 0,
			entries: Object.freeze(entries.map((entry, index) => Object.freeze({ index, label: entry.label, createdAt: entry.createdAt }))) }),
		snapshots: Object.freeze((version.workspace?.snapshots ?? []).map(snapshot => Object.freeze({ id: snapshot.id, name: snapshot.name, createdAt: snapshot.createdAt }))),
	});
}

/** A closed, detached subset of photo commands. Metadata, attributes and opaque future types do not enter this port. */
export function normalizePhotoLibraryDevelopCommandV1(value: unknown): PhotoLibraryDevelopCommandV1 {
	const input = record(value, 'library develop command', ['type', 'versionId', 'develop', 'label', 'createdAt', 'cursor', 'id', 'name', 'snapshotId', 'sourceVersionId'], ['type']);
	const type = oneOf(field(input, 'type'), [...PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V1,
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
	const command = normalizePhotoDevelopWorkspaceCommandV1(input);
	return Object.freeze({ ...command, versionId });
}

function request(value: unknown, allowed: readonly string[], required: readonly string[]) {
	const input = record(value, 'library develop request', allowed, required);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported library develop request version.');
	return input;
}
