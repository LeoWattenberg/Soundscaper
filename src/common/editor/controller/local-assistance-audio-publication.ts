/* SPDX-License-Identifier: AGPL-3.0-only */

/** Transactional publication and optional placement of reviewed enhancement and TIGER results. */

import {
	AssistanceProposalStaleError,
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from '../assistance/proposal-session.ts';
import {
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
} from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../project-media-factory.ts';
import { streamWavBlobPcm } from '../wav-import.js';
import {
	assertLocalAssistanceAudioResultCurrent,
	normalizeLocalAssistanceAudioResult,
	type LocalAssistanceAudioOperation,
	type LocalAssistanceAudioOutputSlot,
	type LocalAssistanceAudioReviewedOutput,
	type NormalizedLocalAssistanceAudioResult,
} from './local-assistance-audio-result-custody.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;
type DataRecord = Readonly<Record<string, unknown>>;

export type LocalAssistanceEnhancementPlacement = 'project-bin' | 'replace-selection';
export type LocalAssistanceSeparationPlacement = 'project-bin' | 'project-bin-and-muted-tracks';
export type LocalAssistanceAudioPublicationChoice = Readonly<{
	readonly placement?: LocalAssistanceEnhancementPlacement | LocalAssistanceSeparationPlacement;
}>;

export interface LocalAssistanceAudioPublicationAuthority {
	readonly project: DataRecord;
	readonly source: DataRecord;
	readonly clip: DataRecord;
	readonly track: DataRecord;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly fence: AssistanceSelectionFence;
}

export interface LocalAssistanceAudioSourceWriter {
	readonly framesWritten?: number;
	write(channels: readonly Float32Array[]): Awaitable<unknown>;
	commit(
		metadata?: DataRecord,
		options?: Readonly<{ readonly ifAbsent?: boolean }>,
	): Awaitable<unknown>;
	abort(reason?: unknown): Awaitable<unknown>;
}

export interface LocalAssistanceAudioPublicationStore {
	beginSourceWrite(sourceId: string, metadata: DataRecord): Awaitable<LocalAssistanceAudioSourceWriter>;
	deleteSource(sourceId: string): Promise<unknown>;
}

export interface LocalAssistanceAudioPublicationDependencies {
	readonly currentAuthority: () => LocalAssistanceAudioPublicationAuthority;
	readonly captureProject: () => unknown;
	readonly assertProject: (token: unknown) => void;
	readonly createId: (prefix: string) => string;
	readonly preflightStorage: (bytes: number, category: 'effect') => Promise<unknown>;
	readonly store: LocalAssistanceAudioPublicationStore;
	readonly commit: (command: DataRecord) => void;
}

export interface LocalAssistanceAudioPublicationAcceptance {
	acceptValidatedResult(value: unknown, choice?: LocalAssistanceAudioPublicationChoice): Promise<void>;
}

interface NormalizedAuthority {
	readonly project: DataRecord;
	readonly source: DataRecord;
	readonly clip: DataRecord;
	readonly track: DataRecord;
	readonly fence: AssistanceSelectionFence;
	readonly projectSampleRate: number;
	readonly timelineStartFrame: number;
	readonly timelineEndFrame: number;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
}

interface PublicationPlan {
	readonly output: LocalAssistanceAudioReviewedOutput;
	readonly source: DataRecord;
	readonly binClipId: string;
	readonly timelineClipId: string;
	readonly trackId: string;
}

const SOURCE_CHUNK_FRAMES = 65_536;
const EXTENSION_KEY = 'org.soundscaper.local-assistance-audio-v1';
const SOURCE_NAMES = Object.freeze({
	'enhanced-audio': 'Enhanced Dialogue', dialogue: 'Dialogue', music: 'Music', effects: 'Effects',
} satisfies Readonly<Record<LocalAssistanceAudioOutputSlot, string>>);

export function createLocalAssistanceAudioPublicationAcceptance(
	dependencies: LocalAssistanceAudioPublicationDependencies,
): Readonly<LocalAssistanceAudioPublicationAcceptance> {
	validateDependencies(dependencies);
	return Object.freeze({ acceptValidatedResult });

	async function acceptValidatedResult(
		value: unknown,
		choiceValue: LocalAssistanceAudioPublicationChoice = {},
	): Promise<void> {
		const result = await normalizeLocalAssistanceAudioResult(value);
		const choice = normalizeChoice(choiceValue, result.operation);
		const initial = normalizeAuthority(dependencies.currentAuthority(), result);
		assertSameFence(result.selectionFence, initial.fence);
		assertPlacementAdmitted(choice, initial);
		const rawPcmBytes = publicationBytes(result.outputs);
		await dependencies.preflightStorage(rawPcmBytes, 'effect');
		assertLocalAssistanceAudioResultCurrent(value, result);
		assertAuthorityCurrent(dependencies, result, initial);
		const plans = createPublicationPlans(dependencies, result, initial);
		const publishedIds: string[] = [];
		try {
			for (const plan of plans) {
				await publishSource(dependencies.store, plan);
				publishedIds.push(String(plan.source.id));
				assertLocalAssistanceAudioResultCurrent(value, result);
				assertAuthorityCurrent(dependencies, result, initial);
			}
			const command = publicationCommand(result, initial, plans, choice, dependencies.createId);
			const token = dependencies.captureProject();
			assertAuthorityCurrent(dependencies, result, initial);
			dependencies.assertProject(token);
			assertAuthorityCurrent(dependencies, result, initial);
			assertLocalAssistanceAudioResultCurrent(value, result);
			dependencies.commit(command as unknown as DataRecord);
		} catch (error) {
			await rollbackSources(dependencies.store, publishedIds, error);
		}
	}
}

function createPublicationPlans(
	dependencies: LocalAssistanceAudioPublicationDependencies,
	result: NormalizedLocalAssistanceAudioResult,
	authority: NormalizedAuthority,
): readonly PublicationPlan[] {
	const occupied = new Set([
		...recordArray(authority.project.sources, 'project sources').map(({ id }) => String(id)),
		...recordArray(authority.project.clips, 'project clips').map(({ id }) => String(id)),
		...recordArray(authority.project.tracks, 'project tracks').map(({ id }) => String(id)),
		...recordArray(record(authority.project.projectBin, 'project bin').clips, 'Project Bin clips')
			.map(({ id }) => String(id)),
	]);
	return Object.freeze(result.outputs.map((output) => {
		const sourceId = uniqueId(dependencies.createId(`assistance-${output.slotId}`), occupied);
		const binClipId = uniqueId(dependencies.createId('assistance-bin-clip'), occupied);
		const timelineClipId = uniqueId(dependencies.createId('assistance-clip'), occupied);
		const trackId = uniqueId(dependencies.createId('assistance-track'), occupied);
		const name = SOURCE_NAMES[output.slotId];
		const source = createAudioSource({
			id: sourceId, storageKey: sourceId, name, kind: 'audio', mimeType: 'audio/wav',
			frameCount: output.review.frameCount, channelCount: output.review.channelCount,
			sampleRate: output.review.sampleRate, originalSampleRate: output.review.sampleRate,
			sampleFormat: 'float32', chunkFrames: SOURCE_CHUNK_FRAMES,
			contentSha256: output.claim.sha256, byteLength: output.claim.byteLength,
			opaqueExtensions: {
				[EXTENSION_KEY]: {
					version: 1, operation: result.operation, slotId: output.slotId,
					selectionFence: result.selectionFence,
					model: result.models[0], outputClaim: output.claim,
				},
			},
		}) as unknown as DataRecord;
		return Object.freeze({ output, source, binClipId, timelineClipId, trackId });
	}));
}

async function publishSource(
	store: LocalAssistanceAudioPublicationStore,
	plan: PublicationPlan,
): Promise<void> {
	const sourceId = String(plan.source.id);
	let writer: LocalAssistanceAudioSourceWriter | null = null;
	let committed = false;
	try {
		writer = await store.beginSourceWrite(sourceId, {
			name: plan.source.name, mimeType: 'audio/wav', sampleFormat: 'float32',
			sampleRate: plan.output.review.sampleRate,
			channelCount: plan.output.review.channelCount, chunkFrames: SOURCE_CHUNK_FRAMES,
			contentSha256: plan.output.claim.sha256, byteLength: plan.output.claim.byteLength,
		});
		await streamWavBlobPcm(plan.output.bytes, {
			chunkFrames: SOURCE_CHUNK_FRAMES,
			onChunk: (channels: Float32Array[]) => writer!.write(channels),
		});
		if (writer.framesWritten !== undefined
			&& writer.framesWritten !== plan.output.review.frameCount) {
			throw new Error('The assistance WAV writer persisted inexact frame geometry.');
		}
		await writer.commit({
			sampleRate: plan.output.review.sampleRate,
			channelCount: plan.output.review.channelCount, chunkFrames: SOURCE_CHUNK_FRAMES,
			contentSha256: plan.output.claim.sha256, byteLength: plan.output.claim.byteLength,
		}, { ifAbsent: true });
		committed = true;
	} catch (error) {
		if (!committed) await Promise.resolve(writer?.abort(error)).catch(() => undefined);
		try { await store.deleteSource(sourceId); }
		catch (cleanupError) {
			throw new AggregateError([error, cleanupError],
				'Assistance audio source publication and cleanup both failed.', { cause: error });
		}
		throw error;
	}
}

function publicationCommand(
	result: NormalizedLocalAssistanceAudioResult,
	authority: NormalizedAuthority,
	plans: readonly PublicationPlan[],
	choice: LocalAssistanceEnhancementPlacement | LocalAssistanceSeparationPlacement,
	createId: (prefix: string) => string,
): AudioEditorCommand {
	const commands: AudioEditorCommand[] = [];
	if (result.operation === 'speech-enhancement' && choice === 'replace-selection') {
		const plan = plans[0]!;
		commands.push(createAddSourceCommand(plan.source));
		commands.push(replacementDeleteCommand(authority, createId));
		commands.push(createAddClipCommand(String(authority.track.id), createTimelineClip(
			plan, authority, plan.timelineClipId,
		)));
		return Object.freeze({ type: 'batch', commands: Object.freeze(commands) });
	}
	for (const plan of plans) {
		commands.push(createAddSourceCommand(plan.source));
		commands.push({
			type: 'project-bin/add',
			clip: createAudioClip({
				id: plan.binClipId, binItemId: plan.binClipId, sourceId: String(plan.source.id),
				title: SOURCE_NAMES[plan.output.slotId], timelineStartFrame: 0, sourceStartFrame: 0,
				sourceDurationFrames: plan.output.review.frameCount,
				durationFrames: authority.timelineEndFrame - authority.timelineStartFrame,
				avLinkId: null,
			}),
		} as AudioEditorCommand);
	}
	if (result.operation === 'source-separation' && choice === 'project-bin-and-muted-tracks') {
		for (const plan of plans) {
			commands.push({
				...createAddTrackCommand(createAudioTrack({
					id: plan.trackId, name: SOURCE_NAMES[plan.output.slotId], mute: true,
				}, authority.projectSampleRate)),
				sequenceId: authority.fence.sequenceId,
			});
			commands.push(createAddClipCommand(plan.trackId, createTimelineClip(
				plan, authority, plan.timelineClipId,
			)));
		}
	}
	return Object.freeze({ type: 'batch', commands: Object.freeze(commands) });
}

function createTimelineClip(
	plan: PublicationPlan,
	authority: NormalizedAuthority,
	clipId: string,
): DataRecord {
	return createAudioClip({
		id: clipId, sourceId: String(plan.source.id), title: SOURCE_NAMES[plan.output.slotId],
		timelineStartFrame: authority.timelineStartFrame, sourceStartFrame: 0,
		sourceDurationFrames: plan.output.review.frameCount,
		durationFrames: authority.timelineEndFrame - authority.timelineStartFrame,
		avLinkId: null,
	}) as unknown as DataRecord;
}

function replacementDeleteCommand(
	authority: NormalizedAuthority,
	createId: (prefix: string) => string,
): AudioEditorCommand {
	const clipStart = integer(authority.clip.timelineStartFrame, 0, 'selected clip start');
	const clipEnd = safeAdd(clipStart,
		integer(authority.clip.durationFrames, 1, 'selected clip duration'), 'selected clip end');
	const splitClipIds = clipStart < authority.timelineStartFrame && clipEnd > authority.timelineEndFrame
		? Object.freeze({ [String(authority.clip.id)]: createId('assistance-original-right') })
		: Object.freeze({});
	return Object.freeze({
		type: 'range/lift-delete', startFrame: authority.timelineStartFrame,
		endFrame: authority.timelineEndFrame, trackIds: Object.freeze([String(authority.track.id)]),
		clipIds: Object.freeze([String(authority.clip.id)]), splitClipIds,
		splitAvLinkIds: Object.freeze({}), videoEffectIds: Object.freeze({}),
	});
}

function normalizeAuthority(
	value: LocalAssistanceAudioPublicationAuthority,
	result: NormalizedLocalAssistanceAudioResult,
): NormalizedAuthority {
	if (!value || typeof value !== 'object') throw new TypeError('Audio publication requires selected-media authority.');
	const project = record(value.project, 'selected project');
	const source = record(value.source, 'selected source');
	const clip = record(value.clip, 'selected clip');
	const track = record(value.track, 'selected track');
	const fence = validateAssistanceSelectionFence(value.fence);
	if (project.id !== fence.projectId || project.schemaVersion !== fence.schemaVersion
		|| project.revision !== fence.revision || source.id !== fence.sourceId
		|| source.contentSha256 !== fence.sourceSha256 || clip.sourceId !== source.id
		|| !fence.occurrenceIds.includes(String(clip.id)) || track.type !== 'audio'
		|| !Array.isArray(track.clipIds) || !track.clipIds.includes(clip.id)) {
		throw new AssistanceProposalStaleError();
	}
	const inventories = [
		[project.sources, source, 'source'], [project.clips, clip, 'clip'], [project.tracks, track, 'track'],
	] as const;
	for (const [candidates, selected, label] of inventories) {
		if (!recordArray(candidates, `project ${label}s`).some(({ id }) => id === selected.id)) {
			throw new AssistanceProposalStaleError();
		}
	}
	const projectSampleRate = integer(project.sampleRate, 1, 'project sample rate');
	const timelineStartFrame = integer(value.startFrame, 0, 'selected timeline start');
	const timelineEndFrame = integer(value.endFrame, 1, 'selected timeline end');
	const sourceStartFrame = integer(value.sourceStartFrame, 0, 'selected source start');
	const sourceEndFrame = integer(value.sourceEndFrame, 1, 'selected source end');
	const duration = timelineEndFrame - timelineStartFrame;
	if (duration < 1 || sourceEndFrame - sourceStartFrame !== duration
		|| sourceStartFrame !== fence.sourceStartFrame || sourceEndFrame !== fence.sourceEndFrame) {
		throw new AssistanceProposalStaleError();
	}
	const expectedRate = result.operation === 'speech-enhancement' ? 48_000 : 44_100;
	const expectedFrames = Math.round(duration * expectedRate / projectSampleRate);
	const channelCount = integer(source.channelCount, 1, 'selected source channel count');
	if (result.outputs.some(({ review }) => review.sampleRate !== expectedRate
		|| review.frameCount !== expectedFrames || review.channelCount !== channelCount)) {
		throw new RangeError('The reviewed assistance WAV geometry is not exact for the selected range.');
	}
	return Object.freeze({ project, source, clip, track, fence, projectSampleRate,
		timelineStartFrame, timelineEndFrame, sourceStartFrame, sourceEndFrame });
}

function assertAuthorityCurrent(
	dependencies: LocalAssistanceAudioPublicationDependencies,
	result: NormalizedLocalAssistanceAudioResult,
	initial: NormalizedAuthority,
): void {
	const current = normalizeAuthority(dependencies.currentAuthority(), result);
	assertSameFence(result.selectionFence, current.fence);
	if (!same(current.project, initial.project) || !same(current.source, initial.source)
		|| !same(current.clip, initial.clip) || !same(current.track, initial.track)
		|| current.timelineStartFrame !== initial.timelineStartFrame
		|| current.timelineEndFrame !== initial.timelineEndFrame) {
		throw new AssistanceProposalStaleError();
	}
}

function normalizeChoice(
	value: LocalAssistanceAudioPublicationChoice,
	operation: LocalAssistanceAudioOperation,
): LocalAssistanceEnhancementPlacement | LocalAssistanceSeparationPlacement {
	const choice = record(value, 'audio publication choice');
	if (Object.keys(choice).some((key) => key !== 'placement')) {
		throw new TypeError('Audio publication choice has an unsupported field.');
	}
	const placement = choice.placement ?? 'project-bin';
	const allowed = operation === 'speech-enhancement'
		? ['project-bin', 'replace-selection']
		: ['project-bin', 'project-bin-and-muted-tracks'];
	if (!allowed.includes(String(placement))) {
		throw new RangeError('Audio publication placement is invalid for this workflow.');
	}
	return placement as LocalAssistanceEnhancementPlacement | LocalAssistanceSeparationPlacement;
}

function assertPlacementAdmitted(
	choice: LocalAssistanceEnhancementPlacement | LocalAssistanceSeparationPlacement,
	authority: NormalizedAuthority,
): void {
	if (choice === 'replace-selection' && authority.clip.avLinkId != null) {
		throw new RangeError('Exact enhancement replacement refuses a linked A/V occurrence; publish it to Project Bin.');
	}
}

function publicationBytes(outputs: readonly LocalAssistanceAudioReviewedOutput[]): number {
	const bytes = outputs.reduce((sum, { review }) => (
		sum + review.frameCount * review.channelCount * Float32Array.BYTES_PER_ELEMENT
	), 0);
	if (!Number.isSafeInteger(bytes) || bytes < 1) {
		throw new RangeError('Assistance audio publication exceeds safe capacity accounting.');
	}
	return bytes;
}

async function rollbackSources(
	store: LocalAssistanceAudioPublicationStore,
	ids: readonly string[],
	cause: unknown,
): Promise<never> {
	const errors: unknown[] = [];
	for (const id of [...ids].reverse()) {
		try { await store.deleteSource(id); }
		catch (error) { errors.push(error); }
	}
	if (errors.length) throw new AggregateError([cause, ...errors],
		'Assistance audio acceptance and rollback both failed.', { cause });
	throw cause;
}

function assertSameFence(left: AssistanceSelectionFence, right: AssistanceSelectionFence): void {
	if (!same(left, right)) throw new AssistanceProposalStaleError();
}

function uniqueId(value: unknown, occupied: Set<string>): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256 || occupied.has(value)) {
		throw new RangeError('Assistance audio publication received a colliding stable ID.');
	}
	occupied.add(value);
	return value;
}

function record(value: unknown, label: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The ${label} must be a record.`);
	}
	return value as DataRecord;
}

function recordArray(value: unknown, label: string): readonly DataRecord[] {
	if (!Array.isArray(value) || value.some((candidate) => !candidate
		|| typeof candidate !== 'object' || Array.isArray(candidate))) {
		throw new TypeError(`The ${label} must be a record array.`);
	}
	return value as readonly DataRecord[];
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function safeAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`The ${label} exceeds safe timing.`);
	return result;
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function validateDependencies(value: LocalAssistanceAudioPublicationDependencies): void {
	if (!value || typeof value !== 'object' || typeof value.currentAuthority !== 'function'
		|| typeof value.captureProject !== 'function' || typeof value.assertProject !== 'function'
		|| typeof value.createId !== 'function' || typeof value.preflightStorage !== 'function'
		|| typeof value.commit !== 'function' || !value.store || typeof value.store !== 'object'
		|| typeof value.store.beginSourceWrite !== 'function'
		|| typeof value.store.deleteSource !== 'function') {
		throw new TypeError('Audio publication acceptance requires its exact controller ports.');
	}
}
