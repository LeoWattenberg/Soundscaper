/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import {
	AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION,
	clipboardRequiresTimelineAnnotationCapability,
} from '../commands/clipboard-codec.ts';
import { snapshotInertEditorCommand } from '../commands/editor-command-snapshot.ts';

export interface EditorCommandCapabilities {
	readonly audioEffects: boolean;
	readonly audioAutomation?: boolean;
	readonly audioMixerGraph?: boolean;
	readonly audioTrackFreeze?: boolean;
	readonly masteringSequences?: boolean;
	readonly audioRecording: boolean;
	readonly audioSpectralEditing: boolean;
	readonly audioWarp: boolean;
	readonly nestedSequences?: boolean;
	readonly takeComp: boolean;
	readonly timelineAnnotations: boolean;
	readonly trackFolders: boolean;
	readonly videoEffects: boolean;
	readonly videoGeometry?: boolean;
	readonly videoKeyframes?: boolean;
}

interface CapabilityInspectionBudget { remaining: number }
const MAXIMUM_CAPABILITY_INSPECTION_NODES = 100_000;

/**
 * Guards the low-level command entry point as well as the grouped action
 * facade. This matters for callers (including coding agents and tests) that
 * construct protocol commands directly instead of invoking a feature action.
 */
export function assertEditorCommandCapabilities(
	command: AudioEditorCommand | null | undefined,
	capabilities: EditorCommandCapabilities,
	productName: string,
): void {
	if (!command) return;
	assertCommandCapabilities(snapshotInertEditorCommand(command), capabilities, productName, new Set());
}

