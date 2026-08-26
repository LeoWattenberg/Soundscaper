/* SPDX-License-Identifier: AGPL-3.0-only */

/** Menu-only selected-V28 admission of one exact V14 render queue job. */

import { canonicalizeNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../common/editor/native-media-plan-envelope-v2.ts';
import { nativeMediaV14RequiresEvaluatedCarrier } from '../common/editor/native-media-v14-render-family.ts';
import {
	NATIVE_MEDIA_CAPABILITY_IDS,
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
} from '../common/editor/native-media-capability-snapshot.ts';
import type {
	NativeQueueInputFingerprintV1,
} from '../common/editor/native-queue-record.ts';
import {
	bindFramescaperNativeCarrierRegeneration,
	bindFramescaperNativeProjectActionRuntime,
	createFramescaperNativeProjectActionSubsetRuntime,
	type FramescaperNativeProjectActionRuntime,
} from '../common/editor/ui/framescaper-native-project-actions.ts';
import {
	createFramescaperNativeServicesStore,
	resolveFramescaperNativeServicesBridge,
	type FramescaperNativeServicesBridge,
	type FramescaperNativeServicesRendererSnapshot,
} from '../common/editor/ui/framescaper-native-services-bridge.ts';
import {
	createFramescaperNativeServicesLifecycleStore,
	type FramescaperNativeQueueEnqueueRendererRequest,
	type FramescaperNativeRootProjection,
} from '../common/editor/ui/framescaper-native-services-lifecycle-bridge.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from './editor-native-render-plan-authority-v28.ts';
import {
	snapshotFramescaperNativeRenderDeliveryRequestV28,
	type FramescaperNativeRenderDeliveryRequestV28,
} from './editor-native-project-action-requests-v28.ts';
import type {
	FramescaperNativeRenderAudioInputStreamV28,
	FramescaperNativeRenderInputStreamV28,
} from './editor-native-render-input-stream-producer-v28.ts';
import { FRAMESCAPER_V28_RENDER_QUEUE_RESERVATIONS } from './editor-native-render-queue-reservations-v28.ts';
import type { FramescaperNativeRgbaFramePackV1Sink } from './native-render-frame-pack-v1.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from './editor-project-unified-render-plan-v28.ts';
import { cloneFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';

const SURFACES = Object.freeze(['render-queue-enqueue'] as const);
const SHA256 = /^[a-f0-9]{64}$/u;

export { FRAMESCAPER_V28_RENDER_QUEUE_RESERVATIONS } from './editor-native-render-queue-reservations-v28.ts';

export interface FramescaperNativeRenderQueueProjectOwnerV28 {
	readonly project: unknown;
	readonly prepareNativeRenderInputStreamV28?: (request: Readonly<{
		readonly planPayload: string;
		readonly planFingerprint: string;
		readonly projectId: string;
		readonly projectRevision: number;
	}>) => Promise<FramescaperNativeRenderInputStreamV28>;
}

interface QueueSnapshotV28 {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly planFingerprint: string;
	readonly planPayload: string;
	readonly inputFingerprints: readonly NativeQueueInputFingerprintV1[];
	readonly delivery: FramescaperNativeRenderDeliveryRequestV28;
}

/** Bind without creating chrome; the existing File > Export menu is the only caller. */
export function bindFramescaperNativeRenderQueueActionV28(
	profile: unknown,
	owner: FramescaperNativeRenderQueueProjectOwnerV28,
): FramescaperNativeProjectActionRuntime {
	const runtime = createFramescaperNativeRenderQueueActionRuntimeV28(profile, owner);
	bindFramescaperNativeProjectActionRuntime(owner as object, runtime);
	return runtime;
}

/** Create the exact action slice used by deferred selected-F31 composition. */
export function createFramescaperNativeRenderQueueActionRuntimeV28(
	profile: unknown,
	owner: FramescaperNativeRenderQueueProjectOwnerV28,
): FramescaperNativeProjectActionRuntime {
	if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')) {
		throw new TypeError('The selected V28 render queue requires its controller owner.');
	}
	const enqueue = serialize((delivery: FramescaperNativeRenderDeliveryRequestV28) => (
		enqueueCurrentProject(profile, owner, delivery)
	));
	const runtime = createFramescaperNativeProjectActionSubsetRuntime(SURFACES, {
		'render-queue-enqueue': (request) => enqueue(
			snapshotFramescaperNativeRenderDeliveryRequestV28(request),
		),
	});
	bindFramescaperNativeCarrierRegeneration(runtime,
		async (jobId) => enqueueCurrentProject(
			profile, owner, await recoverableDelivery(profile, owner, jobId), jobId,
		));
	return runtime;
}

async function enqueueCurrentProject(
	profile: unknown,
	owner: FramescaperNativeRenderQueueProjectOwnerV28,
	delivery: FramescaperNativeRenderDeliveryRequestV28,
	expectedRestartJobId: string | null = null,
): Promise<void> {
	const bridge = exactBridge();
	const first = queueSnapshot(profile, owner.project, delivery);
	const store = createFramescaperNativeServicesStore(bridge);
	const services = await store.refresh();
	assertQueueRuntime(services);
	const restartJobId = recoverableCarrierJob(first, services.services.queue);
	if (expectedRestartJobId !== null && restartJobId !== expectedRestartJobId) {
		throw new Error('The selected V28 carrier regeneration no longer matches its exact paused queue job.');
	}
	if (!bridge.selectRoot || !bridge.revalidateRoot || !bridge.enqueue) {
		throw new Error('This authenticated desktop bridge cannot enqueue selected V14 renders.');
	}
	const selected = await bridge.selectRoot.call(bridge);
	if (selected === null) return;
	const root = exactRoot(selected);
	if (root.revoked || await bridge.revalidateRoot.call(
		bridge, Object.freeze({ grantId: root.grantId }),
	) !== true) throw new Error('The selected native destination root is not authorized.');
	if (exactBridge() !== bridge) throw new Error('The authenticated desktop bridge changed during root selection.');
	assertQueueRuntime(await store.refresh());
	if (!sameSnapshot(first, queueSnapshot(profile, owner.project, delivery))) {
		throw new Error('The selected V28 project changed during queue admission.');
	}
	const prepared = await prepareSelectedV28LiveCarrier(bridge, owner, first, restartJobId);
	const stageId = prepared?.stageId ?? null;
	let enqueued = false;
	try {
		if (exactBridge() !== bridge
			|| !sameSnapshot(first, queueSnapshot(profile, owner.project, delivery))) {
			throw new Error('The selected V28 project or desktop bridge changed while its carrier was staged.');
		}
		const lifecycle = createFramescaperNativeServicesLifecycleStore(
			bridge, async (operation): Promise<void> => { await operation(); },
		);
		await lifecycle.enqueue(queueRequest(first, root.grantId, prepared));
		enqueued = true;
		if (prepared) await streamSelectedV28LiveCarrier(bridge, prepared);
	} catch (error) {
		if (stageId !== null) {
			if (enqueued) await cancelSelectedV28CarrierJob(bridge, stageId, error);
			else await abandonSelectedV28Carrier(bridge, stageId, error);
		}
		throw error;
	}
}

interface PreparedSelectedV28LiveCarrier {
	readonly stageId: string;
	readonly carrierByteLength: number;
	readonly scratchByteLength: number;
	readonly producer: FramescaperNativeRenderInputStreamV28;
}

async function prepareSelectedV28LiveCarrier(
	bridge: FramescaperNativeServicesBridge,
	owner: FramescaperNativeRenderQueueProjectOwnerV28,
	snapshot: QueueSnapshotV28,
	restartJobId: string | null,
): Promise<PreparedSelectedV28LiveCarrier | null> {
	const envelope = createNativeMediaPlanEnvelopeV2(JSON.parse(snapshot.planPayload) as unknown);
	if (envelope.planVersion !== 14) throw new Error('The selected V28 carrier route lost plan V14.');
	if (!nativeMediaV14RequiresEvaluatedCarrier(envelope.plan)) return null;
	if (typeof owner.prepareNativeRenderInputStreamV28 !== 'function'
		|| typeof bridge.stageLiveRenderInputs !== 'function'
		|| typeof bridge.writeLiveRenderInput !== 'function'
		|| typeof bridge.completeLiveRenderInput !== 'function'
		|| typeof bridge.abandonRenderInputs !== 'function') {
		throw new Error('The selected V28 live evaluated-carrier authority is unavailable.');
	}
	const producer = exactLiveProducer(await owner.prepareNativeRenderInputStreamV28(Object.freeze({
		planPayload: snapshot.planPayload, planFingerprint: snapshot.planFingerprint,
		projectId: snapshot.projectId, projectRevision: snapshot.projectRevision,
	})), envelope.summary.includesAudio);
	let stageId: string | undefined;
	let scratchByteLength = 0;
	try {
		const result = await bridge.stageLiveRenderInputs(Object.freeze({
			liveRenderVersion: 1, planVersion: 14,
			planFingerprint: snapshot.planFingerprint, planPayload: snapshot.planPayload,
			projectId: snapshot.projectId, projectRevision: snapshot.projectRevision,
			inputFingerprints: snapshot.inputFingerprints,
			restartJobId,
			carrierByteLength: producer.carrierByteLength,
			audio: producer.audio === null ? null : Object.freeze({
				role: producer.audio.role, byteLength: producer.audio.byteLength,
			}),
		}));
		if (!result || typeof result.stageId !== 'string' || !/^[a-f0-9]{40}$/u.test(result.stageId)
			|| result.carrierByteLength !== producer.carrierByteLength
			|| !Number.isSafeInteger(result.scratchByteLength) || result.scratchByteLength < 1) {
			throw new TypeError('The selected V28 live carrier stage changed its exact admission.');
		}
		stageId = result.stageId;
		scratchByteLength = result.scratchByteLength;
	} catch (error) {
		if (stageId) await abandonSelectedV28Carrier(bridge, stageId, error);
		throw error;
	}
	return Object.freeze({
		stageId, carrierByteLength: producer.carrierByteLength,
		scratchByteLength, producer,
	});
}

async function streamSelectedV28LiveCarrier(
	bridge: FramescaperNativeServicesBridge,
	prepared: PreparedSelectedV28LiveCarrier,
): Promise<void> {
	if (!bridge.writeLiveRenderInput || !bridge.completeLiveRenderInput) {
		throw new Error('The selected V28 live carrier bridge ended before production.');
	}
	await Promise.all([
		streamSelectedV28LiveRole(
			bridge, prepared.stageId, 'evaluated-rgba-frame-pack', prepared.carrierByteLength,
			prepared.producer.stream,
		),
		...(prepared.producer.audio === null ? [] : [streamSelectedV28LiveRole(
			bridge, prepared.stageId, 'staged-audio-mix', prepared.producer.audio.byteLength,
			prepared.producer.audio.stream,
		)]),
	]);
}

async function streamSelectedV28LiveRole(
	bridge: FramescaperNativeServicesBridge,
	stageId: string,
	role: 'evaluated-rgba-frame-pack' | 'staged-audio-mix',
	reservedByteLength: number,
	produce: (sink: FramescaperNativeRgbaFramePackV1Sink) => Promise<Readonly<{
		readonly byteLength: number; readonly sha256: string;
	}>>,
): Promise<void> {
	let sequence = 0; let offset = 0;
	const trailer = await produce(Object.freeze({ write: async (bytes: Uint8Array) => {
		const reply = await bridge.writeLiveRenderInput!({ stageId, role, sequence, offset, bytes });
		if (reply.sequence !== sequence || reply.receivedBytes !== offset + bytes.byteLength) {
			throw new Error(`The selected V28 ${role} sink changed its live acknowledgement.`);
		}
		sequence += 1; offset += bytes.byteLength;
	} }));
	if (trailer.byteLength !== reservedByteLength || trailer.byteLength !== offset
		|| !SHA256.test(trailer.sha256)) {
		throw new Error(`The selected V28 ${role} changed its reserved length or trailer.`);
	}
	const result = await bridge.completeLiveRenderInput!({
		stageId, role, byteLength: trailer.byteLength, sha256: trailer.sha256,
	});
	if (result.byteLength !== trailer.byteLength || result.sha256 !== trailer.sha256) {
		throw new Error(`The selected V28 native sink changed the completed ${role} identity.`);
	}
}

async function abandonSelectedV28Carrier(
	bridge: FramescaperNativeServicesBridge, stageId: string, cause: unknown,
): Promise<never> {
	try {
		if (typeof bridge.abandonRenderInputs !== 'function'
			|| await bridge.abandonRenderInputs(Object.freeze({ stageId })) !== true) {
			throw new Error('The selected V28 carrier stage abandonment was not acknowledged.');
		}
	} catch (cleanupError) {
		throw new AggregateError([cause, cleanupError], 'V28 queue admission and carrier cleanup failed.', { cause });
	}
	throw cause;
}

async function cancelSelectedV28CarrierJob(
	bridge: FramescaperNativeServicesBridge, stageId: string, cause: unknown,
): Promise<void> {
	try { await bridge.control({ jobId: stageId, action: 'cancel' }); }
	catch (cleanupError) {
		throw new AggregateError([cause, cleanupError],
			'V28 live production failed and its queue job could not be cancelled.', { cause });
	}
}

function exactLiveProducer(value: unknown, includesAudio: boolean): FramescaperNativeRenderInputStreamV28 {
	const row = record(value, 'selected V28 live carrier producer');
	const audio = exactLiveAudio(row.audio, includesAudio);
	if (Reflect.ownKeys(row).sort().join(',') !== 'audio,carrierByteLength,stream'
		|| !Number.isSafeInteger(row.carrierByteLength) || Number(row.carrierByteLength) < 1
		|| typeof row.stream !== 'function') {
		throw new TypeError('The selected V28 live carrier producer is invalid.');
	}
	return Object.freeze({
		carrierByteLength: Number(row.carrierByteLength), audio,
		stream: row.stream as FramescaperNativeRenderInputStreamV28['stream'],
	});
}

function exactLiveAudio(value: unknown, includesAudio: boolean): FramescaperNativeRenderAudioInputStreamV28 | null {
	if (!includesAudio) {
		if (value !== null) throw new TypeError('A silent selected V28 carrier returned audio.');
		return null;
	}
	const row = record(value, 'selected V28 live audio');
	if (Reflect.ownKeys(row).sort().join(',') !== 'byteLength,role,stream'
		|| row.role !== 'staged-audio-mix' || typeof row.stream !== 'function'
		|| !Number.isSafeInteger(row.byteLength) || Number(row.byteLength) < 1
	) {
		throw new TypeError('The selected V28 live audio authority is invalid.');
	}
	return Object.freeze({
		role: 'staged-audio-mix', byteLength: Number(row.byteLength),
		stream: row.stream as FramescaperNativeRenderAudioInputStreamV28['stream'],
	});
}

function queueSnapshot(
	profile: unknown,
	projectValue: unknown,
	delivery: FramescaperNativeRenderDeliveryRequestV28,
): QueueSnapshotV28 {
	const project = cloneFramescaperProjectV28(profile, projectValue);
	const authority = createFramescaperNativeRenderPlanAuthorityV28(project, delivery);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		profile, project, authority, delivery,
	);
	const envelope = createNativeMediaPlanEnvelopeV2(plan);
	if (envelope.planVersion !== 14 || !SHA256.test(envelope.fingerprint)) {
		throw new Error('Selected V28 queue admission did not create exact plan V14.');
	}
	const planPayload = canonicalizeNativeMediaPlan(envelope.plan);
	return Object.freeze({
		projectId: stableId(project.id, 'project ID'),
		projectRevision: integer(project.revision, 'project revision', 0),
		planFingerprint: envelope.fingerprint,
		planPayload,
		inputFingerprints: sourceFingerprints(project, envelope.summary.videoSourceInputs),
		delivery,
	});
}

