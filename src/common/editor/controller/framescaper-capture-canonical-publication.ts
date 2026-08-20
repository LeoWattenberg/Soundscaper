/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeFramescaperCaptureSessionManifest,
	type FramescaperCaptureSessionManifestV1,
	type FramescaperCaptureStreamManifestV1,
} from '../framescaper-capture-session-manifest.ts';
import type {
	FramescaperCapturePublicationPlan,
} from './framescaper-capture-publication-plan.ts';
import {
	createFramescaperCapturePublicationService,
	type FramescaperCaptureAssetStream,
	type FramescaperCapturePublicationServiceDependencies,
	type FramescaperCapturePublicationRequest,
	type FramescaperCapturePublicationResult,
	FramescaperCapturePublicationRetryableError,
} from './framescaper-capture-publication-service.ts';
import {
	publishFramescaperCaptureCanonicalAsset,
	type FramescaperCaptureCanonicalAssetOptions,
} from './framescaper-capture-canonical-assets.ts';
import {
	createFramescaperCapturePublicationLifecycle,
	digestFramescaperCaptureManifestEvidence,
} from './framescaper-capture-publication-lifecycle.ts';
import type { FramescaperCaptureSessionManifestRepository } from '../storage/framescaper-capture-session-manifest-repository.ts';

export type {
	FramescaperCaptureCanonicalStore,
	FramescaperCaptureVideoProbeResult,
} from './framescaper-capture-canonical-assets.ts';

export interface FramescaperCaptureDerivativeRequest {
	readonly projectId: string;
	readonly sessionId: string;
	readonly sourceIds: readonly string[];
	readonly plan: FramescaperCapturePublicationPlan;
}

export interface FramescaperCaptureCanonicalPublicationOptions
	extends FramescaperCaptureCanonicalAssetOptions {
	readonly manifests: Pick<FramescaperCaptureSessionManifestRepository, 'load' | 'replace'>;
	readonly now?: () => number;
	readonly assertProjectFence: FramescaperCapturePublicationServiceDependencies['assertProjectFence'];
	readonly commitAtomic: FramescaperCapturePublicationServiceDependencies['commitAtomic'];
	readonly recordRetryableRecovery:
		FramescaperCapturePublicationServiceDependencies['recordRetryableRecovery'];
	readonly scheduleDerivatives?: (
		request: FramescaperCaptureDerivativeRequest,
	) => PromiseLike<void> | void;
	readonly onDerivativeWarning?: (error: unknown) => void;
}

export interface FramescaperCaptureCanonicalPublicationRequest extends Omit<
	FramescaperCapturePublicationRequest,
	'sessionId' | 'projectFence' | 'manifestSha256'
> {
	readonly manifest: FramescaperCaptureSessionManifestV1;
}

export interface FramescaperCaptureCanonicalPublicationResult
	extends FramescaperCapturePublicationResult {
	readonly manifest: FramescaperCaptureSessionManifestV1;
}

/**
 * Publish each sealed spool through ordinary source storage, then delegate the
 * sole project mutation to the existing atomic publication service.
 */
export function createFramescaperCaptureCanonicalPublicationService(
	options: FramescaperCaptureCanonicalPublicationOptions,
) {
	assertOptions(options);
	const lifecycle = createFramescaperCapturePublicationLifecycle(
		options.manifests,
		options.now ? { now: options.now } : {},
	);
	return Object.freeze({ publish });

	async function publish(
		request: FramescaperCaptureCanonicalPublicationRequest,
	): Promise<Readonly<FramescaperCaptureCanonicalPublicationResult>> {
		const requestedManifest = normalizeFramescaperCaptureSessionManifest(request.manifest);
		assertPublishableManifest(requestedManifest);
		const validateImport = requiresValidatedImport(requestedManifest, request.recoveryProvenance);
		const manifest = validateImport
			? requestedManifest
			: await lifecycle.begin(requestedManifest, request.recoveryProvenance);
		let publicationManifest = manifest;
		const streams = bindFinalizedStreams(manifest, request.streams);
		const streamManifests = new Map(manifest.streams.map((stream) => [stream.streamId, stream]));
		const service = createFramescaperCapturePublicationService({
			assertProjectFence: options.assertProjectFence,
			commitAtomic: options.commitAtomic,
			recordRetryableRecovery: options.recordRetryableRecovery,
			publishAsset: (stream, context) => publishFramescaperCaptureCanonicalAsset(
				options,
				manifest,
				requiredStreamManifest(streamManifests, stream.streamId),
				stream,
				request.projectSampleRate,
				context.signal,
				context.publicationMode,
			),
			...(validateImport ? {
				prepareCommit: async () => {
					publicationManifest = await lifecycle.beginValidatedImport(manifest);
				},
			} : {}),
		});
		const { manifest: _manifest, ...publication } = request;
		const result = await service.publish({
			...publication,
			projectFence: manifest.projectFence,
			sessionId: manifest.sessionId,
			manifestSha256: digestFramescaperCaptureManifestEvidence(manifest),
			streams,
		});
		let committedManifest: FramescaperCaptureSessionManifestV1;
		try {
			committedManifest = await lifecycle.commit(publicationManifest);
		} catch (error) {
			throw await retainLifecycleFailure(options, manifest, result, error);
		}
		scheduleDerivatives(options, committedManifest, result);
		return Object.freeze({ ...result, manifest: committedManifest });
	}
}

