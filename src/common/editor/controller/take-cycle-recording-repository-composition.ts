/* SPDX-License-Identifier: AGPL-3.0-only */

import { applyEditorCommand } from '../commands.js';
import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import { createAudioSource } from '../project-media-factory.ts';
import { validateAudioEditorProjectV17, type AudioEditorProjectV17 } from '../project-v17-validation.ts';
import { createScapeDigest, digestScapeBytes, scapeHex } from '../scape-archive-media.ts';
import { parseScapeProjectDocument, serializeScapeProjectDocument } from '../scape-project-document.ts';
import type { TakeCompDocumentGroup } from '../take-comp-document-v17.ts';
import { normalizeCompRegionId } from '../take-comp-domain.ts';
import type {
	TakeCycleProjectPublicationEvidence,
	TakeCycleRecoveryEnvelope,
} from '../take-cycle-recovery-envelope.ts';
import type { TakeMediaPublicationBinding } from '../take-media-recovery-journal.ts';
import type { ProjectDocument, ProjectRepositoryPort } from '../storage/project-repository.ts';
import type { SourceRepository } from '../storage/source-repository.ts';
import type { AudioSourceStageReceipt, OwnedAudioSourceWriter } from '../storage/source-write-repository.ts';
import type { StorageRecord } from '../storage/media-records.ts';
import type { TakeCycleRecoveryEnvelopeRepository } from '../storage/take-cycle-recovery-envelope-repository.ts';
import { packPlanarFloat32 } from '../wavpack/pcm.js';
import type { EditorControllerLifetime, EditorProjectToken } from './lifecycle.ts';
import {
	createTakeCycleRecordingService,
	type MaybePromise,
	type TakeCycleFinalizationRequest,
	type TakeCycleFinalizationResult,
	type TakeCyclePassOperation,
	type TakeCycleProjectPreparationOperation,
	type TakeCyclePublicationDescriptor,
	type TakeCycleRecordingOptions,
	type TakeCycleRecoveryRequest,
	type TakeCycleStageReceiptOperation,
} from './take-cycle-recording-service.ts';
import { normalizeTakeCycleSourceDescription } from './take-cycle-source-validation.ts';
import type { TakeCycleEnvelopeRecoveryPlan } from '../take-cycle-recovery-envelope.ts';
const TEXT_ENCODER = new TextEncoder();
export interface TakeCycleLaneTarget {
	readonly sequenceId: string;
	readonly trackId: string;
}
export interface TakeCycleSourceDescription {
	readonly name: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly frameCount: number;
}
export interface TakeCyclePublishedProject {
	readonly reason: 'finalize' | 'recovery';
	readonly base: AudioEditorProjectV17;
	readonly target: AudioEditorProjectV17;
	readonly command: AudioEditorCommand | null;
}
export interface TakeCycleRecordingRepositoryDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'startTask' | 'cancelTask'>;
	readonly recoveryRepository: Pick<
		TakeCycleRecoveryEnvelopeRepository,
		'load' | 'create' | 'replace' | 'remove'
	>;
	readonly projects: Pick<ProjectRepositoryPort, 'load' | 'saveIfCurrent'>;
	readonly sources: Pick<SourceRepository,
		'createStageReceipt' | 'beginOwnedStage' | 'discardStageIfCurrent'
		| 'getMetadata' | 'chunks' | 'discardIfCurrent'
	>;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	resolveLaneTarget(operation: TakeCycleProjectPreparationOperation): MaybePromise<TakeCycleLaneTarget>;
	describeSource(operation: TakeCycleStageReceiptOperation): MaybePromise<TakeCycleSourceDescription>;
	readPassChunks(operation: TakeCyclePassOperation): MaybePromise<AsyncIterable<readonly Float32Array[]>>;
	createCompRegionId(operation: TakeCycleProjectPreparationOperation): string;
	applyProjectCommand?(project: AudioEditorProjectV17, command: AudioEditorCommand,
		options?: Readonly<{ readonly now?: Date | string }>): AudioEditorProjectV17;
	validateProject?(project: unknown): void;
	now?(): Date | string;
	onStageReceipt?(receipt: AudioSourceStageReceipt): void;
	publishCurrentProject?(publication: TakeCyclePublishedProject): MaybePromise<void>;
}