function sourceFingerprints(
	project: FramescaperProjectV28,
	inputs: readonly Readonly<{ readonly sourceId: string; readonly contentSha256: string | null }>[],
): readonly NativeQueueInputFingerprintV1[] {
	const sources = new Map(records(project.sources, 'sources').map((source) => [String(source.id), source]));
	return Object.freeze(inputs.map((input) => {
		const source = sources.get(input.sourceId);
		if (!source || typeof source.contentSha256 !== 'string' || !SHA256.test(source.contentSha256)
			|| (input.contentSha256 !== null && input.contentSha256 !== source.contentSha256)) {
			throw new Error(`Selected V28 source ${input.sourceId} has no exact content identity.`);
		}
		return Object.freeze({ sourceId: input.sourceId, sha256: source.contentSha256 });
	}));
}

function queueRequest(
	snapshot: QueueSnapshotV28,
	rootGrantId: string,
	prepared: PreparedSelectedV28LiveCarrier | null,
): FramescaperNativeQueueEnqueueRendererRequest {
	const imageSequence = snapshot.delivery.kind === 'image-sequence';
	return Object.freeze({
		taskKind: imageSequence ? 'image-sequence-export' : 'encoded-export',
		planVersion: 14, derivedInputStageId: prepared?.stageId ?? null,
		planFingerprint: snapshot.planFingerprint, planPayload: snapshot.planPayload,
		projectId: snapshot.projectId, projectRevision: snapshot.projectRevision,
		inputFingerprints: snapshot.inputFingerprints, rootGrantId,
		relativeDestination: renderDestination(snapshot),
		reservations: Object.freeze({
			...FRAMESCAPER_V28_RENDER_QUEUE_RESERVATIONS,
			scratchBytes: prepared?.scratchByteLength ?? 0,
		}),
		// Image sequences may declare verified-frame-checkpoint only once
		// recovery actually verifies existing frames; restart revalidation does
		// not consume checkpoints for the selected V14 route yet, so the label
		// promised a resumability the runtime silently downgraded to a restart
		// from zero — the mislabeled resumability the 5B-3 packet forbids.
		recoveryClass: 'atomic-restart',
	});
}