function assertCommandCapabilities(
	command: AudioEditorCommand,
	capabilities: EditorCommandCapabilities,
	productName: string,
	seen: Set<object>,
): void {
	if (seen.has(command)) return;
	seen.add(command);
	if (command.type === 'batch') {
		for (const child of command.commands) {
			assertCommandCapabilities(child, capabilities, productName, seen);
		}
		return;
	}

	if (!capabilities.videoEffects && command.type.startsWith('video-effect/')) {
		unsupported(productName, 'videoEffects');
	}
	if (!capabilities.videoGeometry && command.type.startsWith('video-composition/')) {
		unsupported(productName, 'videoGeometry');
	}
	if (!capabilities.videoKeyframes && command.type.startsWith('video-keyframes/')) {
		unsupported(productName, 'videoKeyframes');
	}
	if (!capabilities.videoKeyframes && commandRequiresVideoKeyframesCapability(command)) {
		unsupported(productName, 'videoKeyframes');
	}
	if (!capabilities.videoGeometry && commandRequiresVideoGeometryCapability(command)) {
		unsupported(productName, 'videoGeometry');
	}
	if (!capabilities.timelineAnnotations && command.type.startsWith('timeline-annotation/')) {
		unsupported(productName, 'timelineAnnotations');
	}
	if (!capabilities.trackFolders
		&& (command.type.startsWith('track-folder/') || command.type.startsWith('track-node/'))) {
		unsupported(productName, 'trackFolders');
	}
	if (!capabilities.nestedSequences && command.type === 'track/add'
		&& Object.hasOwn(command, 'sequenceId')) {
		unsupported(productName, 'nestedSequences');
	}
	if (!capabilities.trackFolders && command.type === 'track/add'
		&& (Object.hasOwn(command, 'parentFolderId') || Object.hasOwn(command, 'parentIndex'))) {
		unsupported(productName, 'trackFolders');
	}
	if (!capabilities.timelineAnnotations && command.type === 'selection/set'
		&& Object.hasOwn(command, 'annotationIds')) {
		unsupported(productName, 'timelineAnnotations');
	}
	if (!capabilities.timelineAnnotations && command.type === 'clipboard/paste'
		&& clipboardRequiresTimelineAnnotationCapability(command.clipboard)) {
		unsupported(productName, 'timelineAnnotations');
	}
	if (!capabilities.takeComp && command.type.startsWith('take-comp/')) {
		unsupported(productName, 'takeComp');
	}
	if (!capabilities.audioWarp && commandRequiresAudioWarpCapability(command)) {
		unsupported(productName, 'audioWarp');
	}
	if (!capabilities.takeComp && command.type === 'clipboard/paste'
		&& clipboardRequiresTakeCompCapability(command.clipboard)) {
		unsupported(productName, 'takeComp');
	}
	if (!capabilities.audioEffects && command.type.startsWith('effect/')) {
		unsupported(productName, 'audioEffects');
	}
	if (!capabilities.audioAutomation && command.type.startsWith('automation-lane/')) {
		unsupported(productName, 'audioAutomation');
	}
	if (!capabilities.audioMixerGraph && command.type.startsWith('mixer-graph/')) {
		unsupported(productName, 'audioMixerGraph');
	}
	if (!capabilities.audioTrackFreeze && command.type.startsWith('audio-freeze/')) {
		unsupported(productName, 'audioTrackFreeze');
	}
	if (!capabilities.masteringSequences && command.type.startsWith('mastering-sequence/')) {
		unsupported(productName, 'masteringSequences');
	}
	if (!capabilities.videoEffects && command.type === 'clip/update'
		&& hasOwn(command.changes, 'videoEffects')) {
		unsupported(productName, 'videoEffects');
	}
	if (!capabilities.videoEffects && command.type === 'clip/add'
		&& hasItems(command.clip, 'videoEffects')) {
		unsupported(productName, 'videoEffects');
	}
	if (!capabilities.audioEffects && command.type === 'track/add'
		&& hasItems(command.track, 'effects')) {
		unsupported(productName, 'audioEffects');
	}
	if (!capabilities.audioEffects && command.type === 'track/update'
		&& hasOwn(command.changes, 'effects')) {
		unsupported(productName, 'audioEffects');
	}
	if (!capabilities.audioEffects && command.type === 'clip/update'
		&& ['pitchCents', 'speedRatio', 'preserveFormants', 'stretchToTempo', 'reversed']
			.some((key) => hasOwn(command.changes, key))) {
		unsupported(productName, 'audioEffects');
	}
	if (!capabilities.audioEffects && command.type === 'track/update'
		&& ['sampleRate', 'sampleFormat'].some((key) => hasOwn(command.changes, key))) {
		unsupported(productName, 'audioEffects');
	}
	if (!capabilities.audioEffects && command.type === 'master/update'
		&& hasOwn(command.changes, 'effects')) {
		unsupported(productName, 'audioEffects');
	}
	if (!capabilities.audioEffects && command.type === 'mixer/bus-add'
		&& hasItems(command.bus, 'effects')) {
		unsupported(productName, 'audioEffects');
	}
	if (!capabilities.audioEffects && command.type === 'mixer/bus-update'
		&& hasOwn(command.changes, 'effects')) {
		unsupported(productName, 'audioEffects');
	}
	if (!capabilities.audioSpectralEditing && command.type === 'track/update'
		&& ['displayMode', 'spectrogram'].some((key) => hasOwn(command.changes, key))) {
		unsupported(productName, 'audioSpectralEditing');
	}
	if (!capabilities.audioRecording && command.type === 'track/update'
		&& hasOwn(command.changes, 'armed')) {
		unsupported(productName, 'audioRecording');
	}
}

/** Cover generic carriers so an unavailable product cannot smuggle V19 geometry state. */
function commandRequiresVideoGeometryCapability(command: AudioEditorCommand): boolean {
	switch (command.type) {
		case 'clip/add':
		case 'project-bin/add':
			return nestedPayloadHasField(command, 'clip', 'videoComposition');
		case 'clip/update':
		case 'project-bin/update':
		case 'clip/overwrite':
			return nestedPayloadHasField(command, 'changes', 'videoComposition');
		case 'clip/transform-many':
			return transformListHasField(command, 'videoComposition');
		case 'project-bin/replace-media':
			return optionalArrayPayloadHasField(command, 'templates', 'videoComposition');
		case 'take-comp/flatten':
			return nestedPayloadHasField(command, 'clip', 'videoComposition');
		case 'clipboard/paste':
			return clipboardRequiresVideoGeometryCapability(command.clipboard);
		default:
			return false;
	}
}