export interface TakeCycleRecordingRepositoryComposition {
	finalize(request: TakeCycleFinalizationRequest, options?: TakeCycleRecordingOptions): Promise<TakeCycleFinalizationResult>;
	recover(request: TakeCycleRecoveryRequest, options?: TakeCycleRecordingOptions): Promise<TakeCycleEnvelopeRecoveryPlan>;
	cancel(reason?: unknown): void;
}

interface PreparedSource {
	readonly publication: TakeCyclePublicationDescriptor;
	readonly description: TakeCycleSourceDescription;
}

interface PreparedProject {
	readonly base: AudioEditorProjectV17;
	readonly target: AudioEditorProjectV17;
	readonly command: AudioEditorCommand;
	readonly sources: ReadonlyMap<string, PreparedSource>;
}

interface StagedWriter {
	readonly writer: OwnedAudioSourceWriter;
	readonly source: PreparedSource;
}

/** Bind cycle recovery to canonical project CAS and receipt-owned PCM repositories. */
export function createTakeCycleRecordingRepositoryComposition(
	dependencies: TakeCycleRecordingRepositoryDependencies,
): Readonly<TakeCycleRecordingRepositoryComposition> {
	const preparedProjects = new Map<string, PreparedProject>();
	const stagedWriters = new Map<string, StagedWriter>();
	const service = createTakeCycleRecordingService({
		lifetime: dependencies.lifetime,
		recoveryRepository: dependencies.recoveryRepository,
		captureProject: dependencies.captureProject,
		assertProject: dependencies.assertProject,
		prepareProjectPublication,
		releaseProjectPreparation: ({ projectFence }) => {
			preparedProjects.delete(projectFence.targetSha256);
		},
		createMediaStageReceipt,
		stageMedia,
		publishMedia,
		publishProject: async ({ envelope }) => publishTarget(envelope, 'finalize'),
		inspectMedia,
		inspectProject,
		cleanupStagedMedia,
		cleanupPublishedMedia,
		replayProjectCommit: async ({ action }) => publishTarget(action.envelope, 'recovery'),
	});
	return Object.freeze({
		finalize: service.finalize,
		recover: service.recover,
		cancel: service.cancel,
	});

	async function prepareProjectPublication(operation: TakeCycleProjectPreparationOperation) {
		const base = await loadProject(operation.ownership.projectToken.projectId, operation.ownership.signal);
		const targetOwnership = normalizeLaneTarget(await dependencies.resolveLaneTarget(operation));
		const sourceEntries: PreparedSource[] = [];
		for (let index = 0; index < operation.plan.passes.length; index += 1) {
			const publication = operation.publications[index];
			const pass = operation.plan.passes[index];
			if (!publication || !pass) throw new Error('Take cycle project preparation is missing one exact pass.');
			const stageOperation = Object.freeze({ ...operation, publication, pass });
			const description = normalizeTakeCycleSourceDescription(
				await dependencies.describeSource(stageOperation),
				pass.captureEndSample - pass.captureStartSample,
				base.sampleRate,
			);
			sourceEntries.push(Object.freeze({ publication, description }));
		}
		const command = projectCommand(
			base, operation, targetOwnership, sourceEntries,
			dependencies.createCompRegionId(operation),
		);
		const target = applyProjectCommand(base, command, { now: dependencies.now?.() });
		validateProject(target);
		const baseDocument = serializeScapeProjectDocument(base);
		const targetProjectDocument = serializeScapeProjectDocument(target);
		const baseSha256 = documentDigest(baseDocument);
		const targetSha256 = documentDigest(targetProjectDocument);
		preparedProjects.set(targetSha256, Object.freeze({
			base,
			target,
			command,
			sources: new Map(sourceEntries.map((entry) => [entry.publication.mediaId, entry])),
		}));
		return Object.freeze({
			projectFence: Object.freeze({
				projectId: base.id,
				baseRevision: base.revision,
				baseSha256,
				targetRevision: target.revision,
				targetSha256,
			}),
			targetProjectDocument,
		});
	}

	function createMediaStageReceipt(operation: TakeCycleStageReceiptOperation): AudioSourceStageReceipt {
		const receipt = dependencies.sources.createStageReceipt(operation.publication.mediaId);
		dependencies.onStageReceipt?.(receipt);
		return receipt;
	}

	async function stageMedia(operation: TakeCyclePassOperation): Promise<void> {
		const entry = operation.envelope.entries[operation.entryIndex]!;
		const source = preparedSource(operation.envelope, entry.journal.binding.mediaId);
		const writer = await dependencies.sources.beginOwnedStage(entry.stageReceipt, sourceMetadata(source.description));
		stagedWriters.set(entry.stageReceipt.sourceToken, Object.freeze({ writer, source }));
		try {
			const iterable = await dependencies.readPassChunks(operation);
			await writeExactPcm(writer, iterable, source, operation.ownership.signal);
		} catch (error) {
			stagedWriters.delete(entry.stageReceipt.sourceToken);
			await abortWriter(writer, error);
		}
	}

	async function publishMedia(operation: TakeCyclePassOperation): Promise<TakeMediaPublicationBinding> {
		const entry = operation.envelope.entries[operation.entryIndex]!;
		const staged = stagedWriters.get(entry.stageReceipt.sourceToken);
		if (!staged) throw new Error('Take cycle source stage ownership is unavailable.');
		try {
			const metadata = await staged.writer.commit(sourceMetadata(staged.source.description), {
				signal: operation.ownership.signal,
				ifAbsent: true,
			});
			if (metadata.sourceToken !== entry.stageReceipt.sourceToken
				|| !await storedSourceMatches(metadata, entry.journal.binding, operation.ownership.signal)) {
				throw new Error('Published take cycle PCM does not match its exact media evidence.');
			}
			return entry.journal.binding;
		} finally {
			stagedWriters.delete(entry.stageReceipt.sourceToken);
		}
	}

	async function inspectMedia({ envelope, entryIndex, binding, ownership }: {
		readonly envelope: TakeCycleRecoveryEnvelope;
		readonly entryIndex: number;
		readonly binding: TakeMediaPublicationBinding;
		readonly ownership: { readonly signal: AbortSignal };
	}): Promise<TakeMediaPublicationBinding | null> {
		const receipt = envelope.entries[entryIndex]?.stageReceipt;
		if (!receipt) throw new RangeError('Take cycle media inspection entry is missing.');
		const metadata = await dependencies.sources.getMetadata(binding.mediaId);
		if (!metadata || metadata.sourceToken !== receipt.sourceToken) return null;
		return await storedSourceMatches(metadata, binding, ownership.signal) ? binding : null;
	}

	async function inspectProject({ envelope, ownership }: {
		readonly envelope: TakeCycleRecoveryEnvelope;
		readonly ownership: { readonly signal: AbortSignal };
	}): Promise<TakeCycleProjectPublicationEvidence | null> {
		const project = await dependencies.projects.load(envelope.projectFence.projectId, {
			signal: ownership.signal,
		});
		if (!project) return null;
		const evidence = projectEvidence(project);
		if (sameEvidence(evidence, envelope, 'target')) {
			await synchronizePublishedProject(project, envelope, 'recovery');
		}
		return evidence;
	}

	async function cleanupStagedMedia({ action }: {
		readonly action: Readonly<{ stageReceipt: AudioSourceStageReceipt }>;
	}): Promise<boolean> {
		const staged = stagedWriters.get(action.stageReceipt.sourceToken);
		stagedWriters.delete(action.stageReceipt.sourceToken);
		await staged?.writer.abort();
		const metadata = await dependencies.sources.getMetadata(action.stageReceipt.sourceId);
		if (metadata) {
			return metadata.sourceToken === action.stageReceipt.sourceToken
				&& dependencies.sources.discardIfCurrent(metadata);
		}
		return dependencies.sources.discardStageIfCurrent(action.stageReceipt);
	}

	async function cleanupPublishedMedia({ envelope, action, ownership }: {
		readonly envelope: TakeCycleRecoveryEnvelope;
		readonly action: Readonly<{ entryIndex: number; binding: TakeMediaPublicationBinding }>;
		readonly ownership: { readonly signal: AbortSignal };
	}): Promise<boolean> {
		const receipt = envelope.entries[action.entryIndex]?.stageReceipt;
		if (!receipt) return false;
		const metadata = await dependencies.sources.getMetadata(action.binding.mediaId);
		if (!metadata) return true;
		if (metadata.sourceToken !== receipt.sourceToken
			|| !await storedSourceMatches(metadata, action.binding, ownership.signal)) return false;
		return dependencies.sources.discardIfCurrent(metadata);
	}

	async function publishTarget(
		envelope: TakeCycleRecoveryEnvelope,
		reason: 'finalize' | 'recovery',
	): Promise<TakeCycleProjectPublicationEvidence> {
		const targetValue = parseScapeProjectDocument(envelope.targetProjectDocument);
		validateProject(targetValue);
		const target = targetValue as AudioEditorProjectV17;
		const current = await loadProject(envelope.projectFence.projectId);
		const currentEvidence = projectEvidence(current);
		if (sameEvidence(currentEvidence, envelope, 'target')) {
			await synchronizePublishedProject(current, envelope, reason);
			return currentEvidence;
		}
		if (!sameEvidence(currentEvidence, envelope, 'base')) {
			throw new Error('Durable project does not match the exact base or target publication fence.');
		}
		const saveIfCurrent = dependencies.projects.saveIfCurrent;
		if (!saveIfCurrent) throw new Error('Exact project compare-and-swap storage is unavailable.');
		const saved = await saveIfCurrent.call(dependencies.projects, current, target);
		if (!saved) {
			const observed = await loadProject(envelope.projectFence.projectId);
			const evidence = projectEvidence(observed);
			if (!sameEvidence(evidence, envelope, 'target')) {
				throw new Error('Durable project changed before exact take cycle publication.');
			}
			await synchronizePublishedProject(observed, envelope, reason);
			return evidence;
		}
		const evidence = projectEvidence(saved);
		if (!sameEvidence(evidence, envelope, 'target')) {
			throw new Error('Project repository changed the exact take cycle target document.');
		}
		await synchronizePublishedProject(saved, envelope, reason);
		return evidence;
	}

	async function synchronizePublishedProject(
		targetValue: ProjectDocument,
		envelope: TakeCycleRecoveryEnvelope,
		reason: 'finalize' | 'recovery',
	): Promise<void> {
		const targetSha256 = envelope.projectFence.targetSha256;
		try {
			if (!dependencies.publishCurrentProject) return;
			validateProject(targetValue);
			const prepared = preparedProjects.get(targetSha256);
			let base: AudioEditorProjectV17;
			let command: AudioEditorCommand | null;
			if (prepared && documentDigest(serializeScapeProjectDocument(prepared.base)) === envelope.projectFence.baseSha256) {
				base = prepared.base;
				command = prepared.command;
			} else {
				const baseValue = await dependencies.projects.load(envelope.projectFence.projectId, {
					revision: envelope.projectFence.baseRevision,
				});
				if (!baseValue || documentDigest(serializeScapeProjectDocument(baseValue)) !== envelope.projectFence.baseSha256) {
					throw new Error('Exact take cycle base revision is unavailable for current-project publication.');
				}
				validateProject(baseValue);
				base = baseValue as AudioEditorProjectV17;
				command = null;
			}
			await dependencies.publishCurrentProject(Object.freeze({
				reason, base, target: targetValue as AudioEditorProjectV17, command,
			}));
		} finally {
			preparedProjects.delete(targetSha256);
		}
	}

	async function loadProject(projectId: string, signal?: AbortSignal): Promise<AudioEditorProjectV17> {
		const value = await dependencies.projects.load(projectId, signal ? { signal } : {});
		if (!value) throw new Error(`Take cycle project ${projectId} is not durably available.`);
		validateProject(value);
		return value as AudioEditorProjectV17;
	}

	function applyProjectCommand(base: AudioEditorProjectV17, command: AudioEditorCommand,
		options: Readonly<{ readonly now?: Date | string }>): AudioEditorProjectV17 {
		return dependencies.applyProjectCommand?.(base, command, options)
			?? applyEditorCommand(base, command, options);
	}

	function validateProject(value: unknown): void {
		if (dependencies.validateProject) dependencies.validateProject(value);
		else validateAudioEditorProjectV17(value);
	}

	async function storedSourceMatches(
		metadata: StorageRecord,
		binding: TakeMediaPublicationBinding,
		signal?: AbortSignal,
	): Promise<boolean> {
		const frameCount = positiveInteger(metadata.frameCount ?? metadata.frameLength, 'stored source frameCount');
		const channelCount = positiveInteger(metadata.channelCount, 'stored source channelCount');
		const chunkFrames = positiveInteger(metadata.chunkFrames, 'stored source chunkFrames');
		const digest = createScapeDigest();
		let byteLength = 0;
		let writtenFrames = 0;
		let chunkIndex = 0;
		for await (const chunk of dependencies.sources.chunks(binding.mediaId, { signal, expectedSource: metadata })) {
			const expectedFrames = Math.min(chunkFrames, frameCount - writtenFrames);
			if (chunk.index !== chunkIndex || chunk.frames !== expectedFrames || expectedFrames < 1
				|| chunk.channels.length !== channelCount
				|| chunk.channels.some((channel) => !(channel instanceof Float32Array)
					|| channel.length !== expectedFrames)) return false;
			const bytes = canonicalChunkBytes(chunk.channels, expectedFrames);
			for (const value of bytes) { digest.update(value); byteLength += value.byteLength; }
			writtenFrames += expectedFrames;
			chunkIndex += 1;
		}
		return writtenFrames === frameCount && byteLength === binding.byteLength
			&& scapeHex(digest.digest()) === binding.sha256;
	}

	function preparedSource(envelope: TakeCycleRecoveryEnvelope, mediaId: string): PreparedSource {
		const source = preparedProjects.get(envelope.projectFence.targetSha256)?.sources.get(mediaId);
		if (!source) throw new Error('Prepared take cycle source geometry is unavailable.');
		return source;
	}
}

