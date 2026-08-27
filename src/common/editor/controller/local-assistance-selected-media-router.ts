/* SPDX-License-Identifier: AGPL-3.0-only */

/** Operation-owned routing across exact selected audio and selected video custody. */

import type { AssistanceOperation } from '../assistance/operation.ts';
import type { LocalAssistanceShotDetectionMode } from '../assistance/shot-detection-mode.ts';

export interface LocalAssistancePreparationInventorySource {
	readonly sourceId: string;
	readonly label: string;
	readonly mediaKind: 'audio' | 'video';
	readonly operations: readonly AssistanceOperation[];
}

export interface LocalAssistancePreparationInventory {
	readonly sources: readonly LocalAssistancePreparationInventorySource[];
}

export interface LocalAssistancePreparationRequest {
	readonly sourceId: string;
	readonly operation: AssistanceOperation;
	readonly shotDetectionMode?: LocalAssistanceShotDetectionMode;
	readonly inputRole?: 'video' | 'frame-pack';
	readonly signal?: AbortSignal;
}

export interface LocalAssistanceSelectedMediaPreparationPort<Prepared = unknown, Description = unknown> {
	listSelectedMedia(): Promise<LocalAssistancePreparationInventory>;
	prepareSelectedMedia(request: LocalAssistancePreparationRequest): Promise<Prepared>;
	describeSelectedVideoSourceTime?(): Promise<Description>;
	acceptValidatedResult?(request: unknown): Promise<void>;
}

export interface LocalAssistanceSelectedMediaPreparationRouter<
	AudioPrepared = unknown, VideoPrepared = unknown, VideoDescription = unknown,
>
{
	listSelectedMedia(): Promise<LocalAssistancePreparationInventory>;
	prepareSelectedMedia(request: LocalAssistancePreparationRequest): Promise<AudioPrepared | VideoPrepared>;
	describeSelectedVideoSourceTime(): Promise<VideoDescription>;
	acceptValidatedResult?(request: unknown): Promise<void>;
}

export interface LocalAssistanceSelectedMediaPreparationRouterDependencies<
	AudioPrepared = unknown,
	VideoPrepared = unknown,
	VideoDescription = unknown,
> {
	readonly audio: LocalAssistanceSelectedMediaPreparationPort<AudioPrepared>;
	readonly video: LocalAssistanceSelectedMediaPreparationPort<VideoPrepared, VideoDescription> | null;
}

const VIDEO_OPERATIONS = new Set<AssistanceOperation>([
	'shot-detection', 'subject-detection', 'saliency-detection',
]);

/** Keep video-owned preparation separate from the audio render pipeline. */
export function createLocalAssistanceSelectedMediaPreparationRouter<
	AudioPrepared, VideoPrepared, VideoDescription,
>(
	dependencies: LocalAssistanceSelectedMediaPreparationRouterDependencies<
		AudioPrepared, VideoPrepared, VideoDescription
	>,
): Readonly<LocalAssistanceSelectedMediaPreparationRouter<
	AudioPrepared, VideoPrepared, VideoDescription
>> {
	if (!dependencies || typeof dependencies !== 'object'
		|| !preparationPort(dependencies.audio)
		|| (dependencies.video !== null && !preparationPort(dependencies.video))) {
		throw new TypeError('Selected-media routing requires its exact preparation ports.');
	}

	async function listSelectedMedia(): Promise<LocalAssistancePreparationInventory> {
		const [audio, video] = await Promise.all([
			dependencies.audio.listSelectedMedia(),
			dependencies.video?.listSelectedMedia() ?? Promise.resolve({ sources: [] }),
		]);
		return Object.freeze({ sources: Object.freeze([...audio.sources, ...video.sources]) });
	}

	function prepareSelectedMedia(
		request: LocalAssistancePreparationRequest,
	): Promise<AudioPrepared | VideoPrepared> {
		if (!VIDEO_OPERATIONS.has(request?.operation)) {
			return dependencies.audio.prepareSelectedMedia(request);
		}
		if (!dependencies.video) {
			return Promise.reject(new Error('Exact selected video preparation is unavailable.'));
		}
		return dependencies.video.prepareSelectedMedia(request);
	}

	function describeSelectedVideoSourceTime(): Promise<VideoDescription> {
		if (!dependencies.video?.describeSelectedVideoSourceTime) {
			return Promise.reject(new Error('Exact selected video preparation is unavailable.'));
		}
		return dependencies.video.describeSelectedVideoSourceTime();
	}

	return Object.freeze({
		listSelectedMedia,
		prepareSelectedMedia,
		describeSelectedVideoSourceTime,
		...(dependencies.audio.acceptValidatedResult ? {
			acceptValidatedResult: (request: unknown) => (
				dependencies.audio.acceptValidatedResult!(request)
			),
		} : {}),
	});
}

function preparationPort(value: unknown): value is LocalAssistanceSelectedMediaPreparationPort {
	return Boolean(value && typeof value === 'object'
		&& typeof (value as LocalAssistanceSelectedMediaPreparationPort).listSelectedMedia === 'function'
		&& typeof (value as LocalAssistanceSelectedMediaPreparationPort).prepareSelectedMedia === 'function');
}
