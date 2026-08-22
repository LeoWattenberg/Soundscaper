/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import type { NativeMediaImageSequenceSourceV25 } from '../common/editor/native-media-image-sequence-v25.ts';
import {
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
} from '../common/editor/project-validation-budget.ts';
import type { VideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import type { VideoSourceCharacteristicsV25 } from '../common/editor/video-source-professional-characteristics-v25.ts';
import { assertFramescaperProjectV25CandidateProfile } from './editor-project-runtime-profile-v25.ts';
import {
	snapshotFramescaperProjectCommandV24,
	type FramescaperProjectCommandOptionsV24,
	type FramescaperProjectCommandV24,
} from './editor-project-v24-commands.ts';
import {
	applyInheritedFramescaperProjectCommandV25,
} from './editor-project-v25-command-inheritance.ts';
import {
	applyFramescaperProfessionalSourceCollectionCommandV25,
	createFramescaperProfessionalSourceAdmissionCommandV25,
	isFramescaperProfessionalSourceCollectionCommandTypeV25,
	snapshotFramescaperProfessionalSourceCollectionCommandV25,
	type FramescaperProfessionalSourceCollectionCommandV25,
} from './editor-project-v25-source-command.ts';
import {
	normalizeFramescaperProjectProfessionalMediaV25,
	normalizeFramescaperProfessionalVideoSourceV25,
	validateFramescaperProjectV25,
	type FramescaperProfessionalVideoSourceV25,
	type FramescaperProjectV25,
} from './editor-project-v25-validation.ts';
import {
	prepareFramescaperProfessionalMediaClipboardPasteV9,
} from './editor-session-clipboard-v9.ts';

export {
	createFramescaperImageSequenceSourceAdmissionCommandV25,
	createFramescaperProfessionalSourceAdmissionCommandV25,
} from './editor-project-v25-source-command.ts';

export interface FramescaperProfessionalSourceStateV25 {
	readonly characteristics: VideoSourceCharacteristicsV25;
	readonly imageSequence: NativeMediaImageSequenceSourceV25 | null;
	readonly proxyAttachment: Readonly<VideoProxyAttachmentV18> | null;
}

export interface FramescaperProfessionalSourceStateSetCommandV25 {
	readonly type: 'video-source/professional-state-set';
	readonly sourceId: string;
	readonly expectedState: FramescaperProfessionalSourceStateV25;
	readonly state: FramescaperProfessionalSourceStateV25;
}

export interface FramescaperProjectCommandBatchV25 {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandV25[];
}

export type FramescaperProjectCommandV25 =
	| FramescaperProfessionalSourceStateSetCommandV25
	| FramescaperProfessionalSourceCollectionCommandV25
	| FramescaperProjectCommandBatchV25
	| FramescaperProjectCommandV24;
export type FramescaperProjectCommandOptionsV25 = FramescaperProjectCommandOptionsV24;

interface SnapshotBudget { readonly active: Set<object>; count: number }

const STATE_FIELDS = Object.freeze(['characteristics', 'imageSequence', 'proxyAttachment']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;

export function snapshotFramescaperProjectCommandV25(value: unknown): FramescaperProjectCommandV25 {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

export function createFramescaperProfessionalMediaClipboardPasteCommandV25(
	clipboardValue: unknown,
	options: Readonly<{ sourceIdMap: ReadonlyMap<string, string> }>,
): FramescaperProjectCommandBatchV25 {
	const sources = prepareFramescaperProfessionalMediaClipboardPasteV9(clipboardValue, options);
	return Object.freeze({
		type: 'batch',
		commands: Object.freeze(sources.map(createFramescaperProfessionalSourceAdmissionCommandV25)),
	});
}

export function framescaperProfessionalSourceStateV25(
	profile: unknown,
	project: unknown,
	sourceIdValue: unknown,
): FramescaperProfessionalSourceStateV25 {
	assertFramescaperProjectV25CandidateProfile(profile);
	validateFramescaperProjectV25(profile, project);
	const sourceId = stableId(sourceIdValue);
	const source = videoSources(project as FramescaperProjectV25).find(({ id }) => id === sourceId);
	if (!source) throw new ReferenceError(`Framescaper V25 video source ${sourceId} does not exist.`);
	return stateFromSource(source);
}

export function applyFramescaperProjectCommandV25(
	profile: unknown,
	project: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsV25 = {},
): FramescaperProjectV25 {
	assertFramescaperProjectV25CandidateProfile(profile);
	validateFramescaperProjectV25(profile, project);
	const command = snapshotFramescaperProjectCommandV25(commandValue);
	return applyNormalized(profile, project as FramescaperProjectV25, command, options);
}

function snapshot(value: unknown, budget: SnapshotBudget, depth: number): FramescaperProjectCommandV25 {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS) throw new RangeError('Framescaper V25 command tree exceeds its limit.');
	if (depth > MAXIMUM_DEPTH) throw new RangeError('Framescaper V25 command tree exceeds its depth limit.');
	const type = commandType(value);
	if (type === 'video-source/professional-state-set') return snapshotStateCommand(value);
	if (isFramescaperProfessionalSourceCollectionCommandTypeV25(type)) {
		return snapshotFramescaperProfessionalSourceCollectionCommandV25(value);
	}
	if (type !== 'batch') return snapshotFramescaperProjectCommandV24(value);
	const record = readClosedDomainRecord(value, 'Framescaper V25 batch', ['type', 'commands']);
	if (budget.active.has(record)) throw new TypeError('Cyclic V25 command batches are unsupported.');
	const commands = readClosedDomainArray(
		field(record, 'commands'), 'Framescaper V25 batch.commands', 1, MAXIMUM_COMMANDS,
	);
	budget.active.add(record);
	try {
		return Object.freeze({ type: 'batch' as const,
			commands: Object.freeze(commands.map((child) => snapshot(child, budget, depth + 1))) });
	} finally {
		budget.active.delete(record);
	}
}

function applyNormalized(
	profile: unknown,
	project: FramescaperProjectV25,
	command: FramescaperProjectCommandV25,
	options: FramescaperProjectCommandOptionsV25,
): FramescaperProjectV25 {
	if (isBatch(command)) return applyBatch(profile, project, command, options);
	if (!isStateCommand(command) && !isCollectionCommand(command)) {
		return applyInheritedFramescaperProjectCommandV25(profile, project, command, options);
	}
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	if (isStateCommand(command)) applyState(project, draft, command);
	else applyFramescaperProfessionalSourceCollectionCommandV25(draft, command);
	advanceBookkeeping(draft, project, options);
	normalizeFramescaperProjectProfessionalMediaV25(profile, draft);
	validateFramescaperProjectV25(profile, draft);
	return draft as unknown as FramescaperProjectV25;
}

function isBatch(command: FramescaperProjectCommandV25): command is FramescaperProjectCommandBatchV25 {
	return command.type === 'batch' && Array.isArray(command.commands);
}

function isStateCommand(
	command: FramescaperProjectCommandV25,
): command is FramescaperProfessionalSourceStateSetCommandV25 {
	return command.type === 'video-source/professional-state-set'
		&& Object.hasOwn(command, 'expectedState');
}

function isCollectionCommand(
	command: FramescaperProjectCommandV25,
): command is FramescaperProfessionalSourceCollectionCommandV25 {
	return isFramescaperProfessionalSourceCollectionCommandTypeV25(command.type);
}

function applyBatch(
	profile: unknown,
	project: FramescaperProjectV25,
	command: FramescaperProjectCommandBatchV25,
	options: FramescaperProjectCommandOptionsV25,
): FramescaperProjectV25 {
	let current = project;
	for (const child of command.commands) current = applyNormalized(profile, current, child, options);
	const draft = structuredClone(current) as unknown as Record<string, unknown>;
	advanceBookkeeping(draft, project, options);
	normalizeFramescaperProjectProfessionalMediaV25(profile, draft);
	validateFramescaperProjectV25(profile, draft);
	return draft as unknown as FramescaperProjectV25;
}

function snapshotStateCommand(value: unknown): FramescaperProfessionalSourceStateSetCommandV25 {
	const command = readClosedDomainRecord(
		value, 'Framescaper V25 professional state command', ['type', 'sourceId', 'expectedState', 'state'],
	);
	return Object.freeze({
		type: 'video-source/professional-state-set',
		sourceId: stableId(field(command, 'sourceId')),
		expectedState: snapshotState(field(command, 'expectedState')),
		state: snapshotState(field(command, 'state')),
	});
}

function applyState(
	project: FramescaperProjectV25,
	draft: Record<string, unknown>,
	command: FramescaperProfessionalSourceStateSetCommandV25,
): void {
	const source = videoSources(project).find(({ id }) => id === command.sourceId);
	if (!source) throw new ReferenceError(`Framescaper V25 video source ${command.sourceId} does not exist.`);
	const expected = normalizeStateForSource(source, command.expectedState);
	if (JSON.stringify(stateFromSource(source)) !== JSON.stringify(expected)) {
		throw new Error('The expected V25 professional source state is stale.');
	}
	const replacement = normalizeStateForSource(source, command.state);
	const target = records(draft.sources, 'sources').find(({ id }) => id === command.sourceId)!;
	target.characteristics = replacement.characteristics;
	target.imageSequence = replacement.imageSequence;
	target.proxyAttachment = replacement.proxyAttachment;
}

function snapshotState(value: unknown): FramescaperProfessionalSourceStateV25 {
	const state = readClosedDomainRecord(value, 'Framescaper V25 professional source state', STATE_FIELDS);
	return Object.freeze(structuredClone({ characteristics: field(state, 'characteristics'),
		imageSequence: field(state, 'imageSequence'), proxyAttachment: field(state, 'proxyAttachment')
	}) as FramescaperProfessionalSourceStateV25);
}

function normalizeStateForSource(
	source: FramescaperProfessionalVideoSourceV25,
	state: FramescaperProfessionalSourceStateV25,
): FramescaperProfessionalSourceStateV25 {
	return stateFromSource(normalizeFramescaperProfessionalVideoSourceV25({
		...structuredClone(source), ...structuredClone(state),
	}));
}

function stateFromSource(source: FramescaperProfessionalVideoSourceV25): FramescaperProfessionalSourceStateV25 {
	return Object.freeze(structuredClone({ characteristics: source.characteristics,
		imageSequence: source.imageSequence, proxyAttachment: source.proxyAttachment }));
}

function videoSources(project: FramescaperProjectV25): FramescaperProfessionalVideoSourceV25[] {
	return project.sources.filter(
		(source): source is FramescaperProfessionalVideoSourceV25 => source.kind === 'video',
	);
}

function commandType(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Framescaper V25 command must be an object.');
	const type = field(value as Readonly<Record<string, unknown>>, 'type');
	if (typeof type !== 'string') throw new TypeError('Framescaper V25 command.type must be a string.');
	return type;
}

function field(record: Readonly<Record<string, unknown>>, name: string): unknown {
	return readClosedDomainField(record, name, 'Framescaper V25 command');
}

function stableId(value: unknown): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError('Framescaper V25 sourceId must be a stable ID.');
	return value;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`Framescaper V25 ${name} must be an array.`);
	return value.map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`Framescaper V25 ${name} item must be an object.`);
		return item as Record<string, unknown>;
	});
}

function advanceBookkeeping(
	draft: Record<string, unknown>, project: FramescaperProjectV25, options: FramescaperProjectCommandOptionsV25,
): void {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper V25 revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper V25 timestamp is invalid.');
	return date.toISOString();
}
