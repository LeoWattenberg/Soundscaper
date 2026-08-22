/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertNativeMediaRelativeDestination,
	createNativeMediaPublicationPlan,
	evaluateNativeMediaPublication,
	type NativeMediaPublicationPlanV1,
} from '../src/common/editor/native-media-atomic-publication.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_CHECKPOINT_FRAMES = 2_000_000;

export interface FramescaperNativePublishedFileObservation {
	readonly byteLength: number;
	readonly sha256: string;
	readonly symbolicLink: boolean;
}

export interface FramescaperNativePublicationPort {
	readonly inspect: (
		relativePath: string,
	) => Promise<FramescaperNativePublishedFileObservation | null>;
	/** Must be a same-directory, no-replace atomic rename. */
	readonly renameTemporarySibling: (
		temporaryRelativePath: string,
		relativeDestination: string,
	) => Promise<void>;
	/** Remove only the exact output this publication just created. */
	readonly removePublishedOutput: (
		relativeDestination: string,
		expected: FramescaperNativePublishedFileObservation,
	) => Promise<void>;
}

export interface FramescaperNativePublicationFence {
	/** Revalidate the live writer, queue row, policy, and root immediately before rename. */
	readonly beforePublication: () => Promise<void>;
	/** Repeat the same checks immediately after rename and before durable advertisement. */
	readonly afterPublication: () => Promise<void>;
}

export interface FramescaperNativePublicationRequest {
	readonly plan: NativeMediaPublicationPlanV1;
	readonly currentPlanFingerprint: string;
	readonly finalized: boolean;
	readonly declaredByteLength: number;
	readonly declaredSha256: string;
}

export type FramescaperNativePublicationResult = Readonly<{
	readonly outcome: 'published' | 'already-published';
	readonly relativeDestination: string;
	readonly byteLength: number;
	readonly sha256: string;
}>;

/**
 * Publish one helper output, or reconcile the exact final file left by a crash
 * between rename and the durable queue completion update.
 */
export async function publishVerifiedNativeMediaOutput(
	request: FramescaperNativePublicationRequest,
	port: FramescaperNativePublicationPort,
	fence?: FramescaperNativePublicationFence,
): Promise<FramescaperNativePublicationResult> {
	const plan = exactPublicationPlan(request.plan);
	const declaredByteLength = byteCount(request.declaredByteLength, 'declared output length');
	const declaredSha256 = digest(request.declaredSha256, 'declared output');
	const destination = await port.inspect(plan.relativeDestination);
	if (destination !== null) {
		assertRegularOutput(destination, 'published destination');
		if (destination.byteLength !== declaredByteLength || destination.sha256 !== declaredSha256) {
			throw new Error('The native media destination already contains a different output.');
		}
		assertPublicationVerdict(request, plan, destination);
		await fence?.beforePublication();
		await fence?.afterPublication();
		return result('already-published', plan, destination);
	}
	const temporary = await port.inspect(plan.temporaryRelativePath);
	if (temporary === null) throw new Error('The verified native media temporary sibling is missing.');
	assertRegularOutput(temporary, 'temporary sibling');
	assertPublicationVerdict(request, plan, temporary);
	await fence?.beforePublication();
	await port.renameTemporarySibling(plan.temporaryRelativePath, plan.relativeDestination);
	const published = await port.inspect(plan.relativeDestination);
	if (published === null) throw new Error('The native media atomic publication did not materialize its destination.');
	assertRegularOutput(published, 'published destination');
	if (published.byteLength !== temporary.byteLength || published.sha256 !== temporary.sha256) {
		throw new Error('The native media output changed during atomic publication.');
	}
	try {
		await fence?.afterPublication();
	} catch (fenceError) {
		try {
			await port.removePublishedOutput(plan.relativeDestination, published);
		} catch (cleanupError) {
			throw new AggregateError(
				[fenceError, cleanupError],
				'Native media publication lost its fence and its exact output could not be removed.',
			);
		}
		throw fenceError;
	}
	return result('published', plan, published);
}

export interface NativeImageSequenceCheckpointFrameV1 {
	readonly frameIndex: number;
	readonly relativePath: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly planFingerprint: string;
	readonly sourceInventoryDigest: string;
}

export interface NativeImageSequenceCheckpointRequestV1 {
	readonly planFingerprint: string;
	readonly sourceInventoryDigest: string;
	readonly plannedFrameCount: number;
	readonly manifest: readonly NativeImageSequenceCheckpointFrameV1[];
	readonly inspect: (
		frame: NativeImageSequenceCheckpointFrameV1,
	) => Promise<FramescaperNativePublishedFileObservation | null>;
}

export interface NativeImageSequenceCheckpointResultV1 {
	readonly verifiedFrameCount: number;
	readonly plannedFrameCount: number;
	readonly complete: boolean;
}

export interface NativeImageSequenceCheckpointManifestAdmissionV1 {
	readonly planFingerprint: string;
	readonly sourceInventoryDigest: string;
	readonly plannedFrameCount: number;
	readonly manifest: readonly NativeImageSequenceCheckpointFrameV1[];
}

