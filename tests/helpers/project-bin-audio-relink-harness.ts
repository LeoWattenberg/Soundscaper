/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../../src/common/editor/controller/lifecycle.ts';
import {
	createProjectBinLinkedAudioRelinkService,
	type ProjectBinLinkedAudioRelinkBinding,
	type ProjectBinLinkedAudioRelinkDependencies,
	type ProjectBinLinkedAudioRelinkLocator,
} from '../../src/common/editor/controller/project-bin-linked-audio-relink-service.ts';
import { PROJECT_BIN_LINKED_VIDEO_RELINK_TASK } from '../../src/common/editor/controller/project-bin-linked-video-relink-service.ts';

export const OLD_LOCATOR = Object.freeze({
	locatorId: 'locator_audio_relink_original_01',
	locatorRevision: 'revision_audio_relink_original_01',
});
export const FIRST_LOCATOR = Object.freeze({
	locatorId: 'locator_audio_relink_selected_01',
	locatorRevision: 'revision_audio_relink_selected_01',
});
export const SECOND_LOCATOR = Object.freeze({
	locatorId: 'locator_audio_relink_selected_02',
	locatorRevision: 'revision_audio_relink_selected_02',
});
export const OLD_BINDING = Object.freeze({
	kind: 'audio' as const,
	...OLD_LOCATOR,
	bindingToken: 'binding_audio_relink_original_01',
	byteLength: 15,
	sha256: 'digest:same linked PCM',
});

export interface HarnessOptions {
	readonly missing?: boolean;
	readonly project?: ReturnType<typeof projectFixture>;
	readonly editingBlocked?: () => boolean;
	readonly getBinding?: ProjectBinLinkedAudioRelinkDependencies['getLinkedOriginalBinding'];
	readonly relink?: ProjectBinLinkedAudioRelinkDependencies['relinkLinkedAudioOriginal'];
	readonly release?: ProjectBinLinkedAudioRelinkDependencies['releaseLinkedOriginalLocator'];
	readonly retire?: ProjectBinLinkedAudioRelinkDependencies['retireSourceChunkProvider'];
	readonly invalidate?: ProjectBinLinkedAudioRelinkDependencies['invalidateSourceRuntime'];
	readonly metadata?: ProjectBinLinkedAudioRelinkDependencies['getSourceMetadata'];
	readonly activate?: ProjectBinLinkedAudioRelinkDependencies['activateStoredSource'];
	readonly admitCandidate?: ProjectBinLinkedAudioRelinkDependencies['admitChangedContentCandidate'];
}

