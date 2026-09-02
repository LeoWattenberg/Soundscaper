/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	hasMasteringSequenceProjectAuthority,
	isSoundscaperProductionProject,
} from '../project-schema-version.ts';

export type SoundscaperFreezeStatus = 'none' | 'fresh' | 'stale' | 'verifying' | 'unknown';

export interface SoundscaperWorkflowMenuCapabilities {
	readonly audioTrackFreeze?: unknown;
	readonly masteringSequences?: unknown;
}

export interface SoundscaperWorkflowMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly items?: readonly SoundscaperWorkflowMenuItem[];
	onClick?(): unknown;
}

export interface SoundscaperWorkflowApplicationMenuItems {
	readonly tracks: readonly SoundscaperWorkflowMenuItem[];
	readonly mixer: readonly SoundscaperWorkflowMenuItem[];
	readonly effect: readonly SoundscaperWorkflowMenuItem[];
	readonly analyze: readonly SoundscaperWorkflowMenuItem[];
	readonly tools: readonly SoundscaperWorkflowMenuItem[];
}

export interface SoundscaperWorkflowMenuActions {
	openMasteringSequences(): unknown;
	freeze(operation: 'freeze' | 'refresh' | 'unfreeze' | 'commit', trackId: string): unknown;
}

const EMPTY_ITEMS: SoundscaperWorkflowApplicationMenuItems = Object.freeze({
	tracks: Object.freeze([]),
	mixer: Object.freeze([]),
	effect: Object.freeze([]),
	analyze: Object.freeze([]),
	tools: Object.freeze([]),
});

const DEFAULT_COPY = Object.freeze({
	freeze: 'Freeze',
	freezeFresh: 'Freeze (fresh)',
	freezeStale: 'Freeze (stale)',
	freezeVerifying: 'Freeze (verifying)',
	freezeUnknown: 'Freeze (status unknown)',
	freezeTrack: 'Freeze track',
	refreshFrozenTrack: 'Refresh frozen track',
	unfreezeTrack: 'Unfreeze track',
	commitFrozenTrack: 'Commit frozen track',
	masteringSequences: 'Mastering sequences…',
});

type WorkflowCopy = typeof DEFAULT_COPY;
type DataRecord = Readonly<Record<string, unknown>>;

export function createSoundscaperWorkflowApplicationMenuItems(
	input: Readonly<{
		productId: string;
		capabilities: SoundscaperWorkflowMenuCapabilities;
		project: unknown;
		selectedTrackId?: string | null;
		freezeStatus?: SoundscaperFreezeStatus;
		freezeActionsAvailable?: boolean;
		editingBlocked: boolean;
		readOnly?: boolean;
		copy?: Readonly<Record<string, unknown>>;
	}>,
	actions: SoundscaperWorkflowMenuActions,
): SoundscaperWorkflowApplicationMenuItems {
	if (input.productId !== 'soundscaper') return EMPTY_ITEMS;
	const copy = workflowCopy(input.copy);
	const project = dataRecord(input.project);
	const exactProject = isSoundscaperProductionProject(project);
	const selectedTrack = records(own(project, 'tracks')).find((track) => (
		own(track, 'id') === input.selectedTrackId
	)) ?? null;
	const selectedAudioTrack = own(selectedTrack, 'type') === 'audio' ? selectedTrack : null;
	const trackId = text(own(selectedAudioTrack, 'id'));
	const mutationBlocked = input.editingBlocked
		|| input.readOnly === true
		|| own(selectedAudioTrack, 'locked') === true;
	const tracks = input.capabilities.audioTrackFreeze === true
		&& (hasFreezableRealtimeEffects(selectedAudioTrack) || hasOwnData(selectedAudioTrack, 'audioFreeze'))
		? [freezeMenu({
			copy,
			exactProject,
			mutationBlocked,
			selectedAudioTrack,
			trackId,
			actionsAvailable: input.freezeActionsAvailable === true,
			status: resolvedFreezeStatus(input.freezeStatus, selectedAudioTrack),
			actions,
		})]
		: [];
	const tools = input.capabilities.masteringSequences === true
		? [leaf({
			id: 'soundscaper-mastering-sequences',
			label: copy.masteringSequences,
			enabled: hasMasteringSequenceProjectAuthority(project),
			invoke: actions.openMasteringSequences,
		})]
		: [];
	return Object.freeze({
		tracks: Object.freeze(tracks),
		mixer: Object.freeze([]),
		effect: Object.freeze([]),
		analyze: Object.freeze([]),
		tools: Object.freeze(tools),
	});
}

