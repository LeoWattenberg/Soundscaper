/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from '../closed-domain-value.ts';
import {
	AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
	admitAudioEditorProjectV9ValidationStructure,
} from '../project-v9-validation-budget.ts';
import {
	VIDEO_KEYFRAME_CURVES_SCHEMA_VERSION,
} from '../video-keyframe-curves.ts';
import type { VideoKeyframeCommandWire } from './video-keyframes-command-payload.d.ts';
import {
	defineDomainCommandHandlerRegistry,
	type DomainCommandHandlerRegistry,
} from './domain-registry.ts';
import type { AudioEditorCommand, AudioEditorCommandType } from './protocol.ts';

export const VIDEO_KEYFRAMES_COMMAND_TYPES = [
	'video-keyframes/set',
] as const satisfies readonly AudioEditorCommandType[];

export type VideoKeyframesCommandType = typeof VIDEO_KEYFRAMES_COMMAND_TYPES[number];
export type VideoKeyframesSetCommand = Extract<
	AudioEditorCommand,
	{ readonly type: 'video-keyframes/set' }
>;
export type VideoKeyframesCommandHandlers = DomainCommandHandlerRegistry<
	typeof VIDEO_KEYFRAMES_COMMAND_TYPES
>;

const COMMAND_FIELDS = Object.freeze([
	'type', 'clipId', 'expectedKeyframes', 'keyframes',
]);
const KEYFRAME_FIELDS = Object.freeze(['schemaVersion', 'timeDomain', 'curves']);

export function defineVideoKeyframesCommandHandlers(
	handlers: VideoKeyframesCommandHandlers,
): Readonly<VideoKeyframesCommandHandlers> {
	return defineDomainCommandHandlerRegistry(
		'video keyframes',
		VIDEO_KEYFRAMES_COMMAND_TYPES,
		handlers,
	);
}

/**
 * Snapshot the context-free command envelope without invoking accessors. The
 * clip-aware runtime owns semantic target and duration validation.
 */
export function snapshotVideoKeyframesSetCommand(value: unknown): VideoKeyframesSetCommand {
	const command = readClosedDomainRecord(value, 'video keyframes command', COMMAND_FIELDS);
	if (field(command, 'type') !== 'video-keyframes/set') {
		throw new RangeError('video keyframes command.type must be video-keyframes/set.');
	}
	const clipId = field(command, 'clipId');
	if (typeof clipId !== 'string' || clipId.length === 0 || clipId !== clipId.trim()) {
		throw new TypeError('video keyframes command.clipId must be a canonical non-empty string.');
	}
	return Object.freeze({
		type: 'video-keyframes/set',
		clipId,
		expectedKeyframes: snapshotWire(field(command, 'expectedKeyframes'), 'expectedKeyframes'),
		keyframes: snapshotWire(field(command, 'keyframes'), 'keyframes'),
	});
}

function snapshotWire(value: unknown, name: string): VideoKeyframeCommandWire {
	const wire = readClosedDomainRecord(value, `video keyframes command.${name}`, KEYFRAME_FIELDS);
	admitAudioEditorProjectV9ValidationStructure(
		wire, AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
	);
	if (readClosedDomainField(wire, 'schemaVersion', `video keyframes command.${name}`)
		!== VIDEO_KEYFRAME_CURVES_SCHEMA_VERSION) {
		throw new RangeError(`video keyframes command.${name}.schemaVersion must be 1.`);
	}
	assertExactJsonWire(wire);
	return deepFreeze(structuredClone(wire)) as unknown as VideoKeyframeCommandWire;
}

/** Reject binary and negative zero before structuredClone can allocate or alter JSON meaning. */
function assertExactJsonWire(value: object): void {
	const pending: unknown[] = [value];
	while (pending.length > 0) {
		const candidate = pending.pop();
		if (typeof candidate === 'number') {
			if (Object.is(candidate, -0)) {
				throw new RangeError('video keyframes commands must not contain negative zero.');
			}
			continue;
		}
		if (!candidate || typeof candidate !== 'object') continue;
		if (candidate instanceof ArrayBuffer || ArrayBuffer.isView(candidate)) {
			throw new TypeError('video keyframes commands must contain only JSON-safe values.');
		}
		for (const key of Reflect.ownKeys(candidate)) {
			if (key === 'length' && Array.isArray(candidate)) continue;
			const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
			if (descriptor && Object.hasOwn(descriptor, 'value')) pending.push(descriptor.value);
		}
	}
}

function deepFreeze(value: ClosedDomainRecord): ClosedDomainRecord {
	const pending: object[] = [value];
	while (pending.length > 0) {
		const candidate = pending.pop();
		if (!candidate || Object.isFrozen(candidate)) continue;
		for (const key of Reflect.ownKeys(candidate)) {
			const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
			if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
			if (descriptor.value && typeof descriptor.value === 'object') pending.push(descriptor.value);
		}
		Object.freeze(candidate);
	}
	return value;
}

function field(record: ClosedDomainRecord, key: string): unknown {
	return readClosedDomainField(record, key, 'video keyframes command');
}
