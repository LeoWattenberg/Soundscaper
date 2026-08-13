/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import {
	AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION,
	clipboardRequiresTimelineAnnotationCapability,
} from '../commands/clipboard-codec.ts';

export interface EditorCommandCapabilities {
	readonly audioEffects: boolean;
	readonly audioRecording: boolean;
	readonly audioSpectralEditing: boolean;
	readonly audioWarp: boolean;
	readonly takeComp: boolean;
	readonly timelineAnnotations: boolean;
	readonly trackFolders: boolean;
	readonly videoEffects: boolean;
}

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
	if (command.type === 'batch') {
		for (const child of command.commands) {
			assertEditorCommandCapabilities(child, capabilities, productName);
		}
		return;
	}

	if (!capabilities.videoEffects && command.type.startsWith('video-effect/')) {
		unsupported(productName, 'videoEffects');
	}
	if (!capabilities.timelineAnnotations && command.type.startsWith('timeline-annotation/')) {
		unsupported(productName, 'timelineAnnotations');
	}
	if (!capabilities.trackFolders
		&& (command.type.startsWith('track-folder/') || command.type.startsWith('track-node/'))) {
		unsupported(productName, 'trackFolders');
	}
	if (!capabilities.trackFolders && command.type === 'track/add'
		&& (Object.hasOwn(command, 'sequenceId') || Object.hasOwn(command, 'parentFolderId')
			|| Object.hasOwn(command, 'parentIndex'))) {
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
	if (!capabilities.audioWarp && command.type.startsWith('audio-warp/')) {
		unsupported(productName, 'audioWarp');
	}
	if (!capabilities.takeComp && command.type === 'clipboard/paste'
		&& clipboardRequiresTakeCompCapability(command.clipboard)) {
		unsupported(productName, 'takeComp');
	}
	if (!capabilities.audioEffects && command.type.startsWith('effect/')) {
		unsupported(productName, 'audioEffects');
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

/** Fail closed when a V4 paste contains, or disguises, take group content. */
function clipboardRequiresTakeCompCapability(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const schema = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	if (!schema?.enumerable || !Object.hasOwn(schema, 'value')) return Object.hasOwn(value, 'takeGroups');
	if (schema.value !== AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION) return false;
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