function recoverableCarrierJob(
	snapshot: QueueSnapshotV28,
	queue: FramescaperNativeServicesRendererSnapshot['services']['queue'],
): string | null {
	const taskKind = snapshot.delivery.kind === 'image-sequence'
		? 'image-sequence-export' : 'encoded-export';
	const candidates = queue.filter((row) => row.state === 'paused'
		&& row.lastFailureCode === 'awaiting-carrier-regeneration'
		&& row.taskKind === taskKind && row.projectId === snapshot.projectId
		&& row.relativeDestination === renderDestination(snapshot));
	if (candidates.length > 1) throw new Error('Selected V28 recovery found ambiguous paused carrier jobs.');
	return candidates[0]?.jobId ?? null;
}

async function recoverableDelivery(
	profile: unknown,
	owner: FramescaperNativeRenderQueueProjectOwnerV28,
	jobId: string,
): Promise<FramescaperNativeRenderDeliveryRequestV28> {
	const bridge = exactBridge();
	const services = await createFramescaperNativeServicesStore(bridge).refresh();
	assertQueueRuntime(services);
	const project = cloneFramescaperProjectV28(profile, owner.project);
	const row = services.services.queue.find((candidate) => candidate.jobId === jobId
		&& candidate.state === 'paused'
		&& candidate.lastFailureCode === 'awaiting-carrier-regeneration'
		&& candidate.projectId === project.id);
	if (!row) throw new Error('The selected V28 carrier regeneration no longer matches its exact paused queue job.');
	let delivery: FramescaperNativeRenderDeliveryRequestV28;
	if (row.taskKind === 'encoded-export') {
		delivery = snapshotFramescaperNativeRenderDeliveryRequestV28(undefined);
	} else if (row.taskKind === 'image-sequence-export') {
		const prefix = `renders/framescaper-${project.id}-r${String(project.revision)}-`;
		const suffix = row.relativeDestination.startsWith(prefix)
			? row.relativeDestination.slice(prefix.length) : '';
		const match = /^(?<num>[1-9][0-9]{0,6})-(?<den>[1-9][0-9]{0,6})-(?<format>png|tiff|openexr)$/u
			.exec(suffix);
		if (!match?.groups) {
			throw new Error('The selected V28 image-sequence recovery destination lost its exact delivery intent.');
		}
		delivery = snapshotFramescaperNativeRenderDeliveryRequestV28({
			kind: 'image-sequence', format: match.groups.format,
			frameRate: { num: Number(match.groups.num), den: Number(match.groups.den) },
			preserveAlpha: true,
		});
	} else {
		throw new Error('The selected V28 carrier regeneration has an unsupported queue task.');
	}
	const snapshot = queueSnapshot(profile, project, delivery);
	if (row.relativeDestination !== renderDestination(snapshot)) {
		throw new Error('The selected V28 carrier regeneration destination is stale.');
	}
	return delivery;
}

