/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES,
	planExactTakeCycleCapture,
	type ExactTakeCycleCapturePlan,
	type TakeCycleCaptureSpan,
} from '../take-cycle-capture-domain.ts';
import {
	createTakeCycleRecoveryEnvelope,
	planTakeCycleEnvelopeRecovery,
	transitionTakeCycleRecoveryEnvelopeMedia,
	transitionTakeCycleRecoveryEnvelopeProject,
	type TakeCycleEnvelopeRecoveryPlan,
	type TakeCycleProjectPublicationEvidence,
	type TakeCycleRecoveryEnvelope,
	type TakeCycleRecoveryEnvelopePublication,
} from '../take-cycle-recovery-envelope.ts';
import {
	createTakeMediaPublicationJournal,
	type TakeMediaPublicationBinding,
} from '../take-media-recovery-journal.ts';
import type {
	EditorTaskScope,
} from './lifecycle.ts';
import type {
	MaybePromise,
	TakeCycleFinalizationRequest,
	TakeCycleFinalizationResult,
	TakeCycleLaneFinalizationResult,
	TakeCycleOperationOwnership,
	TakeCyclePassOperation,
	TakeCyclePublicationDescriptor,
	TakeCycleRecordingOptions,
	TakeCycleRecordingService,
	TakeCycleRecordingServiceDependencies,
	TakeCycleRecoveryRequest,
} from './take-cycle-recording-service-types.ts';

export type * from './take-cycle-recording-service-types.ts';

export const TAKE_CYCLE_RECORDING_TASK = 'take-cycle-recording';

interface PreparedLane {
	readonly laneIndex: number;
	readonly envelopeId: string;
	readonly plan: ExactTakeCycleCapturePlan;
	readonly captureSpans: readonly TakeCycleCaptureSpan[];
	readonly publications: readonly TakeCyclePublicationDescriptor[];
}