function projectCommand(
	base: AudioEditorProjectV17,
	operation: TakeCycleProjectPreparationOperation,
	target: TakeCycleLaneTarget,
	sources: readonly PreparedSource[],
	regionIdValue: string,
): AudioEditorCommand {
	const track = base.tracks.find(({ id }) => id === target.trackId);
	const sequence = base.sequences.find(({ id }) => id === target.sequenceId);
	if (!track || track.type !== 'audio') throw new ReferenceError(`Unknown take cycle audio track: ${target.trackId}.`);
	if (!sequence || !sequence.trackIds.includes(target.trackId)) {
		throw new ReferenceError(`Take cycle track ${target.trackId} does not belong to sequence ${target.sequenceId}.`);
	}
	const sourceCommands = sources.map(({ publication, description }) => ({
		type: 'source/add' as const,
		source: commandObject(createAudioSource({
			id: publication.mediaId,
			storageKey: publication.mediaId,
			name: description.name,
			mimeType: 'audio/wav',
			frameCount: description.frameCount,
			channelCount: description.channelCount,
			sampleRate: description.sampleRate,
			originalSampleRate: description.sampleRate,
			sampleFormat: 'float32',
			chunkFrames: description.chunkFrames,
		})),
	}));
	const takes = operation.plan.passes.map((pass, index) => ({
		id: pass.takeId,
		laneId: pass.laneId,
		sourceId: sources[index]!.publication.mediaId,
		startSample: pass.timelineStartSample,
		endSample: pass.timelineEndSample,
		sourceStartSample: 0,
	}));
	const existing = base.takeGroups.find(({ id }) => id === operation.plan.groupId);
	let group: TakeCompDocumentGroup;
	let groupCommand: AudioEditorCommand;
	if (existing) {
		if (existing.sequenceId !== target.sequenceId || existing.trackId !== target.trackId
			|| existing.startSample !== operation.plan.loopStartSample
			|| existing.endSample !== operation.plan.loopEndSample) {
			throw new Error('Take cycle lane does not match its existing group ownership and extent.');
		}
		const repeatedLaneId = operation.plan.laneIds.find((laneId) => (
			existing.lanes.some(({ id }) => id === laneId)
		));
		if (repeatedLaneId) {
			throw new Error(`Take cycle lane ${repeatedLaneId} already exists.`);
		}
		group = {
			...existing,
			laneOrder: [...existing.laneOrder, ...operation.plan.laneIds],
			lanes: [...existing.lanes, ...operation.plan.laneIds.map((id) => ({ id }))],
			takes: [...existing.takes, ...takes],
		};
		groupCommand = {
			type: 'take-comp/group-update', groupId: existing.id, group: commandObject(group),
		};
	} else {
		const first = takes[0]!;
		group = {
			id: operation.plan.groupId,
			sequenceId: target.sequenceId,
			trackId: target.trackId,
			startSample: operation.plan.loopStartSample,
			endSample: operation.plan.loopEndSample,
			laneOrder: [...operation.plan.laneIds],
			lanes: operation.plan.laneIds.map((id) => ({ id })),
			takes,
			compRegions: [{
				id: normalizeCompRegionId(regionIdValue),
				takeId: first.id,
				startSample: first.startSample,
				endSample: first.endSample,
			}],
		};
		groupCommand = { type: 'take-comp/group-add', group: commandObject(group) };
	}
	return { type: 'batch', commands: [...sourceCommands, groupCommand] };
}

