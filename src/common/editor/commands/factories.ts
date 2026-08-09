/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioClipV2,
	createAudioSourceV2,
	createAudioTrackV2,
	createLabelTrackV2,
	createLabelV2,
} from '../project-v2.js';
import {
	createAudioTrackV4,
	createLabelTrackV4,
	createMediaClipV4,
	createMediaSourceV4,
	createMediaTrackV4,
} from '../project-v4.js';
import {
	createMediaClipV5,
	createMediaSourceV5,
	createMediaTrackV5,
} from '../project-v5.js';
import { createVideoEffect } from '../video-effects.js';
import { createMediaClipV8 } from '../project-v8.ts';
import type { AudioEditorCommand, AudioEditorCommandType, CommandObject } from './protocol.ts';

type CommandFor<Type extends AudioEditorCommandType> = Extract<AudioEditorCommand, { readonly type: Type }>;

export interface CommandFactoryValue extends Record<string, unknown> {
	readonly schemaVersion?: number;
	readonly kind?: string;
	readonly type?: string;
	readonly laneGroupId?: unknown;
	readonly videoEffects?: readonly unknown[];
}

export interface VideoEffectFactoryOptions extends CommandFactoryValue {
	readonly id?: string;
	readonly enabled?: boolean;
	readonly params?: Readonly<Record<string, number>>;
	readonly index?: number;
}

export function createAddSourceCommand(options: CommandFactoryValue): CommandFor<'source/add'> {
	return { type: 'source/add', source: normalizeSourceValue(options) };
}

export function createAddTrackCommand(options: CommandFactoryValue = {}): CommandFor<'track/add'> {
	return { type: 'track/add', track: normalizeTrackValue(options) };
}

export function createAddClipCommand(trackId: string, options: CommandFactoryValue): CommandFor<'clip/add'> {
	return { type: 'clip/add', trackId, clip: normalizeClipValue(options) };
}

export function createReplaceClipSourceCommand(clipId: string, sourceId: string): CommandFor<'clip/replace-source'> {
	return {
		type: 'clip/replace-source',
		clipId: requireStableCommandId(clipId, 'clip'),
		sourceId: requireStableCommandId(sourceId, 'source'),
	};
}

export function createAddVideoEffectCommand(
	clipId: string,
	effectType: string,
	options: VideoEffectFactoryOptions = {},
): CommandFor<'video-effect/add'> {
	return {
		type: 'video-effect/add',
		clipId: requireStableCommandId(clipId, 'video clip'),
		effect: createVideoEffect(effectType, options) as CommandObject,
		...(options.index == null ? {} : { index: options.index }),
	};
}

export function createUpdateVideoEffectCommand(
	clipId: string,
	effectId: string,
	changes: CommandObject = {},
): CommandFor<'video-effect/update'> {
	return {
		type: 'video-effect/update',
		clipId: requireStableCommandId(clipId, 'video clip'),
		effectId: requireStableCommandId(effectId, 'video effect'),
		changes: { ...changes },
	};
}

export function createBypassVideoEffectCommand(
	clipId: string,
	effectId: string,
	bypassed = true,
): CommandFor<'video-effect/update'> {
	if (typeof bypassed !== 'boolean') throw new TypeError('Video effect bypass state must be boolean.');
	return createUpdateVideoEffectCommand(clipId, effectId, { enabled: !bypassed });
}

export function createReorderVideoEffectCommand(
	clipId: string,
	effectId: string,
	toIndex: number,
): CommandFor<'video-effect/reorder'> {
	if (!Number.isSafeInteger(toIndex) || toIndex < 0) {
		throw new RangeError('Video effect destination must be a non-negative safe integer.');
	}
	return {
		type: 'video-effect/reorder',
		clipId: requireStableCommandId(clipId, 'video clip'),
		effectId: requireStableCommandId(effectId, 'video effect'),
		toIndex,
	};
}

export function createRemoveVideoEffectCommand(
	clipId: string,
	effectId: string,
): CommandFor<'video-effect/remove'> {
	return {
		type: 'video-effect/remove',
		clipId: requireStableCommandId(clipId, 'video clip'),
		effectId: requireStableCommandId(effectId, 'video effect'),
	};
}

export function createAddLabelTrackCommand(options: CommandFactoryValue = {}): CommandFor<'track/add'> {
	return { type: 'track/add', track: createLabelTrackV2(options) as CommandObject };
}

export function createAddLabelCommand(
	trackId: string,
	options: CommandFactoryValue = {},
): CommandFor<'label/add'> {
	return { type: 'label/add', trackId, label: createLabelV2(options) as CommandObject };
}

function normalizeSourceValue(value: CommandFactoryValue): CommandObject {
	if (value.sampleFrameCount != null || value.timingDecision != null) return structuredClone(value) as CommandObject;
	if ((value.schemaVersion ?? 0) >= 5) return createMediaSourceV5(value) as CommandObject;
	return value.kind ? createMediaSourceV4(value) as CommandObject : createAudioSourceV2(value) as CommandObject;
}

function normalizeTrackValue(value: CommandFactoryValue): CommandObject {
	if ((value.schemaVersion ?? 0) >= 10) return structuredClone(value) as CommandObject;
	if ((value.schemaVersion ?? 0) >= 5) return createMediaTrackV5(value) as CommandObject;
	if (value.type === 'video') return createMediaTrackV4(value) as CommandObject;
	if ((value.schemaVersion ?? 0) >= 4 && value.type === 'label') return createLabelTrackV4(value) as CommandObject;
	if (value.type === 'label') return createLabelTrackV2(value) as CommandObject;
	if ((value.schemaVersion ?? 0) >= 4 || value.laneGroupId) return createAudioTrackV4(value) as CommandObject;
	return createAudioTrackV2(value) as CommandObject;
}

function normalizeClipValue(value: CommandFactoryValue): CommandObject {
	if (value.anchor != null || value.sequenceStartFrame != null) return structuredClone(value) as CommandObject;
	if ((value.schemaVersion ?? 0) >= 8) return createMediaClipV8(value) as CommandObject;
	if (Array.isArray(value.videoEffects) || (value.schemaVersion ?? 0) >= 5) {
		return createMediaClipV5(value) as CommandObject;
	}
	return value.kind ? createMediaClipV4(value) as CommandObject : createAudioClipV2(value) as CommandObject;
}

function requireStableCommandId(value: string, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} ID must be a non-empty string.`);
	return value;
}