function renderDestination(
	snapshot: Pick<QueueSnapshotV28, 'projectId' | 'projectRevision' | 'delivery'>,
): string {
	const prefix = `renders/framescaper-${snapshot.projectId}-r${String(snapshot.projectRevision)}`;
	return snapshot.delivery.kind === 'encoded-mov' ? `${prefix}.mov`
		: `${prefix}-${String(snapshot.delivery.frameRate.num)}-${String(
			snapshot.delivery.frameRate.den)}-${snapshot.delivery.format}`;
}

function exactBridge(): FramescaperNativeServicesBridge {
	const bridge = resolveFramescaperNativeServicesBridge(globalThis);
	if (!bridge) throw new Error('The authenticated Framescaper desktop bridge is unavailable.');
	return bridge;
}
function assertQueueRuntime(snapshot: FramescaperNativeServicesRendererSnapshot): void {
	const ref = NATIVE_MEDIA_CAPABILITY_IDS.renderQueue;
	const capability = snapshot.capabilitySnapshot
		? nativeMediaCapabilityEntry(snapshot.capabilitySnapshot, ref.domain, ref.id) : null;
	if (!snapshot.services.runtimeAvailable || !snapshot.services.nativeMediaEnabled
		|| !snapshot.preferences.nativeMediaEnabled || !snapshot.capabilitySnapshot?.masterEnabled
		|| !isNativeMediaCapabilityUsable(capability)) {
		throw new Error('The selected V14 render queue is unavailable or not enabled.');
	}
}
function exactRoot(value: unknown): FramescaperNativeRootProjection {
	const row = record(value, 'destination root');
	if (Reflect.ownKeys(row).sort().join(',') !== 'displayName,grantId,revoked'
		|| typeof row.grantId !== 'string' || !/^[a-f0-9]{16,64}$/u.test(row.grantId)
		|| typeof row.displayName !== 'string' || typeof row.revoked !== 'boolean') {
		throw new TypeError('The native destination root projection is invalid.');
	}
	return Object.freeze({ grantId: row.grantId, displayName: row.displayName, revoked: row.revoked });
}
function sameSnapshot(left: QueueSnapshotV28, right: QueueSnapshotV28): boolean {
	return left.projectId === right.projectId && left.projectRevision === right.projectRevision
		&& left.planFingerprint === right.planFingerprint && left.planPayload === right.planPayload
		&& JSON.stringify(left.inputFingerprints) === JSON.stringify(right.inputFingerprints);
}
function serialize<Request>(action: (request: Request) => Promise<void>): (request: Request) => Promise<void> {
	let tail = Promise.resolve();
	return (request) => {
		const run = (): Promise<void> => action(request);
		const next = tail.then(run, run);
		tail = next.catch(() => undefined);
		return next;
	};
}
function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}
function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}
function integer(value: unknown, name: string, minimum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new RangeError(`${name} is invalid.`);
	return Number(value);
}
