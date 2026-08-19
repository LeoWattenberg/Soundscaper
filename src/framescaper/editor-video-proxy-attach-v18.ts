/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Generating and attaching one video proxy, end to end.
 *
 * Every part of this has existed separately and none of them met: the
 * relationship authority proves a candidate belongs to an original, the
 * controller gate reserves the tab, and the coordinator installs the pointer
 * atomically. What was missing was the caller that holds them in the right
 * order over a real project — so this is that caller, and deliberately nothing
 * more. It owns no storage, no schema, and no history of its own.
 *
 * The order is not incidental. The relationship is proved *before* the gate is
 * captured, because proving it means running an encode that can take minutes and
 * the gate stops the session from being edited while it is held. The coordinator
 * then re-captures the original under its own adoption lease and refuses if
 * anything moved in between, so a long generation costs the user nothing until
 * the moment it is worth something.
 *
 * A source that already carries an attachment is refused here rather than deep
 * inside the coordinator, which requires an all-null base and would otherwise
 * fail with a wire error about a document shape. Detaching first is the answer,
 * and saying so is this layer's job.
 */

import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../common/editor/video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../common/editor/video-source-timing-views.ts';
import type { VideoProxyCandidateObserver } from '../common/editor/video-proxy-candidate-observation.ts';
import {
	createVideoProxyRelationshipAuthority,
	proveVideoProxyRelationship,
	type VideoProxyOriginalLease,
	type VideoProxyOriginalObservationRequest,
} from '../common/editor/video-proxy-relationship.ts';
import type { FramescaperEditorProjectEnvironmentV18 } from './editor-project-environment-v18.ts';
import { createFramescaperVideoProxyAttachmentControllerGateV18 } from './editor-video-proxy-controller-gate-v18.ts';
import {
	FramescaperVideoProxyAttachmentCoordinatorV18,
	type FramescaperVideoProxyAttachmentResultV18,
} from './editor-video-proxy-attachment-coordinator-v18.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

type SessionControllerV18 = ReturnType<
	FramescaperEditorProjectEnvironmentV18['runtime']['createSessionController']
>;

export interface FramescaperVideoProxyAttachPortsV18 {
	readonly environment: FramescaperEditorProjectEnvironmentV18;
	readonly session: SessionControllerV18;
	readonly candidateObserver: VideoProxyCandidateObserver;
	getProject(): unknown;
	captureTask(): unknown;
	assertTaskCurrent(token: unknown): void;
	observeOriginal(
		request: Readonly<VideoProxyOriginalObservationRequest>,
	): Awaitable<VideoProxyOriginalLease>;
	/** Defaults to the shared resolver every other video service reads timing with. */
	getTimingViews?(project: unknown): ReadonlyMap<string, VideoSourceTimingView>;
}

export interface FramescaperVideoProxyAttachRequestV18 {
	readonly sourceId: string;
	readonly operationId?: string;
	readonly signal?: AbortSignal;
}

/** Generate a proxy for one source and install it as that source's attachment. */
export async function attachFramescaperVideoProxyV18(
	ports: FramescaperVideoProxyAttachPortsV18,
	request: FramescaperVideoProxyAttachRequestV18,
): Promise<Readonly<FramescaperVideoProxyAttachmentResultV18>> {
	const sourceId = nonEmpty(request?.sourceId, 'source');
	assertPorts(ports);
	assertAttachable(ports.getProject(), sourceId);

	const getTimingViews = ports.getTimingViews ?? resolveVideoSourceTimingViews;
	const authority = createVideoProxyRelationshipAuthority({
		getProject: () => ports.getProject(),
		captureTask: () => ports.captureTask(),
		assertTaskCurrent: (token: unknown) => { ports.assertTaskCurrent(token); },
		resolveOriginalTiming: (source: Readonly<Record<string, unknown>>): BoundVideoSourceTimingView => (
			bindVideoSourceTimingView(getTimingViews(ports.getProject()), source)
		),
		observeOriginal: (observation) => ports.observeOriginal(observation),
		candidateObserver: ports.candidateObserver,
	});

	// The encode happens here, outside the gate, so the session stays editable
	// for however long it takes.
	const preparation = await proveVideoProxyRelationship(authority, {
		sourceId,
		...(request.signal ? { signal: request.signal } : {}),
	});

	const gate = createFramescaperVideoProxyAttachmentControllerGateV18(ports.environment, ports.session);
	const coordinator = new FramescaperVideoProxyAttachmentCoordinatorV18(
		ports.environment,
		gate,
		authority,
	);
	return coordinator.attach({
		preparation,
		sourceId,
		operationId: request.operationId ?? `attach-video-proxy:${sourceId}`,
		...(request.signal ? { signal: request.signal } : {}),
	});
}

function assertPorts(ports: FramescaperVideoProxyAttachPortsV18): void {
	if (!ports || typeof ports !== 'object') {
		throw new TypeError('Attaching a video proxy requires its ports.');
	}
	for (const field of [
		'getProject', 'captureTask', 'assertTaskCurrent', 'observeOriginal',
	] as const) {
		if (typeof ports[field] !== 'function') {
			throw new TypeError(`Attaching a video proxy requires ${field}.`);
		}
	}
	if (!ports.candidateObserver) {
		// A build with no encoder or no timing probe composes to no observer at
		// all, and that is the state to report rather than to fail inside.
		throw new TypeError('This build cannot generate video proxies.');
	}
}

function assertAttachable(project: unknown, sourceId: string): void {
	const record = (project && typeof project === 'object' ? project : null) as
		| Readonly<{ sources?: readonly Readonly<Record<string, unknown>>[] }>
		| null;
	const source = record?.sources?.find((candidate) => candidate?.id === sourceId);
	if (!source) throw new ReferenceError(`Source ${sourceId} is not in the open project.`);
	if (source.kind !== 'video') {
		throw new TypeError(`Source ${sourceId} is not a video source.`);
	}
	if (source.proxyAttachment != null) {
		throw new RangeError(`Source ${sourceId} already has a proxy; detach it before generating another.`);
	}
}

function nonEmpty(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) {
		throw new TypeError(`A video proxy ${name} ID is required.`);
	}
	return value;
}