function freezeMenu(input: Readonly<{
	copy: WorkflowCopy;
	exactProject: boolean;
	mutationBlocked: boolean;
	selectedAudioTrack: DataRecord | null;
	trackId: string | null;
	actionsAvailable: boolean;
	status: SoundscaperFreezeStatus;
	actions: SoundscaperWorkflowMenuActions;
}>): SoundscaperWorkflowMenuItem {
	const frozen = hasOwnData(input.selectedAudioTrack, 'audioFreeze');
	const writable = input.exactProject && !input.mutationBlocked && input.trackId !== null
		&& input.status !== 'verifying' && input.actionsAvailable;
	const clipIds = own(input.selectedAudioTrack, 'clipIds');
	const operation = (
		id: string,
		label: string,
		name: 'freeze' | 'refresh' | 'unfreeze' | 'commit',
		available: boolean,
	): SoundscaperWorkflowMenuItem => leaf({
		id,
		label,
		enabled: writable && available,
		invoke: () => input.trackId === null ? undefined : input.actions.freeze(name, input.trackId),
	});
	return Object.freeze({
		id: 'soundscaper-freeze',
		label: freezeLabel(input.copy, input.status),
		disabled: input.trackId === null || !input.exactProject,
		items: Object.freeze([
			operation('soundscaper-freeze-track', input.copy.freezeTrack, 'freeze',
				!frozen && Array.isArray(clipIds) && clipIds.length > 0
				&& hasFreezableRealtimeEffects(input.selectedAudioTrack)),
			operation('soundscaper-refresh-freeze', input.copy.refreshFrozenTrack, 'refresh', frozen),
			operation('soundscaper-unfreeze-track', input.copy.unfreezeTrack, 'unfreeze', frozen),
			operation('soundscaper-commit-freeze', input.copy.commitFrozenTrack, 'commit',
				frozen && input.status === 'fresh'),
		]),
	});
}

function leaf(input: Readonly<{
	id: string;
	label: string;
	enabled: boolean;
	invoke(): unknown;
}>): SoundscaperWorkflowMenuItem {
	return Object.freeze({
		id: input.id,
		label: input.label,
		disabled: !input.enabled,
		onClick: () => input.enabled ? input.invoke() : undefined,
	});
}

function workflowCopy(value?: Readonly<Record<string, unknown>>): WorkflowCopy {
	return Object.freeze(Object.fromEntries(Object.entries(DEFAULT_COPY).map(([key, fallback]) => [
		key,
		typeof value?.[key] === 'string' && value[key] ? value[key] : fallback,
	]))) as WorkflowCopy;
}

function freezeLabel(copy: WorkflowCopy, status: SoundscaperFreezeStatus): string {
	return {
		none: copy.freeze,
		fresh: copy.freezeFresh,
		stale: copy.freezeStale,
		verifying: copy.freezeVerifying,
		unknown: copy.freezeUnknown,
	}[status];
}

function resolvedFreezeStatus(
	value: SoundscaperFreezeStatus | undefined,
	track: DataRecord | null,
): SoundscaperFreezeStatus {
	if (!hasOwnData(track, 'audioFreeze')) return value === undefined || value === 'none' ? 'none' : 'unknown';
	return value === 'fresh' || value === 'stale' || value === 'verifying' ? value : 'unknown';
}

function hasFreezableRealtimeEffects(track: DataRecord | null): boolean {
	if (track === null || own(track, 'effectsActive') === false) return false;
	return records(own(track, 'effects')).some((effect) => (
		own(effect, 'enabled') !== false && own(effect, 'bypassed') !== true
	));
}

function dataRecord(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as DataRecord
		: null;
}

function records(value: unknown): readonly DataRecord[] {
	return Array.isArray(value)
		? Object.freeze(value.map(dataRecord).filter((item): item is DataRecord => item !== null))
		: Object.freeze([]);
}

function own(record: DataRecord | null, key: string): unknown {
	if (!record) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
		? descriptor.value
		: undefined;
}

function hasOwnData(record: DataRecord | null, key: string): boolean {
	return own(record, key) !== undefined;
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}