export function createTakeCycleRecordingService(
	dependencies: TakeCycleRecordingServiceDependencies,
): Readonly<TakeCycleRecordingService> {
	return Object.freeze({ finalize, recover, cancel });

	async function finalize(
		request: TakeCycleFinalizationRequest,
		options: TakeCycleRecordingOptions = {},
	): Promise<TakeCycleFinalizationResult> {
		const prepared = prepareFinalization(request);
		const operation = beginOperation(options.signal);
		try {
			const active = await callOwned(
				operation.ownership,
				() => dependencies.recoveryRepository.load(operation.ownership.projectToken.projectId),
			);
			if (active) throw new Error('Take cycle recovery must settle before a new finalization.');
			const lanes: TakeCycleLaneFinalizationResult[] = [];
			for (const lane of prepared.lanes) {
				operation.ownership.assertCurrent();
				lanes.push(await finalizeLane(lane, prepared.generation, operation.ownership));
			}
			return Object.freeze({
				kind: 'take-cycle-finalization',
				generation: prepared.generation,
				lanes: Object.freeze(lanes),
			});
		} finally {
			operation.task.finish();
		}
	}

	async function recover(
		request: TakeCycleRecoveryRequest,
		options: TakeCycleRecordingOptions = {},
	): Promise<TakeCycleEnvelopeRecoveryPlan> {
		validateRecoveryRequest(request);
		const operation = beginOperation(options.signal);
		try {
			const envelope = await callOwned(
				operation.ownership,
				() => dependencies.recoveryRepository.load(operation.ownership.projectToken.projectId),
			);
			if (!envelope) {
				return planTakeCycleEnvelopeRecovery(null, {
					...request, mediaEvidence: [], projectEvidence: null,
				});
			}
			const observation = await inspectRecovery(envelope, operation.ownership);
			const plan = planTakeCycleEnvelopeRecovery(envelope, { ...request, ...observation });
			await executeRecovery(plan, envelope, operation.ownership);
			return plan;
		} finally {
			operation.task.finish();
		}
	}

	function cancel(
		reason: unknown = new DOMException('Take cycle recording cancelled.', 'AbortError'),
	): void {
		dependencies.lifetime.cancelTask(TAKE_CYCLE_RECORDING_TASK, reason);
	}

	async function finalizeLane(
		lane: PreparedLane,
		generation: number,
		ownership: TakeCycleOperationOwnership,
	): Promise<TakeCycleLaneFinalizationResult> {
		let envelope: TakeCycleRecoveryEnvelope;
		try {
			envelope = await prepareEnvelope(lane, generation, ownership);
		} catch (error) {
			ownership.assertCurrent();
			return freezeLaneResult(lane, 'failed', [], error);
		}
		await callOwned(ownership, () => dependencies.recoveryRepository.create(envelope));
		try {
			for (let entryIndex = 0; entryIndex < envelope.entries.length; entryIndex += 1) {
				await callOwned(ownership, () => dependencies.stageMedia(passOperation(
					envelope, lane, entryIndex, ownership,
				)));
			}
			for (let entryIndex = 0; entryIndex < envelope.entries.length; entryIndex += 1) {
				const evidence = await callOwned(ownership, () => dependencies.publishMedia(passOperation(
					envelope, lane, entryIndex, ownership,
				)));
				const published = transitionTakeCycleRecoveryEnvelopeMedia(envelope, {
					entryIndex, currentGeneration: generation, evidence,
				});
				envelope = await callOwned(
					ownership,
					() => dependencies.recoveryRepository.replace(envelope, published),
				);
			}
			const evidence = await callOwned(ownership, () => dependencies.publishProject(Object.freeze({
				ownership,
				laneIndex: lane.laneIndex,
				plan: lane.plan,
				envelope,
				targetProjectDocument: envelope.targetProjectDocument,
			})));
			const committed = transitionTakeCycleRecoveryEnvelopeProject(envelope, {
				currentGeneration: generation, evidence,
			});
			envelope = await callOwned(
				ownership,
				() => dependencies.recoveryRepository.replace(envelope, committed),
			);
			await callOwned(ownership, () => dependencies.recoveryRepository.remove(envelope));
			return freezeLaneResult(
				lane,
				'committed',
				envelope.entries.map(({ journal }) => journal.binding),
				null,
			);
		} catch (error) {
			ownership.assertCurrent();
			return reconcileLaneFailure(lane, envelope, error, ownership);
		}
	}

	async function prepareEnvelope(
		lane: PreparedLane,
		generation: number,
		ownership: TakeCycleOperationOwnership,
	): Promise<TakeCycleRecoveryEnvelope> {
		const base = Object.freeze({ ownership, laneIndex: lane.laneIndex, plan: lane.plan });
		const project = await callOwned(
			ownership,
			() => dependencies.prepareProjectPublication(base),
		);
		if (project.projectFence.projectId !== ownership.projectToken.projectId) {
			throw new Error('Take cycle project fence does not own the active editor project.');
		}
		const publications: TakeCycleRecoveryEnvelopePublication[] = [];
		for (let entryIndex = 0; entryIndex < lane.publications.length; entryIndex += 1) {
			const publication = lane.publications[entryIndex]!;
			const stageReceipt = await callOwned(ownership, () => dependencies.createMediaStageReceipt(
				Object.freeze({ ...base, pass: lane.plan.passes[entryIndex]!, publication }),
			));
			publications.push(Object.freeze({
				journalId: publication.journalId,
				mediaId: publication.mediaId,
				byteLength: publication.byteLength,
				sha256: publication.sha256,
				stageReceipt,
			}));
		}
		return createTakeCycleRecoveryEnvelope({
			envelopeId: lane.envelopeId,
			generation,
			captureRequest: {
				groupId: lane.plan.groupId,
				laneId: lane.plan.laneId,
				loopStartSample: lane.plan.loopStartSample,
				loopEndSample: lane.plan.loopEndSample,
				captureSpans: lane.captureSpans,
				takeIds: lane.plan.passes.map(({ takeId }) => takeId),
				interrupted: lane.plan.interrupted,
			},
			publications,
			...project,
		});
	}

	async function reconcileLaneFailure(
		lane: PreparedLane,
		envelope: TakeCycleRecoveryEnvelope,
		primary: unknown,
		ownership: TakeCycleOperationOwnership,
	): Promise<TakeCycleLaneFinalizationResult> {
		try {
			const observation = await inspectRecovery(envelope, ownership);
			const recovered = planTakeCycleEnvelopeRecovery(envelope, {
				currentGeneration: envelope.generation,
				decision: 'recover',
				...observation,
			});
			if (recovered.disposition === 'settle-committed') {
				await executeRecovery(recovered, envelope, ownership);
				return freezeLaneResult(
					lane,
					'committed',
					envelope.entries.map(({ journal }) => journal.binding),
					null,
				);
			}
			const discarded = planTakeCycleEnvelopeRecovery(envelope, {
				currentGeneration: envelope.generation,
				decision: 'discard',
				...observation,
			});
			await executeRecovery(discarded, envelope, ownership);
			return freezeLaneResult(lane, 'failed', [], primary);
		} catch (cleanupError) {
			throw new AggregateError(
				[primary, cleanupError],
				'Take cycle lane finalization failed and exact recovery did not settle.',
			);
		}
	}

	async function inspectRecovery(
		envelope: TakeCycleRecoveryEnvelope,
		ownership: TakeCycleOperationOwnership,
	): Promise<Readonly<{
		readonly mediaEvidence: readonly (TakeMediaPublicationBinding | null)[];
		readonly projectEvidence: TakeCycleProjectPublicationEvidence | null;
	}>> {
		const mediaEvidence: (TakeMediaPublicationBinding | null)[] = [];
		for (let entryIndex = 0; entryIndex < envelope.entries.length; entryIndex += 1) {
			mediaEvidence.push(await callOwned(ownership, () => dependencies.inspectMedia(Object.freeze({
				ownership,
				envelope,
				entryIndex,
				binding: envelope.entries[entryIndex]!.journal.binding,
			}))));
		}
		const projectEvidence = await callOwned(
			ownership,
			() => dependencies.inspectProject(Object.freeze({ ownership, envelope })),
		);
		return Object.freeze({ mediaEvidence: Object.freeze(mediaEvidence), projectEvidence });
	}

	async function executeRecovery(
		plan: TakeCycleEnvelopeRecoveryPlan,
		expectedEnvelope: TakeCycleRecoveryEnvelope,
		ownership: TakeCycleOperationOwnership,
	): Promise<void> {
		for (const action of plan.actions) {
			if (action.kind === 'remove-recovery-envelope') {
				await callOwned(
					ownership,
					() => dependencies.recoveryRepository.remove(expectedEnvelope),
				);
				continue;
			}
			if (action.kind === 'replay-project-commit') {
				const evidence = await callOwned(
					ownership,
					() => dependencies.replayProjectCommit(Object.freeze({
						ownership, envelope: expectedEnvelope, action,
					})),
				);
				transitionTakeCycleRecoveryEnvelopeProject(action.envelope, {
					currentGeneration: action.envelope.generation,
					evidence,
				});
				continue;
			}
			const cleaned = action.kind === 'cleanup-staged-media'
				? await callOwned(ownership, () => dependencies.cleanupStagedMedia(Object.freeze({
					ownership, envelope: expectedEnvelope, action,
				})))
				: await callOwned(ownership, () => dependencies.cleanupPublishedMedia(Object.freeze({
					ownership, envelope: expectedEnvelope, action,
				})));
			if (!cleaned) throw new Error('Exact take cycle media cleanup refused stale ownership.');
		}
	}

	function beginOperation(externalSignal?: AbortSignal): Readonly<{
		readonly task: EditorTaskScope;
		readonly ownership: TakeCycleOperationOwnership;
	}> {
		const projectToken = dependencies.captureProject();
		const task = dependencies.lifetime.startTask(TAKE_CYCLE_RECORDING_TASK);
		const signal = externalSignal ? AbortSignal.any([task.signal, externalSignal]) : task.signal;
		const ownership = Object.freeze({
			projectToken,
			signal,
			assertCurrent(): void {
				throwIfAborted(signal);
				task.assertCurrent();
				dependencies.assertProject(projectToken);
			},
		});
		try {
			ownership.assertCurrent();
			return Object.freeze({ task, ownership });
		} catch (error) {
			task.finish();
			throw error;
		}
	}
}

