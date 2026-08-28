/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import type { NativeMediaImageSequenceSourceV25 } from '../common/editor/native-media-image-sequence-v25.ts';
import {
	AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
} from '../common/editor/project-validation-budget.ts';
import type { VideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import type { VideoSourceCharacteristicsV25 } from '../common/editor/video-source-professional-characteristics-v25.ts';
import { assertFramescaperProjectProfessionalMediaCandidateProfile } from './editor-domain-runtime-profile.ts';
import {
	snapshotFramescaperProjectCommandVisual,
	type FramescaperProjectCommandOptionsVisual,
	type FramescaperProjectCommandVisual,
} from './editor-project-visual-commands.ts';
import {
	applyInheritedFramescaperProjectCommandProfessionalMedia,
} from './editor-project-professional-media-command-inheritance.ts';
import {
	applyFramescaperProfessionalSourceCollectionCommandProfessionalMedia,
	createFramescaperProfessionalSourceAdmissionCommandProfessionalMedia,
	isFramescaperProfessionalSourceCollectionCommandTypeProfessionalMedia,
	snapshotFramescaperProfessionalSourceCollectionCommandProfessionalMedia,
	type FramescaperProfessionalSourceCollectionCommandProfessionalMedia,
} from './editor-project-professional-media-source-command.ts';
import {
	normalizeFramescaperProjectProfessionalMediaProfessionalMedia,
	normalizeFramescaperProfessionalVideoSourceProfessionalMedia,
	validateFramescaperProjectProfessionalMedia,
	type FramescaperProfessionalVideoSourceProfessionalMedia,
	type FramescaperProjectProfessionalMedia,
} from './editor-project-professional-media-validation.ts';
import {
	prepareFramescaperProfessionalMediaClipboardPasteV9,
} from './editor-session-clipboard-v9.ts';

export {
	createFramescaperImageSequenceSourceAdmissionCommandProfessionalMedia,
	createFramescaperProfessionalSourceAdmissionCommandProfessionalMedia,
} from './editor-project-professional-media-source-command.ts';

export interface FramescaperProfessionalSourceStateProfessionalMedia {
	readonly characteristics: VideoSourceCharacteristicsV25;
	readonly imageSequence: NativeMediaImageSequenceSourceV25 | null;
	readonly proxyAttachment: Readonly<VideoProxyAttachmentV18> | null;
}

export interface FramescaperProfessionalSourceStateSetCommandProfessionalMedia {
	readonly type: 'video-source/professional-state-set';
	readonly sourceId: string;
	readonly expectedState: FramescaperProfessionalSourceStateProfessionalMedia;
	readonly state: FramescaperProfessionalSourceStateProfessionalMedia;
}

export interface FramescaperProjectCommandBatchProfessionalMedia {
	readonly type: 'batch';
	readonly commands: readonly FramescaperProjectCommandProfessionalMedia[];
}

export type FramescaperProjectCommandProfessionalMedia =
	| FramescaperProfessionalSourceStateSetCommandProfessionalMedia
	| FramescaperProfessionalSourceCollectionCommandProfessionalMedia
	| FramescaperProjectCommandBatchProfessionalMedia
	| FramescaperProjectCommandVisual;
export type FramescaperProjectCommandOptionsProfessionalMedia = FramescaperProjectCommandOptionsVisual;

interface SnapshotBudget { readonly active: Set<object>; count: number }

const STATE_FIELDS = Object.freeze(['characteristics', 'imageSequence', 'proxyAttachment']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAXIMUM_COMMANDS = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes;
const MAXIMUM_DEPTH = AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalDepth;

export function snapshotFramescaperProjectCommandProfessionalMedia(value: unknown): FramescaperProjectCommandProfessionalMedia {
	return snapshot(value, { active: new Set(), count: 0 }, 0);
}

export function createFramescaperProfessionalMediaClipboardPasteCommandProfessionalMedia(
	clipboardValue: unknown,
	options: Readonly<{ sourceIdMap: ReadonlyMap<string, string> }>,
): FramescaperProjectCommandBatchProfessionalMedia {
	const sources = prepareFramescaperProfessionalMediaClipboardPasteV9(clipboardValue, options);
	return Object.freeze({
		type: 'batch',
		commands: Object.freeze(sources.map(createFramescaperProfessionalSourceAdmissionCommandProfessionalMedia)),
	});
}

export function framescaperProfessionalSourceStateProfessionalMedia(
	profile: unknown,
	project: unknown,
	sourceIdValue: unknown,
): FramescaperProfessionalSourceStateProfessionalMedia {
	assertFramescaperProjectProfessionalMediaCandidateProfile(profile);
	validateFramescaperProjectProfessionalMedia(profile, project);
	const sourceId = stableId(sourceIdValue);
	const source = videoSources(project as FramescaperProjectProfessionalMedia).find(({ id }) => id === sourceId);
	if (!source) throw new ReferenceError(`Framescaper professionalMedia video source ${sourceId} does not exist.`);
	return stateFromSource(source);
}

export function applyFramescaperProjectCommandProfessionalMedia(
	profile: unknown,
	project: unknown,
	commandValue: unknown,
	options: FramescaperProjectCommandOptionsProfessionalMedia = {},
): FramescaperProjectProfessionalMedia {
	assertFramescaperProjectProfessionalMediaCandidateProfile(profile);
	validateFramescaperProjectProfessionalMedia(profile, project);
	const command = snapshotFramescaperProjectCommandProfessionalMedia(commandValue);
	return applyNormalized(profile, project as FramescaperProjectProfessionalMedia, command, options);
}

function snapshot(value: unknown, budget: SnapshotBudget, depth: number): FramescaperProjectCommandProfessionalMedia {
	budget.count += 1;
	if (budget.count > MAXIMUM_COMMANDS) throw new RangeError('Framescaper professionalMedia command tree exceeds its limit.');
	if (depth > MAXIMUM_DEPTH) throw new RangeError('Framescaper professionalMedia command tree exceeds its depth limit.');
	const type = commandType(value);
	if (type === 'video-source/professional-state-set') return snapshotStateCommand(value);
	if (isFramescaperProfessionalSourceCollectionCommandTypeProfessionalMedia(type)) {
		return snapshotFramescaperProfessionalSourceCollectionCommandProfessionalMedia(value);
	}
	if (type !== 'batch') return snapshotFramescaperProjectCommandVisual(value);
	const record = readClosedDomainRecord(value, 'Framescaper professionalMedia batch', ['type', 'commands']);
	if (budget.active.has(record)) throw new TypeError('Cyclic professionalMedia command batches are unsupported.');
	const commands = readClosedDomainArray(
		field(record, 'commands'), 'Framescaper professionalMedia batch.commands', 1, MAXIMUM_COMMANDS,
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
	project: FramescaperProjectProfessionalMedia,
	command: FramescaperProjectCommandProfessionalMedia,
	options: FramescaperProjectCommandOptionsProfessionalMedia,
): FramescaperProjectProfessionalMedia {
	if (isBatch(command)) return applyBatch(profile, project, command, options);
	if (!isStateCommand(command) && !isCollectionCommand(command)) {
		return applyInheritedFramescaperProjectCommandProfessionalMedia(profile, project, command, options);
	}
	const draft = structuredClone(project) as unknown as Record<string, unknown>;
	if (isStateCommand(command)) applyState(project, draft, command);
	else applyFramescaperProfessionalSourceCollectionCommandProfessionalMedia(draft, command);
	advanceBookkeeping(draft, project, options);
	normalizeFramescaperProjectProfessionalMediaProfessionalMedia(profile, draft);
	validateFramescaperProjectProfessionalMedia(profile, draft);
	return draft as unknown as FramescaperProjectProfessionalMedia;
}

function isBatch(command: FramescaperProjectCommandProfessionalMedia): command is FramescaperProjectCommandBatchProfessionalMedia {
	return command.type === 'batch' && Array.isArray(command.commands);
}

function isStateCommand(
	command: FramescaperProjectCommandProfessionalMedia,
): command is FramescaperProfessionalSourceStateSetCommandProfessionalMedia {
	return command.type === 'video-source/professional-state-set'
		&& Object.hasOwn(command, 'expectedState');
}

function isCollectionCommand(
	command: FramescaperProjectCommandProfessionalMedia,
): command is FramescaperProfessionalSourceCollectionCommandProfessionalMedia {
	return isFramescaperProfessionalSourceCollectionCommandTypeProfessionalMedia(command.type);
}

function applyBatch(
	profile: unknown,
	project: FramescaperProjectProfessionalMedia,
	command: FramescaperProjectCommandBatchProfessionalMedia,
	options: FramescaperProjectCommandOptionsProfessionalMedia,
): FramescaperProjectProfessionalMedia {
	let current = project;
	for (const child of command.commands) current = applyNormalized(profile, current, child, options);
	const draft = structuredClone(current) as unknown as Record<string, unknown>;
	advanceBookkeeping(draft, project, options);
	normalizeFramescaperProjectProfessionalMediaProfessionalMedia(profile, draft);
	validateFramescaperProjectProfessionalMedia(profile, draft);
	return draft as unknown as FramescaperProjectProfessionalMedia;
}

function snapshotStateCommand(value: unknown): FramescaperProfessionalSourceStateSetCommandProfessionalMedia {
	const command = readClosedDomainRecord(
		value, 'Framescaper professionalMedia professional state command', ['type', 'sourceId', 'expectedState', 'state'],
	);
	return Object.freeze({
		type: 'video-source/professional-state-set',
		sourceId: stableId(field(command, 'sourceId')),
		expectedState: snapshotState(field(command, 'expectedState')),
		state: snapshotState(field(command, 'state')),
	});
}

function applyState(
	project: FramescaperProjectProfessionalMedia,
	draft: Record<string, unknown>,
	command: FramescaperProfessionalSourceStateSetCommandProfessionalMedia,
): void {
	const source = videoSources(project).find(({ id }) => id === command.sourceId);
	if (!source) throw new ReferenceError(`Framescaper professionalMedia video source ${command.sourceId} does not exist.`);
	const expected = normalizeStateForSource(source, command.expectedState);
	if (JSON.stringify(stateFromSource(source)) !== JSON.stringify(expected)) {
		throw new Error('The expected professionalMedia professional source state is stale.');
	}
	const replacement = normalizeStateForSource(source, command.state);
	const target = records(draft.sources, 'sources').find(({ id }) => id === command.sourceId)!;
	target.characteristics = replacement.characteristics;
	target.imageSequence = replacement.imageSequence;
	target.proxyAttachment = replacement.proxyAttachment;
}

function snapshotState(value: unknown): FramescaperProfessionalSourceStateProfessionalMedia {
	const state = readClosedDomainRecord(value, 'Framescaper professionalMedia professional source state', STATE_FIELDS);
	return Object.freeze(structuredClone({ characteristics: field(state, 'characteristics'),
		imageSequence: field(state, 'imageSequence'), proxyAttachment: field(state, 'proxyAttachment')
	}) as FramescaperProfessionalSourceStateProfessionalMedia);
}

function normalizeStateForSource(
	source: FramescaperProfessionalVideoSourceProfessionalMedia,
	state: FramescaperProfessionalSourceStateProfessionalMedia,
): FramescaperProfessionalSourceStateProfessionalMedia {
	return stateFromSource(normalizeFramescaperProfessionalVideoSourceProfessionalMedia({
		...structuredClone(source), ...structuredClone(state),
	}));
}

function stateFromSource(source: FramescaperProfessionalVideoSourceProfessionalMedia): FramescaperProfessionalSourceStateProfessionalMedia {
	return Object.freeze(structuredClone({ characteristics: source.characteristics,
		imageSequence: source.imageSequence, proxyAttachment: source.proxyAttachment }));
}

function videoSources(project: FramescaperProjectProfessionalMedia): FramescaperProfessionalVideoSourceProfessionalMedia[] {
	return project.sources.filter(
		(source): source is FramescaperProfessionalVideoSourceProfessionalMedia => source.kind === 'video',
	);
}

function commandType(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Framescaper professionalMedia command must be an object.');
	const type = field(value as Readonly<Record<string, unknown>>, 'type');
	if (typeof type !== 'string') throw new TypeError('Framescaper professionalMedia command.type must be a string.');
	return type;
}

function field(record: Readonly<Record<string, unknown>>, name: string): unknown {
	return readClosedDomainField(record, name, 'Framescaper professionalMedia command');
}

function stableId(value: unknown): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError('Framescaper professionalMedia sourceId must be a stable ID.');
	return value;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`Framescaper professionalMedia ${name} must be an array.`);
	return value.map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`Framescaper professionalMedia ${name} item must be an object.`);
		return item as Record<string, unknown>;
	});
}

function advanceBookkeeping(
	draft: Record<string, unknown>, project: FramescaperProjectProfessionalMedia, options: FramescaperProjectCommandOptionsProfessionalMedia,
): void {
	const revision = Number(project.revision) + 1;
	if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper professionalMedia revision overflowed.');
	draft.revision = revision;
	draft.updatedAt = timestamp(options.now);
}

function timestamp(value: Date | string | undefined): string {
	const date = value === undefined ? new Date() : new Date(value);
	if (Number.isNaN(date.getTime())) throw new RangeError('Framescaper professionalMedia timestamp is invalid.');
	return date.toISOString();
}
