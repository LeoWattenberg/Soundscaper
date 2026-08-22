/* SPDX-License-Identifier: AGPL-3.0-only */

/** Selected-V20 menu binding for one authenticated, exact native render job. */

import {
	NATIVE_MEDIA_CAPABILITY_IDS,
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
} from '../common/editor/native-media-capability-snapshot.ts';
import { assertNativeMediaGraphPlan } from '../common/editor/native-media-graph-plan-admission.ts';
import { canonicalizeNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import {
	createNativeMediaPlanEnvelopeV1,
	type NativeMediaPlanEnvelopeV1,
} from '../common/editor/native-media-plan-envelope.ts';
import type {
	NativeQueueInputFingerprintV1,
	NativeQueueReservationsV1,
} from '../common/editor/native-queue-record.ts';
import {
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
	framescaperNativeRenderInputAbandonRequest,
	type FramescaperNativeQueueEnqueueRendererRequest,
	type FramescaperNativeRenderInputV1,
	type FramescaperNativeRootProjection,
} from '../common/editor/ui/framescaper-native-services-lifecycle-bridge.ts';
import { createVideoExportPlan } from '../common/editor/video-export.js';
import {
	cloneFramescaperProjectV20,
	type FramescaperProjectV20,
} from './editor-project-v20.ts';
import {
	assertFramescaperProjectV20Profile,
	type FramescaperProjectV20Profile,
} from './editor-project-v20-profile.ts';
import { framescaperProjectForRuntimeConsumersV20 } from './editor-project-v20-runtime.ts';
import { classifyFramescaperVideoExportDispatchV20 } from './video-export-dispatch-v20.ts';
import { createFramescaperVideoKeyframeExportPlanV20 } from './video-export-plan-v20.ts';

const ROOT_GRANT_ID = /^[a-f0-9]{16,64}$/u;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const QUEUE_SURFACES = Object.freeze(['render-queue-enqueue'] as const);

/**
 * A conservative, bounded CPU-only reservation. Main still checks exact staged
 * body sizes and current capacity before dispatch, so under-sized jobs refuse.
 */
export const FRAMESCAPER_V20_RENDER_QUEUE_RESERVATIONS: NativeQueueReservationsV1 =
	Object.freeze({
		cpuCores: 2,
		processTreeRssBytes: 2 * 1_024 ** 3,
		scratchBytes: 16 * 1_024 ** 3,
		minimumFreeBytes: 4 * 1_024 ** 3,
		hardwareBackend: null,
	});

export interface FramescaperNativeRenderQueueProjectOwnerV20 {
	readonly project: unknown;
	readonly prepareNativeRenderInputsV20?: (request: Readonly<{
		readonly planPayload: string;
		readonly planFingerprint: string;
		readonly projectId: string;
		readonly projectRevision: number;
	}>) => Promise<readonly FramescaperNativeRenderInputV1[]>;
}

interface FramescaperNativeRenderQueueSnapshotV20 {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly planVersion: 7 | 8;
	readonly planFingerprint: string;
	readonly planPayload: string;
	readonly extension: string;
	readonly inputFingerprints: readonly NativeQueueInputFingerprintV1[];
}

/** Bind no candidate actions: selected V20 owns only exact render enqueue. */
export function bindFramescaperNativeRenderQueueActionV20(
	profile: FramescaperProjectV20Profile | unknown,
	owner: FramescaperNativeRenderQueueProjectOwnerV20,
): FramescaperNativeProjectActionRuntime {
	assertFramescaperProjectV20Profile(profile);
	if (!owner || (typeof owner !== 'object' && typeof owner !== 'function')) {
		throw new TypeError('The selected V20 render queue requires its controller owner.');
	}
	const enqueue = serialize(() => enqueueCurrentProject(profile, owner));
	const runtime = createFramescaperNativeProjectActionSubsetRuntime(QUEUE_SURFACES, {
		'render-queue-enqueue': enqueue,
	});
	bindFramescaperNativeProjectActionRuntime(owner, runtime);
	return runtime;
}

async function enqueueCurrentProject(
	profile: FramescaperProjectV20Profile,
	owner: FramescaperNativeRenderQueueProjectOwnerV20,
): Promise<void> {
	const bridge = exactBridge();
	const initial = queueSnapshot(profile, owner.project);
	const serviceStore = createFramescaperNativeServicesStore(bridge);
	assertQueueRuntime(await serviceStore.refresh());
	const selectRoot = bridge.selectRoot;
	const revalidateRoot = bridge.revalidateRoot;
	const enqueue = bridge.enqueue;
	if (!selectRoot || !revalidateRoot || !enqueue) {
		throw new Error('This authenticated desktop bridge cannot enqueue V20 renders.');
	}
	const rootValue = await selectRoot.call(bridge);
	if (rootValue === null) return;
	const root = exactRoot(rootValue);
	if (root.revoked) throw new Error('The selected native destination root is revoked.');
	if (await revalidateRoot.call(bridge, Object.freeze({ grantId: root.grantId })) !== true) {
		throw new Error('The selected native destination root is no longer authorized.');
	}
	if (exactBridge() !== bridge) {
		throw new Error('The authenticated desktop bridge changed during root selection.');
	}
	assertQueueRuntime(await serviceStore.refresh());
	const current = queueSnapshot(profile, owner.project);
	if (!sameQueueSnapshot(initial, current)) {
		throw new Error('The V20 project or source fingerprints changed during queue admission.');
	}
	const derivedInputStageId = await stageSelectedV20Inputs(bridge, owner, initial);
	try {
		if (exactBridge() !== bridge) {
			throw new Error('The authenticated desktop bridge changed while render inputs were staged.');
		}
		if (!sameQueueSnapshot(initial, queueSnapshot(profile, owner.project))) {
			throw new Error('The V20 project changed while its derived render inputs were staged.');
		}
		const request = queueRequest(initial, root.grantId, derivedInputStageId);
		const lifecycle = createFramescaperNativeServicesLifecycleStore(
			bridge,
			async (operation): Promise<void> => { await operation(); },
		);
		await lifecycle.enqueue(request);
	} catch (error) {
		if (derivedInputStageId !== null) {
			await abandonSelectedV20Inputs(bridge, derivedInputStageId, error);
		}
		throw error;
	}
}

function queueSnapshot(
	profile: FramescaperProjectV20Profile,
	projectValue: unknown,
): FramescaperNativeRenderQueueSnapshotV20 {
	const project = cloneFramescaperProjectV20(profile, projectValue);
	const projectId = identifier(project.id, 'V20 project ID');
	const projectRevision = nonNegativeInteger(project.revision, 'V20 project revision');
	const plan = exactPlan(profile, project);
	const planPayload = canonicalizeNativeMediaPlan(plan.plan);
	if (planPayload.length === 0 || !SHA256.test(plan.fingerprint)) {
		throw new TypeError('The selected V20 render plan has no exact canonical identity.');
	}
	return Object.freeze({
		projectId,
		projectRevision,
		planVersion: plan.planVersion,
		planFingerprint: plan.fingerprint,
		planPayload,
		extension: safeExtension(plan.summary.extension),
		inputFingerprints: sourceFingerprints(project, plan),
	});
}

function exactPlan(
	profile: FramescaperProjectV20Profile,
	project: FramescaperProjectV20,
): NativeMediaPlanEnvelopeV1 & Readonly<{ readonly planVersion: 7 | 8 }> {
	const decision = classifyFramescaperVideoExportDispatchV20(profile, project, 'project');
	let plan: unknown;
	if (decision.strategy === 'keyed-v20') {
		plan = createFramescaperVideoKeyframeExportPlanV20(profile, project, {
			format: 'mp4', range: 'project', includeAudio: true,
		});
	} else {
		plan = createVideoExportPlan(framescaperProjectForRuntimeConsumersV20(profile, project), {
			format: 'mp4', range: 'project', includeAudio: true,
		}) as unknown;
		assertNativeMediaGraphPlan(plan);
	}
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	if (envelope.planVersion !== 7 && envelope.planVersion !== 8) {
		throw new RangeError('Selected V20 may enqueue only exact V7 or V8 render plans.');
	}
	return envelope as NativeMediaPlanEnvelopeV1 & Readonly<{ readonly planVersion: 7 | 8 }>;
}

function sourceFingerprints(
	project: FramescaperProjectV20,
	plan: NativeMediaPlanEnvelopeV1,
): readonly NativeQueueInputFingerprintV1[] {
	const sources = new Map<string, Readonly<Record<string, unknown>>>();
	for (const [index, sourceValue] of project.sources.entries()) {
		const source = record(sourceValue, `V20 source ${String(index)}`);
		const id = identifier(data(source, 'id', `V20 source ${String(index)}`), 'V20 source ID');
		if (sources.has(id)) throw new RangeError(`V20 source ${id} is duplicated.`);
		sources.set(id, source);
	}
	const seen = new Set<string>();
	const result = plan.summary.videoSourceInputs.map((input, index) => {
		if (input.inputIndex !== index || seen.has(input.sourceId)) {
			throw new TypeError('The V20 render plan has a non-canonical source inventory.');
		}
		seen.add(input.sourceId);
		const source = sources.get(input.sourceId);
		if (!source || data(source, 'kind', `V20 source ${input.sourceId}`) !== 'video') {
			throw new ReferenceError(`V20 render source ${input.sourceId} is unavailable.`);
		}
		const mimeType = data(source, 'mimeType', `V20 source ${input.sourceId}`);
		const sha256 = data(source, 'contentSha256', `V20 source ${input.sourceId}`);
		if (mimeType !== input.mimeType || typeof sha256 !== 'string' || !SHA256.test(sha256)
			|| (input.contentSha256 !== null && input.contentSha256 !== sha256)) {
			throw new Error(`V20 render source ${input.sourceId} has no matching content identity.`);
		}
		return Object.freeze({ sourceId: input.sourceId, sha256 });
	});
	return Object.freeze(result);
}

function queueRequest(
	snapshot: FramescaperNativeRenderQueueSnapshotV20,
	rootGrantId: string,
	derivedInputStageId: string | null,
): FramescaperNativeQueueEnqueueRendererRequest {
	return Object.freeze({
		taskKind: 'encoded-export',
		planVersion: snapshot.planVersion,
		derivedInputStageId,
		planFingerprint: snapshot.planFingerprint,
		planPayload: snapshot.planPayload,
		projectId: snapshot.projectId,
		projectRevision: snapshot.projectRevision,
		inputFingerprints: snapshot.inputFingerprints,
		rootGrantId,
		relativeDestination: destination(snapshot),
		reservations: FRAMESCAPER_V20_RENDER_QUEUE_RESERVATIONS,
		recoveryClass: 'atomic-restart',
	});
}

async function stageSelectedV20Inputs(
	bridge: FramescaperNativeServicesBridge,
	owner: FramescaperNativeRenderQueueProjectOwnerV20,
	snapshot: FramescaperNativeRenderQueueSnapshotV20,
): Promise<string> {
	if (typeof owner.prepareNativeRenderInputsV20 !== 'function'
		|| typeof bridge.stageRenderInputs !== 'function'
		|| typeof bridge.abandonRenderInputs !== 'function') {
		throw new Error('The selected V20 renderer-to-main derived-input staging authority is unavailable.');
	}
	const derivedInputs = renderInputs(await owner.prepareNativeRenderInputsV20(Object.freeze({
		planPayload: snapshot.planPayload, planFingerprint: snapshot.planFingerprint,
		projectId: snapshot.projectId, projectRevision: snapshot.projectRevision,
	})));
	const result = await bridge.stageRenderInputs(Object.freeze({
		stageVersion: 1, planVersion: snapshot.planVersion,
		planFingerprint: snapshot.planFingerprint, planPayload: snapshot.planPayload,
		projectId: snapshot.projectId, projectRevision: snapshot.projectRevision,
		inputFingerprints: snapshot.inputFingerprints, derivedInputs,
	}));
	return patternId(result?.stageId, /^[a-f0-9]{40}$/u, 'V20 derived-input stage ID');
}

async function abandonSelectedV20Inputs(
	bridge: FramescaperNativeServicesBridge,
	stageId: string,
	cause: unknown,
): Promise<never> {
	const cleanupFailures: unknown[] = [];
	try {
		const abandon = bridge.abandonRenderInputs;
		if (typeof abandon !== 'function'
			|| await abandon.call(bridge, framescaperNativeRenderInputAbandonRequest({ stageId })) !== true) {
			throw new Error('The V20 derived-input stage abandonment was not acknowledged.');
		}
	} catch (cleanupError) { cleanupFailures.push(cleanupError); }
	if (cleanupFailures.length !== 0) {
		throw new AggregateError(
			[cause, cleanupFailures[0]],
			'The V20 queue admission failed and its derived-input stage could not be abandoned.',
			{ cause },
		);
	}
	throw cause;
}

function renderInputs(value: unknown): readonly FramescaperNativeRenderInputV1[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 2
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Selected V20 requires one evaluated carrier and optional staged audio.');
	}
	const inputs = value.map((entry, index) => {
		const row = closedRecord(entry, ['role', 'byteLength', 'sha256', 'bytes'], `V20 derived input ${String(index)}`);
		const expected = index === 0 ? 'evaluated-rgba-frame-pack' : 'staged-audio-mix';
		if (row.role !== expected || !(row.bytes instanceof Blob)
			|| !Number.isSafeInteger(row.byteLength) || Number(row.byteLength) < 1
			|| row.bytes.size !== row.byteLength || typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
			throw new TypeError('A selected V20 derived render input has invalid role or byte identity.');
		}
		return Object.freeze({
			role: expected, byteLength: Number(row.byteLength), sha256: row.sha256, bytes: row.bytes,
		}) as FramescaperNativeRenderInputV1;
	});
	return Object.freeze(inputs);
}