/** Cover generic carriers so unavailable products cannot publish V20 state. */
function commandRequiresVideoKeyframesCapability(command: AudioEditorCommand): boolean {
	switch (command.type) {
		case 'clip/add':
		case 'project-bin/add':
			return nestedPayloadHasField(command, 'clip', 'videoKeyframes');
		case 'clip/update':
		case 'project-bin/update':
		case 'clip/overwrite':
			return nestedPayloadHasField(command, 'changes', 'videoKeyframes');
		case 'clip/transform-many':
			return transformListHasField(command, 'videoKeyframes');
		case 'project-bin/replace-media':
			return optionalArrayPayloadHasField(command, 'templates', 'videoKeyframes');
		case 'take-comp/flatten':
			return nestedPayloadHasField(command, 'clip', 'videoKeyframes');
		case 'clipboard/paste':
			return clipboardClipHasField(command.clipboard, 'videoKeyframes');
		default:
			return false;
	}
}

function nestedPayloadHasField(value: unknown, payloadKey: string, field: string): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const payload = Object.getOwnPropertyDescriptor(value, payloadKey);
	if (!payload) return false;
	if (!payload.enumerable || !Object.hasOwn(payload, 'value')) return true;
	return hasPossiblyDisguisedOwnField(payload.value, field);
}

function transformListHasField(value: unknown, field: string): boolean {
	const transformsValue = ownEnumerableDataValue(value, 'transforms');
	if (transformsValue === INVALID_DATA_VALUE) return true;
	const transforms = denseArrayDataValues(transformsValue, 100_000);
	if (!transforms) return true;
	return transforms.some((transform) => nestedPayloadHasField(transform, 'changes', field));
}

function optionalArrayPayloadHasField(value: unknown, key: string, field: string): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return false;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return true;
	const items = denseArrayDataValues(descriptor.value, 100_000);
	return !items || items.some((item) => hasPossiblyDisguisedOwnField(item, field));
}

function hasPossiblyDisguisedOwnField(value: unknown, field: string): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	return descriptor !== undefined;
}

/** Inspect V1..V4 clip payloads without evaluating a disguised composition accessor. */
function clipboardRequiresVideoGeometryCapability(value: unknown): boolean {
	return clipboardClipHasField(value, 'videoComposition');
}

function clipboardClipHasField(value: unknown, field: string): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const schemaVersion = ownEnumerableDataValue(value, 'schemaVersion');
	if (schemaVersion === INVALID_DATA_VALUE) return Object.hasOwn(value, 'tracks');
	if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4 && schemaVersion !== 5
		&& schemaVersion !== AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION) return false;
	const tracksValue = ownEnumerableDataValue(value, 'tracks');
	if (tracksValue === INVALID_DATA_VALUE) return true;
	const budget: CapabilityInspectionBudget = { remaining: MAXIMUM_CAPABILITY_INSPECTION_NODES };
	const tracks = denseArrayDataValues(tracksValue, MAXIMUM_CAPABILITY_INSPECTION_NODES, budget);
	if (!tracks) return true;
	for (const track of tracks) {
		const clipsValue = ownEnumerableDataValue(track, 'clips');
		if (clipsValue === INVALID_DATA_VALUE) return true;
		const clips = denseArrayDataValues(clipsValue, MAXIMUM_CAPABILITY_INSPECTION_NODES, budget);
		if (!clips) return true;
		if (clips.some((clip) => hasPossiblyDisguisedOwnField(clip, field))) return true;
	}
	return false;
}