async function writeExactPcm(
	writer: OwnedAudioSourceWriter,
	iterable: AsyncIterable<readonly Float32Array[]>,
	source: PreparedSource,
	signal: AbortSignal,
): Promise<void> {
	if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') {
		throw new TypeError('Take cycle PCM capture must be an async iterable.');
	}
	const digest = createScapeDigest();
	let byteLength = 0;
	let writtenFrames = 0;
	for await (const input of iterable) {
		throwIfAborted(signal);
		const remaining = source.description.frameCount - writtenFrames;
		const expectedFrames = Math.min(source.description.chunkFrames, remaining);
		const channels = snapshotChannels(input, source.description.channelCount, expectedFrames);
		const bytes = canonicalChunkBytes(channels, expectedFrames);
		for (const value of bytes) { digest.update(value); byteLength += value.byteLength; }
		await writer.write(channels, { signal });
		writtenFrames += expectedFrames;
	}
	if (writtenFrames !== source.description.frameCount
		|| byteLength !== source.publication.byteLength
		|| scapeHex(digest.digest()) !== source.publication.sha256) {
		throw new Error('Captured take cycle PCM does not match its exact media descriptor.');
	}
}

function canonicalChunkBytes(
	channels: readonly Float32Array[],
	frameCount: number,
): readonly Uint8Array[] {
	const header = new Uint8Array(4);
	new DataView(header.buffer).setUint32(0, frameCount, true);
	return Object.freeze([header, new Uint8Array(packPlanarFloat32([...channels]))]);
}