async function callOwned<Value>(
	ownership: TakeCycleOperationOwnership,
	callback: () => MaybePromise<Value>,
): Promise<Value> {
	ownership.assertCurrent();
	const result = await callback();
	ownership.assertCurrent();
	return result;
}

function passOperation(
	envelope: TakeCycleRecoveryEnvelope,
	lane: PreparedLane,
	entryIndex: number,
	ownership: TakeCycleOperationOwnership,
): TakeCyclePassOperation {
	return Object.freeze({
		ownership,
		laneIndex: lane.laneIndex,
		plan: lane.plan,
		pass: lane.plan.passes[entryIndex]!,
		envelope,
		entryIndex,
	});
}

function prepareFinalization(request: TakeCycleFinalizationRequest): Readonly<{
	readonly generation: number;
	readonly lanes: readonly PreparedLane[];
}> {
	const generation = positiveSafeInteger(request.publicationGeneration, 'take cycle publicationGeneration');
	const laneRequests = denseSnapshot(request.lanes, 'take cycle finalization lanes');
	if (laneRequests.length === 0) throw new RangeError('Take cycle finalization requires at least one lane.');
	const identityKinds = new Map<string, string>();
	const lanes = laneRequests.map((lane, laneIndex): PreparedLane => {
		const publicationValues = denseSnapshot(lane.publications, 'take cycle lane publications');
		const plan = planExactTakeCycleCapture({
			groupId: lane.groupId,
			laneId: lane.laneId,
			loopStartSample: lane.loopStartSample,
			loopEndSample: lane.loopEndSample,
			captureSpans: lane.captureSpans,
			takeIds: publicationValues.map(({ takeId }) => takeId),
			interrupted: lane.interrupted,
		});
		const captureSpans = snapshotSpans(lane.captureSpans);
		registerIdentity(identityKinds, plan.groupId, 'group', true);
		registerIdentity(identityKinds, plan.laneId, 'lane');
		const envelopeId = stableIdentity(lane.envelopeId, 'take cycle envelopeId');
		registerIdentity(identityKinds, envelopeId, 'envelope');
		const publications = publicationValues.map((value, entryIndex) => {
			const publication = Object.freeze({
				journalId: value.journalId,
				takeId: value.takeId,
				mediaId: value.mediaId,
				byteLength: value.byteLength,
				sha256: value.sha256,
			});
			const journal = createTakeMediaPublicationJournal({
				journalId: publication.journalId,
				binding: {
					generation,
					groupId: plan.groupId,
					laneId: plan.laneId,
					takeId: plan.passes[entryIndex]!.takeId,
					mediaId: publication.mediaId,
					byteLength: publication.byteLength,
					sha256: publication.sha256,
				},
			});
			registerIdentity(identityKinds, journal.journalId, 'journal');
			registerIdentity(identityKinds, journal.binding.takeId, 'take');
			registerIdentity(identityKinds, journal.binding.mediaId, 'media');
			return publication;
		});
		return Object.freeze({
			laneIndex,
			envelopeId,
			plan,
			captureSpans,
			publications: Object.freeze(publications),
		});
	});
	return Object.freeze({ generation, lanes: Object.freeze(lanes) });
}