/** Cover every generic command carrier that can publish authored audio-warp state. */
function commandRequiresAudioWarpCapability(command: AudioEditorCommand): boolean {
	if (command.type.startsWith('audio-warp/')) return true;
	switch (command.type) {
		case 'clip/add':
		case 'project-bin/add':
			return hasAuthoredWarpMap(command.clip);
		case 'clip/overwrite':
			return hasWarpMapMutation(command.changes);
		case 'clipboard/paste':
			return clipboardRequiresAudioWarpCapability(command.clipboard);
		case 'take-comp/flatten':
			return hasAuthoredWarpMap(command.clip);
		default:
			return false;
	}
}

function hasAuthoredWarpMap(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'warpMap');
	if (!descriptor) return false;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return true;
	return descriptor.value != null;
}

function hasWarpMapMutation(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return Object.getOwnPropertyDescriptor(value, 'warpMap') !== undefined;
}

/** Inspect V1..V6 clip payloads through descriptors so accessors cannot disguise a map. */
function clipboardRequiresAudioWarpCapability(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const schemaVersion = ownEnumerableDataValue(value, 'schemaVersion');
	if (schemaVersion === INVALID_DATA_VALUE) return Object.hasOwn(value, 'tracks');
	if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4 && schemaVersion !== 5
		&& schemaVersion !== AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION) return false;
	const tracksValue = ownEnumerableDataValue(value, 'tracks');
	if (tracksValue === INVALID_DATA_VALUE) return true;
	const budget: CapabilityInspectionBudget = { remaining: MAXIMUM_CAPABILITY_INSPECTION_NODES };
	const tracks = denseArrayDataValues(tracksValue, MAXIMUM_CAPABILITY_INSPECTION_NODES, budget);
	if (!tracks) return true;
	for (const track of tracks) {
		const clipsValue = ownEnumerableDataValue(track, 'clips');
		if (clipsValue === INVALID_DATA_VALUE) return true;
		const clips = denseArrayDataValues(clipsValue, MAXIMUM_CAPABILITY_INSPECTION_NODES, budget);
		if (!clips) return true;
		if (clips.some(hasAuthoredWarpMap)) return true;
	}
	return false;
}

const INVALID_DATA_VALUE = Symbol('invalid command data value');

function ownEnumerableDataValue(value: unknown, key: string): unknown | typeof INVALID_DATA_VALUE {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return INVALID_DATA_VALUE;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return INVALID_DATA_VALUE;
	return descriptor.value;
}

function denseArrayDataValues(
	value: unknown,
	maximumLength: number,
	budget?: CapabilityInspectionBudget,
): readonly unknown[] | null {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	if (!lengthDescriptor || lengthDescriptor.enumerable || !Object.hasOwn(lengthDescriptor, 'value')
		|| !Number.isSafeInteger(lengthDescriptor.value)
		|| Number(lengthDescriptor.value) < 0 || Number(lengthDescriptor.value) > maximumLength) return null;
	const length = Number(lengthDescriptor.value);
	if (budget && length > budget.remaining) return null;
	if (budget) budget.remaining -= length;
	const values: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
		values.push(descriptor.value);
	}
	return values;
}

/** Fail closed when a V4..V6 paste contains, or disguises, take group content. */
function clipboardRequiresTakeCompCapability(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const schema = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	if (!schema?.enumerable || !Object.hasOwn(schema, 'value')) return Object.hasOwn(value, 'takeGroups');
	if (schema.value !== 4 && schema.value !== 5
		&& schema.value !== AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION) return false;
	const takeGroups = Object.getOwnPropertyDescriptor(value, 'takeGroups');
	if (!takeGroups?.enumerable || !Object.hasOwn(takeGroups, 'value')) return true;
	return !Array.isArray(takeGroups.value) || takeGroups.value.length > 0;
}

function hasOwn(value: CommandObject, key: string): boolean {
	return Object.hasOwn(value, key);
}

function hasItems(value: CommandObject, key: string): boolean {
	const candidate = value[key];
	return Array.isArray(candidate) && candidate.length > 0;
}

function unsupported(productName: string, capability: keyof EditorCommandCapabilities): never {
	throw new RangeError(`${productName} does not support ${capability}.`);
}