/** Normalize the exact contiguous prefix before filesystem work or durable admission. */
export function admitNativeImageSequenceCheckpointManifest(
	request: NativeImageSequenceCheckpointManifestAdmissionV1,
): NativeImageSequenceCheckpointManifestAdmissionV1 {
	const planFingerprint = digest(request.planFingerprint, 'checkpoint plan');
	const sourceInventoryDigest = digest(request.sourceInventoryDigest, 'checkpoint source inventory');
	const plannedFrameCount = frameCount(request.plannedFrameCount, 'planned frame count');
	if (!Array.isArray(request.manifest) || request.manifest.length > plannedFrameCount
		|| Reflect.ownKeys(request.manifest).length !== request.manifest.length + 1) {
		throw new RangeError('An image-sequence checkpoint manifest exceeds its planned frame count.');
	}
	return Object.freeze({
		planFingerprint,
		sourceInventoryDigest,
		plannedFrameCount,
		manifest: Object.freeze(request.manifest.map((entry, frameIndex) => (
			admitCheckpointFrame(entry, frameIndex, planFingerprint, sourceInventoryDigest)
		))),
	});
}

/** Verify only a contiguous prefix; a hole never lets later frames skip ahead. */
export async function verifyNativeImageSequenceCheckpoint(
	request: NativeImageSequenceCheckpointRequestV1,
): Promise<NativeImageSequenceCheckpointResultV1> {
	const admitted = admitNativeImageSequenceCheckpointManifest(request);
	let verifiedFrameCount = 0;
	for (const frame of admitted.manifest) {
		const observed = await request.inspect(frame);
		if (observed === null || observed.symbolicLink
			|| observed.byteLength !== frame.byteLength || observed.sha256 !== frame.sha256) break;
		verifiedFrameCount += 1;
	}
	return Object.freeze({
		verifiedFrameCount,
		plannedFrameCount: admitted.plannedFrameCount,
		complete: admitted.plannedFrameCount > 0
			&& verifiedFrameCount === admitted.plannedFrameCount,
	});
}

function exactPublicationPlan(value: NativeMediaPublicationPlanV1): NativeMediaPublicationPlanV1 {
	const exact = createNativeMediaPublicationPlan({
		jobId: value.jobId,
		relativeDestination: value.relativeDestination,
		planFingerprint: value.planFingerprint,
	});
	if (value.temporaryRelativePath !== exact.temporaryRelativePath
		|| Object.keys(value).sort().join('|') !== [
			'jobId', 'planFingerprint', 'relativeDestination', 'temporaryRelativePath',
		].sort().join('|')) {
		throw new TypeError('A native media publication plan is not its exact canonical shape.');
	}
	return exact;
}

function assertPublicationVerdict(
	request: FramescaperNativePublicationRequest,
	plan: NativeMediaPublicationPlanV1,
	observed: FramescaperNativePublishedFileObservation,
): void {
	const verdict = evaluateNativeMediaPublication({
		plan,
		outcome: 'completed',
		currentPlanFingerprint: request.currentPlanFingerprint,
		finalized: request.finalized,
		declaredByteLength: request.declaredByteLength,
		observedByteLength: observed.byteLength,
		declaredSha256: request.declaredSha256,
		observedSha256: observed.sha256,
	});
	if (!verdict.publish) {
		throw new Error(`Native media publication was refused: ${verdict.refusals.join(', ')}.`);
	}
}

function result(
	outcome: FramescaperNativePublicationResult['outcome'],
	plan: NativeMediaPublicationPlanV1,
	observation: FramescaperNativePublishedFileObservation,
): FramescaperNativePublicationResult {
	return Object.freeze({
		outcome,
		relativeDestination: plan.relativeDestination,
		byteLength: observation.byteLength,
		sha256: observation.sha256,
	});
}

function admitCheckpointFrame(
	value: NativeImageSequenceCheckpointFrameV1,
	expectedIndex: number,
	planFingerprint: string,
	sourceInventoryDigest: string,
): NativeImageSequenceCheckpointFrameV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).sort().join('|') !== [
			'frameIndex', 'relativePath', 'byteLength', 'sha256',
			'planFingerprint', 'sourceInventoryDigest',
		].sort().join('|')) {
		throw new TypeError('An image-sequence checkpoint frame is not an exact record.');
	}
	if (value.frameIndex !== expectedIndex) {
		throw new Error('An image-sequence checkpoint manifest must be a contiguous zero-based prefix.');
	}
	if (digest(value.planFingerprint, 'frame plan') !== planFingerprint
		|| digest(value.sourceInventoryDigest, 'frame source inventory') !== sourceInventoryDigest) {
		throw new Error('An image-sequence checkpoint frame is stale against its plan or source inventory.');
	}
	return Object.freeze({
		frameIndex: expectedIndex,
		relativePath: assertNativeMediaRelativeDestination(value.relativePath),
		byteLength: byteCount(value.byteLength, 'checkpoint frame length'),
		sha256: digest(value.sha256, 'checkpoint frame'),
		planFingerprint,
		sourceInventoryDigest,
	});
}

function assertRegularOutput(observation: FramescaperNativePublishedFileObservation, label: string): void {
	byteCount(observation.byteLength, `${label} length`);
	digest(observation.sha256, label);
	if (observation.symbolicLink) throw new Error(`The native media ${label} must not be a symbolic link.`);
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`The native media ${label} requires an exact lowercase SHA-256 digest.`);
	}
	return value;
}

function byteCount(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`The native media ${label} must be a non-negative safe integer.`);
	}
	return value as number;
}

function frameCount(value: unknown, label: string): number {
	const count = byteCount(value, label);
	if (count > MAXIMUM_CHECKPOINT_FRAMES) {
		throw new RangeError('An image-sequence checkpoint exceeds its frame ceiling.');
	}
	return count;
}
