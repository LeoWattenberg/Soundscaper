/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import { clipboardRequiresTimelineAnnotationCapability } from '../commands/clipboard-codec.ts';

export interface EditorCommandCapabilities {
	readonly audioEffects: boolean;
	readonly audioRecording: boolean;
	readonly audioSpectralEditing: boolean;
	readonly timelineAnnotations: boolean;
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
	if (!capabilities.timelineAnnotations && command.type === 'selection/set'
		&& Object.hasOwn(command, 'annotationIds')) {
		unsupported(productName, 'timelineAnnotations');
	}
	if (!capabilities.timelineAnnotations && command.type === 'clipboard/paste'
		&& clipboardRequiresTimelineAnnotationCapability(command.clipboard)) {
		unsupported(productName, 'timelineAnnotations');
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
