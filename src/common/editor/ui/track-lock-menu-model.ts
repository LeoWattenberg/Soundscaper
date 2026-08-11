/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Readonly<Record<string, unknown>>;

export interface TrackLockMenuCopy {
	readonly lockTrack: string;
	readonly unlockTrack: string;
}

export interface TrackLockMenuInput {
	readonly project: unknown;
	readonly selectedTrackId: string | null;
	readonly editingBlocked: boolean;
	readonly copy: TrackLockMenuCopy;
}

export interface TrackLockOperation {
	readonly trackId: string;
	readonly locked: boolean;
}

export interface TrackLockMenuItemModel {
	readonly id: 'track-lock-toggle';
	readonly label: string;
	readonly disabled: boolean;
	readonly operation: Readonly<TrackLockOperation> | null;
}

export interface TrackLockMenuModel {
	readonly toggle: Readonly<TrackLockMenuItemModel>;
}

export interface TrackLockMenuActions {
	setTrackLocked(trackId: string, locked: boolean): unknown;
}

export interface TrackLockApplicationMenuItem {
	readonly id: 'track-lock-toggle';
	readonly label: string;
	readonly disabled: boolean;
	onClick(): unknown;
}

export interface TrackLockMenuItems {
	readonly toggle: Readonly<TrackLockApplicationMenuItem>;
}

/** Derive one shared, menu-only lock toggle from exact persisted track state. */
export function createTrackLockMenuModel(
	input: TrackLockMenuInput,
): Readonly<TrackLockMenuModel> {
	const selected = selectedLockableTrack(input.project, input.selectedTrackId);
	const operation = selected === null ? null : Object.freeze({
		trackId: String(selected.id),
		locked: !selected.locked,
	});
	const toggle = Object.freeze({
		id: 'track-lock-toggle' as const,
		label: selected?.locked === true ? input.copy.unlockTrack : input.copy.lockTrack,
		disabled: input.editingBlocked || operation === null,
		operation,
	});
	return Object.freeze({ toggle });
}

/** Bind the frozen render model to the existing track/update controller port. */
export function createTrackLockMenuItems(
	model: Readonly<TrackLockMenuModel>,
	actions: TrackLockMenuActions,
): Readonly<TrackLockMenuItems> {
	const item = model.toggle;
	return Object.freeze({
		toggle: Object.freeze({
			id: item.id,
			label: item.label,
			disabled: item.disabled,
			onClick: () => item.disabled || item.operation === null
				? undefined
				: actions.setTrackLocked(item.operation.trackId, item.operation.locked),
		}),
	});
}

function selectedLockableTrack(project: unknown, selectedTrackId: string | null): DataRecord | null {
	if (typeof selectedTrackId !== 'string' || selectedTrackId.length === 0) return null;
	const candidate = record(project);
	const tracks = Array.isArray(candidate?.tracks) ? candidate.tracks : [];
	const selected = tracks.find((value) => record(value)?.id === selectedTrackId);
	const track = record(selected);
	if (!track || !lockableTrackKind(track.type) || typeof track.locked !== 'boolean') return null;
	return track;
}

function lockableTrackKind(value: unknown): value is 'audio' | 'video' | 'label' {
	return value === 'audio' || value === 'video' || value === 'label';
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as DataRecord
		: null;
}
