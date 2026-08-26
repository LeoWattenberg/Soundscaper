/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	isMasteringSequenceProjectSchema,
	isSoundscaperProductionProjectSchema,
} from '../project-schema-version.ts';
import {
	resolveSoundscaperProductionCopy,
	type SoundscaperProductionCopy,
} from './soundscaper-production-copy.ts';

export const SOUNDSCAPER_AUTOMATION_MODES = Object.freeze([
	'read', 'trim', 'touch', 'latch', 'write',
] as const);

export type SoundscaperAutomationMode = typeof SOUNDSCAPER_AUTOMATION_MODES[number];
export type SoundscaperFreezeStatus = 'none' | 'fresh' | 'stale' | 'verifying' | 'unknown';
export type SoundscaperProductionSurface =
	| 'automation'
	| 'routing'
	| 'restoration'
	| 'metering'
	| 'mastering-sequences'
	| 'reviewed-effects';
export type SoundscaperProductionMenuAction = SoundscaperProductionSurface;

export interface SoundscaperProductionMenuCapabilities {
	readonly audioAutomation?: unknown;
	readonly audioMixerGraph?: unknown;
	readonly audioTrackFreeze?: unknown;
	readonly audioEffects?: unknown;
	readonly audioAnalysis?: unknown;
	readonly reviewedWebEffectPackages?: unknown;
	readonly reviewedEffectPackages?: unknown;
	readonly masteringSequences?: unknown;
}

export interface SoundscaperProductionMenuInput {
	readonly productId: string;
	readonly capabilities: SoundscaperProductionMenuCapabilities;
	readonly project: unknown;
	readonly selectedTrackId?: string | null;
	readonly selectedAutomationTarget?: unknown;
	readonly automationMode?: SoundscaperAutomationMode;
	readonly freezeStatus?: SoundscaperFreezeStatus;
	readonly freezeActionsAvailable?: boolean;
	readonly editingBlocked: boolean;
	readonly readOnly?: boolean;
	readonly copy?: Readonly<Record<string, string | undefined>>;
}

export interface SoundscaperProductionMenuActions {
	open(surface: SoundscaperProductionSurface): unknown;
	setAutomationMode(mode: SoundscaperAutomationMode): unknown;
	freeze(operation: 'freeze' | 'refresh' | 'unfreeze' | 'commit', trackId: string): unknown;
}

export interface SoundscaperProductionMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly checked?: boolean;
	readonly items?: readonly SoundscaperProductionMenuItem[];
	onClick?(): unknown;
}

export interface SoundscaperProductionApplicationMenuItems {
	readonly tracks: readonly SoundscaperProductionMenuItem[];
	readonly mixer: readonly SoundscaperProductionMenuItem[];
	readonly effect: readonly SoundscaperProductionMenuItem[];
	readonly analyze: readonly SoundscaperProductionMenuItem[];
	readonly tools: readonly SoundscaperProductionMenuItem[];
}

const EMPTY_ITEMS: SoundscaperProductionApplicationMenuItems = Object.freeze({
	tracks: Object.freeze([]),
	mixer: Object.freeze([]),
	effect: Object.freeze([]),
	analyze: Object.freeze([]),
	tools: Object.freeze([]),
});

/**
 * Build Milestone 4A's opt-in surfaces for their existing menu owners.
 * The host decides where each returned location is spliced into its menu.
 */