function snapshotSpans(value: readonly TakeCycleCaptureSpan[]): readonly TakeCycleCaptureSpan[] {
	return Object.freeze(denseSnapshot(value, 'take cycle capture spans').map((span) => Object.freeze({
		startSample: span.startSample,
		endSample: span.endSample,
	})));
}

function validateRecoveryRequest(request: TakeCycleRecoveryRequest): void {
	positiveSafeInteger(request.currentGeneration, 'take cycle recovery currentGeneration');
	if (request.decision !== 'recover' && request.decision !== 'discard') {
		throw new RangeError('Take cycle recovery decision must be recover or discard.');
	}
}

function freezeLaneResult(
	lane: PreparedLane,
	status: 'committed' | 'failed',
	committedPasses: readonly TakeMediaPublicationBinding[],
	error: unknown | null,
): TakeCycleLaneFinalizationResult {
	return Object.freeze({
		groupId: lane.plan.groupId,
		laneId: lane.plan.laneId,
		status,
		committedPasses: Object.freeze([...committedPasses]),
		error,
	});
}

function registerIdentity(
	kinds: Map<string, string>,
	identity: string,
	kind: string,
	allowRepeatedKind = false,
): void {
	const previous = kinds.get(identity);
	if (previous === undefined) {
		kinds.set(identity, kind);
		return;
	}
	if (allowRepeatedKind && previous === kind) return;
	throw new RangeError(previous === kind
		? `identity ${identity} is reused across ${kind} ownership`
		: `identity ${identity} is reused across ${previous} and ${kind} ownership`);
}

function denseSnapshot<Value>(value: readonly Value[], name: string): readonly Value[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > TAKE_CYCLE_CAPTURE_MAXIMUM_PASSES
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`${name} must be a bounded standard dense data array.`);
	}
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain only enumerable data items.`);
		}
	}
	return Object.freeze([...value]);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function stableIdentity(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`${name} must be a canonical stable identity.`);
	}
	return value;
}

function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	throw signal.reason instanceof Error
		? signal.reason
		: new DOMException('Take cycle recording aborted.', 'AbortError');
}