function destination(snapshot: FramescaperNativeRenderQueueSnapshotV20): string {
	return `renders/framescaper-${snapshot.projectId}-r${String(snapshot.projectRevision)}.${snapshot.extension}`;
}

function exactBridge(): FramescaperNativeServicesBridge {
	const bridge = resolveFramescaperNativeServicesBridge(globalThis);
	if (!bridge) throw new Error('The authenticated Framescaper desktop bridge is unavailable.');
	return bridge;
}

function assertQueueRuntime(snapshot: FramescaperNativeServicesRendererSnapshot): void {
	const capability = snapshot.capabilitySnapshot;
	const queue = capability && nativeMediaCapabilityEntry(
		capability,
		NATIVE_MEDIA_CAPABILITY_IDS.renderQueue.domain,
		NATIVE_MEDIA_CAPABILITY_IDS.renderQueue.id,
	);
	if (!snapshot.services.runtimeAvailable
		|| !snapshot.services.nativeMediaEnabled
		|| !snapshot.preferences.nativeMediaEnabled
		|| !capability?.masterEnabled
		|| !isNativeMediaCapabilityUsable(queue ?? null)) {
		throw new Error('The native render queue capability is unavailable or not enabled.');
	}
}

function exactRoot(value: unknown): FramescaperNativeRootProjection {
	const root = closedRecord(value, ['grantId', 'displayName', 'revoked'], 'native destination root');
	const grantId = data(root, 'grantId', 'native destination root');
	const displayName = data(root, 'displayName', 'native destination root');
	const revoked = data(root, 'revoked', 'native destination root');
	if (typeof grantId !== 'string' || !ROOT_GRANT_ID.test(grantId)
		|| typeof displayName !== 'string' || displayName.length === 0 || displayName.length > 4_096
		|| displayName.includes('\0')
		|| typeof revoked !== 'boolean') {
		throw new TypeError('The selected native destination root is invalid.');
	}
	return Object.freeze({ grantId, displayName, revoked });
}