function requiresValidatedImport(
	manifest: FramescaperCaptureSessionManifestV1,
	provenance: FramescaperCaptureCanonicalPublicationRequest['recoveryProvenance'],
): boolean {
	if (provenance !== 'import-as-is' || manifest.state !== 'sealed') return false;
	if (manifest.streams.some(({ playability }) => playability === 'invalid')) {
		throw new Error('An invalid capture stream cannot enter canonical publication.');
	}
	return manifest.streams.some(({ playability }) => playability === 'unknown');
}

function assertPublishableManifest(manifest: FramescaperCaptureSessionManifestV1): void {
	if (manifest.state !== 'sealed' && manifest.state !== 'finalizing' && manifest.state !== 'published') {
		throw new Error('Canonical capture publication requires a sealed manifest.');
	}
}

async function retainLifecycleFailure(
	options: FramescaperCaptureCanonicalPublicationOptions,
	manifest: FramescaperCaptureSessionManifestV1,
	result: FramescaperCapturePublicationResult,
	cause: unknown,
): Promise<Error> {
	const error = new FramescaperCapturePublicationRetryableError(cause);
	try {
		await options.recordRetryableRecovery({
			sessionId: manifest.sessionId,
			projectFence: manifest.projectFence,
			sourceIds: Object.freeze(result.plan.entries.map(({ sourceId }) => sourceId)),
			reason: 'commit-failed',
			error: cause,
		});
		return error;
	} catch (recoveryError) {
		return new AggregateError(
			[error, recoveryError],
			'Capture commit landed, but manifest settlement and recovery recording failed.',
			{ cause: error },
		);
	}
}

function bindFinalizedStreams(
	manifest: FramescaperCaptureSessionManifestV1,
	streams: readonly FramescaperCaptureAssetStream[],
): readonly FramescaperCaptureAssetStream[] {
	if (!Array.isArray(streams) || streams.length !== manifest.streams.length) {
		throw new Error('Canonical capture publication must finalize every manifest stream exactly once.');
	}
	const byId = new Map(streams.map((stream) => [stream.streamId, stream]));
	if (byId.size !== streams.length) throw new Error('Canonical capture finalized stream IDs must be unique.');
	return Object.freeze(manifest.streams.map((owned) => {
		const stream = byId.get(owned.streamId);
		if (!stream || stream.role !== owned.role) {
			throw new Error(`Canonical capture stream ownership changed for ${owned.streamId}.`);
		}
		return stream;
	}));
}

function requiredStreamManifest(
	streams: ReadonlyMap<string, FramescaperCaptureStreamManifestV1>,
	streamId: string,
): FramescaperCaptureStreamManifestV1 {
	const stream = streams.get(streamId);
	if (!stream) throw new Error(`Capture stream ${streamId} is not owned by the sealed manifest.`);
	return stream;
}

function scheduleDerivatives(
	options: FramescaperCaptureCanonicalPublicationOptions,
	manifest: FramescaperCaptureSessionManifestV1,
	result: FramescaperCapturePublicationResult,
): void {
	if (!options.scheduleDerivatives) return;
	const request = Object.freeze({
		projectId: manifest.projectFence.projectId,
		sessionId: manifest.sessionId,
		sourceIds: Object.freeze(result.plan.entries.map(({ sourceId }) => sourceId)),
		plan: result.plan,
	});
	void Promise.resolve()
		.then(() => options.scheduleDerivatives!(request))
		.catch((error: unknown) => {
			try { options.onDerivativeWarning?.(error); } catch { /* Warning sinks cannot fail a committed capture. */ }
		});
}

function assertOptions(options: FramescaperCaptureCanonicalPublicationOptions): void {
	if (!options || typeof options !== 'object'
		|| !options.manifests
		|| typeof options.manifests.load !== 'function'
		|| typeof options.manifests.replace !== 'function'
		|| typeof options.probeVideo !== 'function'
		|| typeof options.assertProjectFence !== 'function'
		|| typeof options.commitAtomic !== 'function'
		|| typeof options.recordRetryableRecovery !== 'function') {
		throw new TypeError('Canonical capture publication dependencies are incomplete.');
	}
}