export function createSoundscaperProductionApplicationMenuItems(
	input: SoundscaperProductionMenuInput,
	actions: SoundscaperProductionMenuActions,
): SoundscaperProductionApplicationMenuItems {
	if (input.productId !== 'soundscaper') return EMPTY_ITEMS;
	const copy = resolveSoundscaperProductionCopy(input.copy);
	const project = dataRecord(input.project);
	const exactProject = isSoundscaperProductionProjectSchema(own(project, 'schemaVersion'));
	const selectedTrack = records(own(project, 'tracks')).find((track) => (
		own(track, 'id') === input.selectedTrackId
	)) ?? null;
	const selectedAudioTrack = own(selectedTrack, 'type') === 'audio' ? selectedTrack : null;
	const trackId = text(own(selectedAudioTrack, 'id'));
	const locked = own(selectedAudioTrack, 'locked') === true;
	const readOnly = input.readOnly === true;
	const commonMutationBlocked = input.editingBlocked || readOnly;
	const automationTarget = input.selectedAutomationTarget ?? (trackId
		? Object.freeze({ kind: 'track', id: trackId })
		: null);
	const automationTargetIdentity = automationTargetKey(automationTarget);
	const automationTargetAvailable = automationTargetIdentity !== null
		&& automationTargetExists(project, automationTargetIdentity);
	const targetTrackId = own(dataRecord(automationTarget), 'kind') === 'track'
		? text(own(dataRecord(automationTarget), 'id'))
		: null;
	const targetTrack = targetTrackId === null ? null : records(own(project, 'tracks')).find((track) => (
		own(track, 'id') === targetTrackId && own(track, 'type') === 'audio'
	)) ?? null;
	const automationMutationBlocked = commonMutationBlocked
		|| own(targetTrack, 'locked') === true;
	const mode = SOUNDSCAPER_AUTOMATION_MODES.includes(input.automationMode ?? 'read')
		? input.automationMode ?? 'read'
		: 'read';

	const tracks: SoundscaperProductionMenuItem[] = [];
	if (enabled(input.capabilities.audioAutomation)) {
		tracks.push(automationMenu({
			copy, exactProject, mutationBlocked: automationMutationBlocked,
			automationTargetAvailable, mode, actions,
		}));
	}
	// A frozen track keeps the submenu even after its rack stops being freezable:
	// unfreeze, refresh and commit are exactly the operations that matter once the
	// live effects are gone, and without them a frozen track would go on playing
	// and exporting a stale render with no way to release it.
	if (enabled(input.capabilities.audioTrackFreeze)
		&& (hasFreezableRealtimeEffects(selectedAudioTrack) || hasOwnData(selectedAudioTrack, 'audioFreeze'))) {
		tracks.push(freezeMenu({
			copy, exactProject, mutationBlocked: commonMutationBlocked || locked,
			selectedAudioTrack, trackId,
			actionsAvailable: input.freezeActionsAvailable === true,
			status: resolvedFreezeStatus(input.freezeStatus, selectedAudioTrack), actions,
		}));
	}

	const mixer = enabled(input.capabilities.audioMixerGraph)
		? [leaf({
			id: 'soundscaper-routing-graph', label: copy.routingGraph,
			enabled: exactProject && own(project, 'mixer') !== undefined,
			invoke: () => actions.open('routing'),
		})]
		: [];
	const effect = enabled(input.capabilities.audioEffects)
		? [leaf({
			id: 'soundscaper-restoration', label: copy.restoration,
			enabled: project !== null,
			invoke: () => actions.open('restoration'),
		})]
		: [];
	const analyze = enabled(input.capabilities.audioAnalysis)
		? [leaf({
			id: 'soundscaper-production-meters', label: copy.productionMeters,
			enabled: project !== null,
			invoke: () => actions.open('metering'),
		})]
		: [];
	const reviewedPackages = enabled(input.capabilities.reviewedWebEffectPackages)
		|| enabled(input.capabilities.reviewedEffectPackages);
	const tools = [
		...(enabled(input.capabilities.masteringSequences)
			? [leaf({
				id: 'soundscaper-mastering-sequences', label: copy.masteringSequences,
				// Only a revision that owns the collection can hold one, so the entry
				// stays visible and disabled elsewhere rather than vanishing.
				enabled: isMasteringSequenceProjectSchema(own(project, 'schemaVersion')),
				invoke: () => actions.open('mastering-sequences'),
			})]
			: []),
		...(reviewedPackages && enabled(input.capabilities.audioEffects)
			? [leaf({
				id: 'soundscaper-reviewed-effects', label: copy.reviewedEffects,
				enabled: project !== null,
				invoke: () => actions.open('reviewed-effects'),
			})]
			: []),
	];

	return Object.freeze({
		tracks: Object.freeze(tracks),
		mixer: Object.freeze(mixer),
		effect: Object.freeze(effect),
		analyze: Object.freeze(analyze),
		tools: Object.freeze(tools),
	});
}

function automationMenu(input: Readonly<{
	copy: SoundscaperProductionCopy;
	exactProject: boolean;
	mutationBlocked: boolean;
	automationTargetAvailable: boolean;
	mode: SoundscaperAutomationMode;
	actions: SoundscaperProductionMenuActions;
}>): SoundscaperProductionMenuItem {
	const inspectable = input.exactProject && input.automationTargetAvailable;
	const writable = inspectable && !input.mutationBlocked;
	const modeItems = SOUNDSCAPER_AUTOMATION_MODES.map((mode) => leaf({
		id: `soundscaper-automation-mode-${mode}`,
		label: automationModeLabel(input.copy, mode),
		enabled: writable,
		checked: input.mode === mode,
		invoke: () => input.actions.setAutomationMode(mode),
	}));
	return branch('soundscaper-automation', input.copy.automation, [
		leaf({
			id: 'soundscaper-automation-edit', label: input.copy.editAutomationLanes,
			enabled: inspectable, invoke: () => input.actions.open('automation'),
		}),
		branch('soundscaper-automation-mode', input.copy.automationMode, modeItems, !writable),
	], !inspectable);
}