function sameQueueSnapshot(
	left: FramescaperNativeRenderQueueSnapshotV20,
	right: FramescaperNativeRenderQueueSnapshotV20,
): boolean {
	return left.projectId === right.projectId
		&& left.projectRevision === right.projectRevision
		&& left.planVersion === right.planVersion
		&& left.planFingerprint === right.planFingerprint
		&& left.planPayload === right.planPayload
		&& left.extension === right.extension
		&& left.inputFingerprints.length === right.inputFingerprints.length
		&& left.inputFingerprints.every((entry, index) => {
			const peer = right.inputFingerprints[index];
			return peer?.sourceId === entry.sourceId && peer.sha256 === entry.sha256;
		});
}

function serialize(action: () => Promise<void>): () => Promise<void> {
	let tail = Promise.resolve();
	return () => {
		const operation = tail.then(action, action);
		tail = operation.catch(() => undefined);
		return operation;
	};
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	const result = record(value, name);
	const keys = Reflect.ownKeys(result);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${name} must be a closed record.`);
	}
	return result as Readonly<Record<Field, unknown>>;
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function data(value: Readonly<Record<string, unknown>>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || !PROJECT_ID.test(value)) {
		throw new TypeError(`${name} is not a native queue identifier.`);
	}
	return value;
}

function patternId(value: unknown, pattern: RegExp, name: string): string {
	if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value as number;
}

function safeExtension(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-z0-9]{1,16}$/u.test(value)) {
		throw new TypeError('The selected V20 render plan has an unsafe extension.');
	}
	return value;
}
