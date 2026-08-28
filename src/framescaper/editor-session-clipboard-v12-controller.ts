/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { assertOfxEffectStateV26, type OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import { framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia } from './editor-project-professional-media-foundation.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import type { FramescaperProjectCommandNativeMedia } from './editor-project-native-media-commands.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { validateFramescaperProjectNativeMedia } from './editor-project-native-media.ts';
import { prepareFramescaperSessionClipboardPasteCommandV11 } from './editor-session-clipboard-v11-controller.ts';
import {
	framescaperSessionClipboardV11FoundationV12,
	normalizeFramescaperSessionClipboardV12,
} from './editor-session-clipboard-v12.ts';

type DataRecord = Record<string, unknown>;
type IdFactory = (prefix?: string) => string;

/** Prepare one atomic nativeMedia paste, retaining professional rows and selected OFX instances. */
export function prepareFramescaperSessionClipboardPasteCommandV12(
	profile: unknown,
	projectValue: unknown,
	clipboardValue: unknown,
	baseCommand: AudioEditorCommand,
	createId: IdFactory,
): FramescaperProjectCommandNativeMedia {
	validateFramescaperProjectNativeMedia(profile, projectValue);
	if (typeof createId !== 'function') throw new TypeError('V12 paste requires an ID factory.');
	const clipboard = normalizeFramescaperSessionClipboardV12(clipboardValue);
	const fullSources = sourceAdds(baseCommand);
	const foundationCommand = prepareFramescaperSessionClipboardPasteCommandV11(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		framescaperProjectFinishingFoundationShapeNativeMedia(projectValue),
		framescaperSessionClipboardV11FoundationV12(clipboard),
		projectFoundationCommand(baseCommand),
		createId,
	);
	const restoredFoundation = restoreProfessionalSourceAdds(foundationCommand, fullSources);
	const paste = findPaste(baseCommand);
	const clipTargets = new Map(clipboard.clipBindings.map(({ clipId, descriptorKey }) => [
		clipId,
		stableId(record(paste.clipIds, 'V12 paste clip IDs')[descriptorKey], 'pasted clip ID'),
	]));
	const sourceIds = new Set(clipboard.sources.map(({ id }) => id));
	const resolve = (id: string): string => clipTargets.get(id) ?? (sourceIds.has(id) ? id : missing(id));
	const effectCommands = clipboard.ofxEffects.map((effect) => {
		const instanceId = stableId(createId('ofx-instance'), 'fresh OFX instance ID');
		const mapped = {
			...structuredClone(effect),
			instanceId,
			attachment: { ...effect.attachment, targetId: resolve(effect.attachment.targetId) },
			inputs: effect.inputs.map((input) => ({ ...input, sourceRef: resolve(input.sourceRef) })),
			frozenFallback: effect.frozenFallback === null ? null : {
				...effect.frozenFallback,
				externalMediaSourceId: resolve(effect.frozenFallback.externalMediaSourceId),
			},
		} as OfxEffectStateV26;
		assertOfxEffectStateV26(mapped);
		return Object.freeze({
			type: 'openfx-effect/set' as const,
			instanceId,
			expectedEffect: null,
			effect: deepFreeze(mapped),
		});
	});
	return effectCommands.length === 0 ? restoredFoundation : Object.freeze({
		type: 'batch' as const,
		commands: Object.freeze([restoredFoundation, ...effectCommands]),
	});
}

function projectFoundationCommand(command: AudioEditorCommand): AudioEditorCommand {
	const project = (value: unknown): unknown => {
		const candidate = structuredClone(record(value, 'V12 foundation command'));
		if (candidate.type === 'batch') {
			if (!Array.isArray(candidate.commands)) throw new TypeError('V12 command batch must be an array.');
			candidate.commands = candidate.commands.map(project);
		} else if (candidate.type === 'source/add') {
			const source = record(candidate.source, 'V12 source admission');
			if (source.kind === 'video') {
				delete source.imageSequence;
				source.characteristics = framescaperVideoSourceCharacteristicsVisualProjectionProfessionalMedia(source);
			}
		}
		return candidate;
	};
	return project(command) as AudioEditorCommand;
}

function sourceAdds(command: unknown): ReadonlyMap<string, DataRecord> {
	const result = new Map<string, DataRecord>();
	visitCommands(command, (candidate) => {
		if (candidate.type !== 'source/add') return;
		const source = record(candidate.source, 'V12 source add');
		result.set(stableId(source.id, 'V12 source add ID'), structuredClone(source));
	});
	return result;
}

function restoreProfessionalSourceAdds(
	command: FramescaperProjectCommandNativeMedia,
	sources: ReadonlyMap<string, DataRecord>,
): FramescaperProjectCommandNativeMedia {
	const restore = (value: unknown): unknown => {
		const candidate = structuredClone(record(value, 'V12 prepared command'));
		if (candidate.type === 'batch') {
			if (!Array.isArray(candidate.commands)) throw new TypeError('V12 prepared batch must be an array.');
			candidate.commands = candidate.commands.map(restore);
		} else if (candidate.type === 'source/add') {
			const source = record(candidate.source, 'V12 prepared source');
			const full = sources.get(stableId(source.id, 'V12 prepared source ID'));
			if (full) candidate.source = structuredClone(full);
		}
		return candidate;
	};
	return restore(command) as FramescaperProjectCommandNativeMedia;
}

function findPaste(command: unknown): DataRecord {
	const matches: DataRecord[] = [];
	visitCommands(command, (candidate) => { if (candidate.type === 'clipboard/paste') matches.push(candidate); });
	if (matches.length !== 1) throw new RangeError('V12 paste requires exactly one clipboard/paste command.');
	return matches[0]!;
}

function visitCommands(value: unknown, visit: (command: DataRecord) => void): void {
	const command = record(value, 'V12 command');
	visit(command);
	if (command.type !== 'batch') return;
	if (!Array.isArray(command.commands)) throw new TypeError('V12 command batch must be an array.');
	for (const child of command.commands) visitCommands(child, visit);
}

function missing(id: string): never { throw new ReferenceError(`V12 paste cannot resolve OFX reference ${id}.`); }

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
