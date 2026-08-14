/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertAutomationLaneIdentitiesUniqueV21,
	normalizeAutomationLaneV21,
	type AutomationLaneV21,
} from '../automation-lane-v21.ts';
import {
	normalizeMixerGraphV21,
	type MixerGraphV21,
} from '../mixer-graph-v21.ts';
import {
	commitAudioTrackFreezeCandidateV21,
	installAudioTrackFreezeCandidateV21,
	removeAudioTrackFreezeCandidateV21,
} from '../audio-track-freeze-lifecycle-v21.ts';
import type {
	AudioTrackFreezeDigestsV1,
	AudioTrackFreezeV1,
} from '../audio-track-freeze-v21.ts';
import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';

export const AUDIO_PRODUCTION_COMMAND_TYPES = [
	'automation-lane/set',
	'mixer-graph/set',
	'audio-freeze/install',
	'audio-freeze/remove',
	'audio-freeze/commit',
] as const;

export type AudioProductionCommandType = typeof AUDIO_PRODUCTION_COMMAND_TYPES[number];

export interface AudioProductionCommandPayloads {
	readonly 'automation-lane/set': {
		readonly laneId: string;
		readonly expected: Readonly<Record<string, unknown>> | null;
		readonly lane: Readonly<Record<string, unknown>> | null;
	};
	readonly 'mixer-graph/set': {
		readonly expected: Readonly<Record<string, unknown>>;
		readonly mixer: Readonly<Record<string, unknown>>;
	};
	readonly 'audio-freeze/install': {
		readonly trackId: string;
		readonly expectedFreeze: AudioTrackFreezeV1 | null;
		readonly replacementFreeze: AudioTrackFreezeV1;
		readonly derivedSource: Readonly<Record<string, unknown>>;
		readonly sourceContentIdentities: readonly Readonly<{
			readonly sourceId: string;
			readonly contentSha256: string;
		}>[];
	};
	readonly 'audio-freeze/remove': {
		readonly trackId: string;
		readonly expectedFreeze: AudioTrackFreezeV1;
	};
	readonly 'audio-freeze/commit': {
		readonly trackId: string;
		readonly expectedFreeze: AudioTrackFreezeV1;
		readonly operationDigests: AudioTrackFreezeDigestsV1;
		readonly derivedSourceContentSha256: string;
		readonly derivedClip: Readonly<Record<string, unknown>>;
	};
}

export type AudioProductionCommandHandlers = DomainCommandHandlerRegistry<
	typeof AUDIO_PRODUCTION_COMMAND_TYPES
>;

export function defineAudioProductionCommandHandlers(
	handlers: AudioProductionCommandHandlers,
): Readonly<AudioProductionCommandHandlers> {
	return defineDomainCommandHandlerRegistry(
		'audio production',
		AUDIO_PRODUCTION_COMMAND_TYPES,
		handlers,
	);
}

/** Exact complete-value handlers shared by the V21 product command owner. */
export function createAudioProductionRuntimeHandlers(): Readonly<AudioProductionCommandHandlers> {
	return defineAudioProductionCommandHandlers({
		'automation-lane/set': (projectValue, command) => {
			const project = dataRecord(projectValue, 'automation project');
			const laneId = stableId(command.laneId, 'automation lane command.laneId');
			const lanes = laneArray(project.automationLanes);
			const index = lanes.findIndex((lane) => lane.id === laneId);
			const current = index < 0 ? null : lanes[index]!;
			const expected = command.expected === null
				? null
				: normalizeAutomationLaneV21(command.expected);
			if (!equivalent(current, expected)) {
				throw new RangeError(`Automation lane ${laneId} has stale expected state.`);
			}
			const replacement = command.lane === null
				? null
				: normalizeAutomationLaneV21(command.lane);
			if (expected?.id !== undefined && expected.id !== laneId) {
				throw new RangeError('Automation expected lane ID must match command.laneId.');
			}
			if (replacement?.id !== undefined && replacement.id !== laneId) {
				throw new RangeError('Automation replacement lane ID must match command.laneId.');
			}
			const next = [...lanes];
			if (replacement === null && index >= 0) next.splice(index, 1);
			else if (replacement !== null && index >= 0) next[index] = replacement;
			else if (replacement !== null) next.push(replacement);
			assertAutomationLaneIdentitiesUniqueV21(next);
			project.automationLanes = Object.freeze(next);
		},
		'mixer-graph/set': (projectValue, command) => {
			const project = dataRecord(projectValue, 'mixer project');
			const current = normalizeMixerGraphV21(project.mixer);
			const expected = normalizeMixerGraphV21(command.expected);
			if (!equivalent(current, expected)) {
				throw new RangeError('Mixer graph has stale expected state.');
			}
			project.mixer = normalizeMixerGraphV21(command.mixer);
		},
		'audio-freeze/install': (projectValue, command) => {
			const project = dataRecord(projectValue, 'audio freeze project');
			replaceProjectState(project, installAudioTrackFreezeCandidateV21(project, {
				trackId: command.trackId,
				expectedFreeze: command.expectedFreeze,
				replacementFreeze: command.replacementFreeze,
				derivedSource: command.derivedSource,
				sourceContentIdentities: command.sourceContentIdentities,
			}));
		},
		'audio-freeze/remove': (projectValue, command) => {
			const project = dataRecord(projectValue, 'audio freeze project');
			replaceProjectState(project, removeAudioTrackFreezeCandidateV21(project, {
				trackId: command.trackId,
				expectedFreeze: command.expectedFreeze,
			}));
		},
		'audio-freeze/commit': (projectValue, command) => {
			const project = dataRecord(projectValue, 'audio freeze project');
			replaceProjectState(project, commitAudioTrackFreezeCandidateV21(project, {
				trackId: command.trackId,
				expectedFreeze: command.expectedFreeze,
				operationDigests: command.operationDigests,
				derivedSourceContentSha256: command.derivedSourceContentSha256,
				derivedClip: command.derivedClip,
			}));
		},
	});
}

function replaceProjectState(
	target: Record<string, unknown>,
	candidate: Readonly<Record<string, unknown>>,
): void {
	for (const key of Object.keys(target)) if (!Object.hasOwn(candidate, key)) delete target[key];
	for (const [key, value] of Object.entries(candidate)) target[key] = value;
}

function laneArray(value: unknown): AutomationLaneV21[] {
	if (!Array.isArray(value)) throw new TypeError('project.automationLanes must be an array.');
	return value.map((lane) => normalizeAutomationLaneV21(lane));
}

function equivalent(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} is required.`);
	return value;
}

function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

export type { MixerGraphV21 };