export function createHarness(options: HarnessOptions = {}) {
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	const project = options.project ?? projectFixture();
	projectGeneration.activate(project.id);
	const missingSourceIds = new Set(options.missing === false ? [] : ['audio-source']);
	const order: string[] = [];
	const releases: Array<Readonly<{ kind: 'audio' } & ProjectBinLinkedAudioRelinkLocator>> = [];
	const relinks: Array<Readonly<{
		projectId: string;
		source: unknown;
		locatorId: string;
		options: Parameters<ProjectBinLinkedAudioRelinkDependencies['relinkLinkedAudioOriginal']>[3];
	}>> = [];
	const previewOptions: Array<Readonly<{ dispose: true }>> = [];
	const invalidatedSourceIds: string[] = [];
	const metadataKeys: string[] = [];
	let publishCount = 0;
	const dependencies: ProjectBinLinkedAudioRelinkDependencies = {
		lifetime,
		missingSourceIds,
		editingBlocked: options.editingBlocked ?? (() => false),
		getProject: () => project,
		captureProject: () => projectGeneration.capture(),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		async getLinkedOriginalBinding(projectId, sourceId) {
			order.push('binding');
			return options.getBinding
				? options.getBinding(projectId, sourceId)
				: OLD_BINDING;
		},
		async digestContent(blob) { return `digest:${await blob.text()}`; },
		async admitChangedContentCandidate(file, source, admitOptions) {
			order.push('probe');
			return options.admitCandidate?.(file, source, admitOptions);
		},
		async stopTimelinePlayback() { order.push('timeline'); },
		async stopProjectBinPreview(stopOptions) {
			order.push('preview');
			previewOptions.push(stopOptions);
		},
		async retireSourceChunkProvider(sourceId) {
			assert.equal(sourceId, 'audio-source');
			order.push('retire');
			await options.retire?.(sourceId);
		},
		async relinkLinkedAudioOriginal(projectId, source, locatorId, relinkOptions) {
			order.push('relink');
			relinks.push({ projectId, source, locatorId, options: relinkOptions });
			if (options.relink) return options.relink(projectId, source, locatorId, relinkOptions);
			relinkOptions.assertCanPublish();
			return replacementBinding({
				locatorId,
				locatorRevision: relinkOptions.expectedLocatorRevision,
			});
		},
		async releaseLinkedOriginalLocator(reference) {
			order.push('release');
			releases.push(reference);
			return options.release ? options.release(reference) : true;
		},
		async invalidateSourceRuntime(sourceId) {
			order.push('invalidate');
			invalidatedSourceIds.push(sourceId);
			await options.invalidate?.(sourceId);
		},
		async getSourceMetadata(storageKey) {
			order.push('metadata');
			metadataKeys.push(storageKey);
			if (options.metadata) return options.metadata(storageKey);
			return Object.freeze({ id: storageKey, chunkCount: 1 });
		},
		async activateStoredSource(source, metadata) {
			order.push('activate');
			if (options.activate) return options.activate(source, metadata);
			return Object.freeze({ levels: [] });
		},
		publish() {
			order.push('publish');
			publishCount += 1;
		},
	};
	const rawService = createProjectBinLinkedAudioRelinkService(dependencies);
	const target = Object.freeze({ projectId: project.id, projectRevision: project.revision });
	return {
		service: Object.freeze({
			...rawService,
			classifyLinkedAudioRelink: (clipId: string, file: Blob) => (
				rawService.classifyLinkedAudioRelink(clipId, file, target)
			),
			relinkLinkedAudio: (
				clipId: string,
				file: Blob,
				locator: ProjectBinLinkedAudioRelinkLocator,
				relinkOptions: Readonly<{ allowChangedContent?: boolean }> = {},
			) => rawService.relinkLinkedAudio(clipId, file, locator, target, relinkOptions),
		}),
		rawService,
		project,
		target,
		missingSourceIds,
		order,
		releases,
		relinks,
		previewOptions,
		invalidatedSourceIds,
		metadataKeys,
		startSharedRelink: () => lifetime.startTask(PROJECT_BIN_LINKED_VIDEO_RELINK_TASK),
		supersedeRelink: () => lifetime.startTask(PROJECT_BIN_LINKED_VIDEO_RELINK_TASK).finish(),
		invalidateProject: () => projectGeneration.invalidate(),
		get publishCount() { return publishCount; },
	};
}

export function projectFixture(extraAudio = false) {
	const extraSources = extraAudio
		? [Object.freeze({
			id: 'audio-source-two', kind: 'audio' as const, storageKey: 'audio-storage-two',
			mimeType: 'audio/wav', frameCount: 4, channelCount: 1, sampleRate: 48_000,
			originalSampleRate: 48_000, sampleFormat: 'float32' as const, chunkFrames: 2,
		})]
		: [];
	const extraClips = extraAudio
		? [Object.freeze({
			id: 'bin-audio-two', sourceId: 'audio-source-two', kind: 'audio' as const, binItemId: 'compound-item',
		})]
		: [];
	return Object.freeze({
		id: 'project-bin-linked-audio-relink-project',
		revision: 4,
		sources: Object.freeze([
			Object.freeze({
				id: 'audio-source', kind: 'audio' as const, storageKey: 'audio-storage',
				mimeType: 'audio/wav', frameCount: 4, channelCount: 1, sampleRate: 48_000,
				originalSampleRate: 48_000, sampleFormat: 'float32' as const, chunkFrames: 2,
			}),
			Object.freeze({ id: 'video-source', kind: 'video' as const, storageKey: 'video-storage' }),
			...extraSources,
		]),
		tracks: Object.freeze([]),
		projectBin: Object.freeze({ clips: Object.freeze([
			Object.freeze({
				id: 'bin-audio', sourceId: 'audio-source', kind: 'audio' as const, binItemId: 'compound-item',
			}),
			Object.freeze({
				id: 'bin-video', sourceId: 'video-source', kind: 'video' as const, binItemId: 'compound-item',
			}),
			...extraClips,
		]) }),
	});
}

export function replacementBinding(
	locator: ProjectBinLinkedAudioRelinkLocator,
): ProjectBinLinkedAudioRelinkBinding {
	return Object.freeze({
		kind: 'audio',
		...locator,
		bindingToken: 'binding_audio_relink_selected_01',
		byteLength: 22,
		sha256: 'digest:replacement linked PCM',
	});
}

export function audioFile(): File {
	return new File(['same linked PCM'], 'selected.wav', { type: 'audio/wav' });
}

export function changedAudioFile(): File {
	return new File(['replacement linked PCM'], 'replacement.wav', { type: 'audio/wav' });
}

export function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, resolve, reject };
}
