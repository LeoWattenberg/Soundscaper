/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import {
	normalizeAudioEditorClipboardDescriptor,
} from '../common/editor/commands/clipboard-codec.ts';
import {
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
} from '../common/editor/project-validation-budget.ts';

type DataRecord = Record<string, unknown>;

const BATCH_FIELDS = Object.freeze(['type', 'commands']);
const MAXIMUM_BATCH_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;

/** Identify the exact new video occurrences that retime may initialize with neutral keyframes. */
export function framescaperRetimeExplicitFreshVideoIds(command: unknown): ReadonlySet<string> {
	const result = new Set<string>();
	const pending: unknown[] = [command];
	while (pending.length > 0) {
		const candidate = pending.pop();
		const type = commandType(candidate);
		if (type === 'batch') {
			const batch = readClosedDomainRecord(candidate, 'Framescaper retime command batch', BATCH_FIELDS);
			pending.push(...readClosedDomainArray(
				readClosedDomainField(batch, 'commands', 'Framescaper retime command batch'),
				'Framescaper retime command batch.commands', 1, MAXIMUM_BATCH_COMMANDS,
			));
			continue;
		}
		if (type === 'clipboard/paste') {
			collectClipboardVideoIds(candidate, result);
			continue;
		}
		if (type === 'edit/insert' || type === 'edit/overwrite') {
			collectThreePointVideoIds(candidate, result, type);
			continue;
		}
		if (type !== 'clip/add' && type !== 'project-bin/add') continue;
		const record = dataRecord(candidate, `Framescaper retime ${type} command`);
		const clip = dataRecord(
			dataProperty(record, 'clip', `Framescaper retime ${type} command`),
			`${type} clip`,
		);
		if (dataProperty(clip, 'kind', `${type} clip`) === 'video') {
			result.add(stableId(dataProperty(clip, 'id', `${type} clip`), `${type} clip.id`));
		}
	}
	return result;
}

function collectThreePointVideoIds(
	command: unknown,
	result: Set<string>,
	type: 'edit/insert' | 'edit/overwrite',
): void {
	const record = dataRecord(command, `Framescaper retime ${type} command`);
	const placements = dataProperty(record, 'placements', `Framescaper retime ${type} command`);
	if (!Array.isArray(placements)) {
		throw new TypeError(`Framescaper retime ${type} command.placements must be an array.`);
	}
	for (let index = 0; index < placements.length; index += 1) {
		const placement = dataRecord(
			placements[index],
			`Framescaper retime ${type} command.placements[${String(index)}]`,
		);
		if (dataProperty(placement, 'kind', `Framescaper retime ${type} placement`) !== 'video') continue;
		result.add(stableId(
			dataProperty(placement, 'clipId', `Framescaper retime ${type} placement`),
			`Framescaper retime ${type} placement.clipId`,
		));
	}
}

function collectClipboardVideoIds(command: unknown, result: Set<string>): void {
	const record = dataRecord(command, 'Framescaper retime clipboard/paste command');
	const clipboard = normalizeAudioEditorClipboardDescriptor(dataProperty(
		record, 'clipboard', 'Framescaper retime clipboard/paste command',
	));
	const videoClips = clipboard.tracks.flatMap((track) => track.clips.filter((clip) => (
		dataProperty(dataRecord(clip, 'Framescaper retime clipboard clip'), 'kind', 'Framescaper retime clipboard clip')
			=== 'video'
	)));
	if (videoClips.length === 0) return;
	if (clipboard.schemaVersion !== 6) {
		throw new RangeError('Framescaper retime video clipboard content requires V6 recopy.');
	}
	const clipIds = dataRecord(
		dataProperty(record, 'clipIds', 'Framescaper retime clipboard/paste command'),
		'Framescaper retime clipboard/paste command.clipIds',
	);
	for (const clipValue of videoClips) {
		const clip = dataRecord(clipValue, 'Framescaper retime clipboard video clip');
		if (Object.hasOwn(clip, 'videoKeyframes')) continue;
		const key = stableId(
			dataProperty(clip, 'key', 'Framescaper retime clipboard video clip'),
			'Framescaper retime clipboard video clip.key',
		);
		result.add(stableId(
			dataProperty(clipIds, key, 'Framescaper retime clipboard/paste command.clipIds'),
			`Framescaper retime clipboard/paste command.clipIds.${key}`,
		));
	}
}

function commandType(value: unknown): string {
	const record = dataRecord(value, 'Framescaper retime command');
	const type = dataProperty(record, 'type', 'Framescaper retime command');
	if (typeof type !== 'string' || type.length === 0) {
		throw new TypeError('Framescaper retime command.type must be a non-empty string.');
	}
	return type;
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as DataRecord;
}

function dataProperty(value: DataRecord, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`${name} must be a non-empty string.`);
	}
	return value;
}