function snapshotChannels(
	value: readonly Float32Array[],
	channelCount: number,
	frameCount: number,
): readonly Float32Array[] {
	if (!Array.isArray(value) || value.length !== channelCount || frameCount < 1
		|| value.some((channel) => !(channel instanceof Float32Array) || channel.length !== frameCount)) {
		throw new Error('Take cycle PCM chunk has noncanonical channel geometry.');
	}
	return Object.freeze(value.map((channel) => channel.slice()));
}

function normalizeLaneTarget(value: TakeCycleLaneTarget): TakeCycleLaneTarget {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Take cycle lane target is required.');
	}
	return Object.freeze({
		sequenceId: stableId(value.sequenceId, 'take cycle sequence ID'),
		trackId: stableId(value.trackId, 'take cycle track ID'),
	});
}

function sourceMetadata(description: TakeCycleSourceDescription): Record<string, unknown> {
	return {
		name: description.name,
		mimeType: 'audio/wav',
		sampleRate: description.sampleRate,
		channelCount: description.channelCount,
		chunkFrames: description.chunkFrames,
	};
}

function projectEvidence(project: ProjectDocument): TakeCycleProjectPublicationEvidence {
	const document = serializeScapeProjectDocument(project);
	return Object.freeze({
		projectId: project.id,
		revision: nonNegativeInteger(project.revision, 'project revision'),
		sha256: documentDigest(document),
	});
}

function sameEvidence(
	evidence: TakeCycleProjectPublicationEvidence,
	envelope: TakeCycleRecoveryEnvelope,
	kind: 'base' | 'target',
): boolean {
	return evidence.projectId === envelope.projectFence.projectId
		&& evidence.revision === (kind === 'base'
			? envelope.projectFence.baseRevision : envelope.projectFence.targetRevision)
		&& evidence.sha256 === (kind === 'base'
			? envelope.projectFence.baseSha256 : envelope.projectFence.targetSha256);
}

function documentDigest(document: string): string {
	return digestScapeBytes(TEXT_ENCODER.encode(document));
}

function commandObject(value: object): CommandObject {
	return value as unknown as CommandObject;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > 160
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

async function abortWriter(writer: OwnedAudioSourceWriter, primary: unknown): Promise<never> {
	try {
		await writer.abort();
	} catch (cleanup) {
		throw new AggregateError([primary, cleanup], 'Take cycle PCM staging and cleanup both failed.');
	}
	throw primary;
}

function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	throw signal.reason instanceof Error ? signal.reason : new DOMException('Take cycle recording aborted.', 'AbortError');
}