function freezeMenu(input: Readonly<{
	copy: SoundscaperProductionCopy;
	exactProject: boolean;
	mutationBlocked: boolean;
	selectedAudioTrack: DataRecord | null;
	trackId: string | null;
	actionsAvailable: boolean;
	status: SoundscaperFreezeStatus;
	actions: SoundscaperProductionMenuActions;
}>): SoundscaperProductionMenuItem {
	const frozen = hasOwnData(input.selectedAudioTrack, 'audioFreeze');
	const idle = input.status !== 'verifying';
	const writable = input.exactProject && !input.mutationBlocked && input.trackId !== null
		&& idle && input.actionsAvailable;
	const clipIds = own(input.selectedAudioTrack, 'clipIds');
	const hasAudio = Array.isArray(clipIds) && clipIds.length > 0;
	const operation = (
		id: string,
		label: string,
		name: 'freeze' | 'refresh' | 'unfreeze' | 'commit',
		available: boolean,
	) => leaf({
		id, label, enabled: writable && available,
		invoke: () => input.trackId === null ? undefined : input.actions.freeze(name, input.trackId),
	});
	return branch('soundscaper-freeze', freezeLabel(input.copy, input.status), [
		operation(
			'soundscaper-freeze-track', input.copy.freezeTrack, 'freeze',
			!frozen && hasAudio && hasFreezableRealtimeEffects(input.selectedAudioTrack),
		),
		operation('soundscaper-refresh-freeze', input.copy.refreshFrozenTrack, 'refresh', frozen),
		operation('soundscaper-unfreeze-track', input.copy.unfreezeTrack, 'unfreeze', frozen),
		operation('soundscaper-commit-freeze', input.copy.commitFrozenTrack, 'commit', frozen && input.status === 'fresh'),
	], input.trackId === null || !input.exactProject);
}

function leaf(input: Readonly<{
	id: string;
	label: string;
	enabled: boolean;
	checked?: boolean;
	invoke(): unknown;
}>): SoundscaperProductionMenuItem {
	return Object.freeze({
		id: input.id,
		label: input.label,
		disabled: !input.enabled,
		...(input.checked === undefined ? {} : { checked: input.checked }),
		onClick: () => input.enabled ? input.invoke() : undefined,
	});
}

function branch(
	id: string,
	label: string,
	items: readonly SoundscaperProductionMenuItem[],
	disabled = items.every((item) => item.disabled === true),
): SoundscaperProductionMenuItem {
	return Object.freeze({ id, label, disabled, items: Object.freeze([...items]) });
}

function automationModeLabel(
	copy: SoundscaperProductionCopy,
	mode: SoundscaperAutomationMode,
): string {
	return {
		read: copy.automationRead,
		trim: copy.automationTrim,
		touch: copy.automationTouch,
		latch: copy.automationLatch,
		write: copy.automationWrite,
	}[mode];
}

function freezeLabel(copy: SoundscaperProductionCopy, status: SoundscaperFreezeStatus): string {
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
	const frozen = hasOwnData(track, 'audioFreeze');
	if (!frozen) return value === undefined || value === 'none' ? 'none' : 'unknown';
	if (value === 'fresh' || value === 'stale' || value === 'verifying') return value;
	return 'unknown';
}

function hasFreezableRealtimeEffects(track: DataRecord | null): boolean {
	if (track === null || own(track, 'effectsActive') === false) return false;
	const effects = own(track, 'effects');
	return Array.isArray(effects) && effects.some((effect) => {
		const value = dataRecord(effect);
		return value !== null && own(value, 'enabled') !== false && own(value, 'bypassed') !== true;
	});
}

type DataRecord = Readonly<Record<string, unknown>>;

function enabled(value: unknown): boolean {
	return value === true;
}

function dataRecord(value: unknown): DataRecord | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as DataRecord;
}

function records(value: unknown): readonly DataRecord[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	return Object.freeze(value.map(dataRecord).filter((item): item is DataRecord => item !== null));
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

function automationTargetKey(value: unknown): string | null {
	const target = dataRecord(value);
	const kind = own(target, 'kind');
	if (kind === 'master') return 'strip:master';
	if (kind === 'track' || kind === 'mixer-node') {
		const id = text(own(target, 'id'));
		return id ? `strip:${kind}:${id}` : null;
	}
	if (kind === 'edge') {
		const id = text(own(target, 'edgeId')) ?? text(own(target, 'id'));
		return id ? `edge:${id}` : null;
	}
	return null;
}

function automationTargetExists(project: DataRecord | null, key: string): boolean {
	if (key === 'strip:master') return project !== null;
	if (key.startsWith('strip:track:')) {
		const id = key.slice('strip:track:'.length);
		return records(own(project, 'tracks')).some((track) => (
			own(track, 'type') === 'audio' && own(track, 'id') === id
		));
	}
	const mixer = dataRecord(own(project, 'mixer'));
	if (key.startsWith('strip:mixer-node:')) {
		const id = key.slice('strip:mixer-node:'.length);
		return ['groups', 'sends', 'cues'].some((collection) => (
			records(own(mixer, collection)).some((node) => own(node, 'id') === id)
		));
	}
	if (key.startsWith('edge:')) {
		const id = key.slice('edge:'.length);
		return records(own(mixer, 'edges')).some((edge) => own(edge, 'id') === id);
	}
	return false;
}
