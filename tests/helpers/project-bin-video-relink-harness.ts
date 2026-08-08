/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../../src/common/editor/controller/lifecycle.ts';
import {
	createProjectBinLinkedVideoRelinkService,
	type ProjectBinLinkedVideoRelinkBinding,
	type ProjectBinLinkedVideoRelinkDependencies,
	type ProjectBinLinkedVideoRelinkLocator,
} from '../../src/common/editor/controller/project-bin-linked-video-relink-service.ts';

export const OLD_LOCATOR = Object.freeze({
	locatorId: 'locator_relink_original_0001',
	locatorRevision: 'revision_relink_original_01',
});
export const FIRST_LOCATOR = Object.freeze({
	locatorId: 'locator_relink_selected_0001',
	locatorRevision: 'revision_relink_selected_01',
});
export const SECOND_LOCATOR = Object.freeze({
	locatorId: 'locator_relink_selected_0002',
	locatorRevision: 'revision_relink_selected_02',
});
export const OLD_BINDING = Object.freeze({
	...OLD_LOCATOR,
	bindingToken: 'binding_relink_original_0001',
	byteLength: 10,
	sha256: 'digest:same video',
});

export interface HarnessOptions {
	readonly missing?: boolean;
	readonly editingBlocked?: () => boolean;
	readonly activate?: ProjectBinLinkedVideoRelinkDependencies['activateVideoSource'];
	readonly admitCandidate?: ProjectBinLinkedVideoRelinkDependencies['admitChangedContentCandidate'];
	readonly deleteDerivatives?: ProjectBinLinkedVideoRelinkDependencies['deleteVideoDerivatives'];
	readonly getBinding?: ProjectBinLinkedVideoRelinkDependencies['getLinkedVideoOriginalBinding'];
	readonly relink?: ProjectBinLinkedVideoRelinkDependencies['relinkLinkedVideoOriginal'];
	readonly release?: ProjectBinLinkedVideoRelinkDependencies['releaseLinkedVideoOriginalLocator'];
	readonly revoke?: (missingSourceIds: Set<string>) => void;
}

export function createHarness(options: HarnessOptions = {}) {
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	const project = projectFixture();
	projectGeneration.activate(project.id);
	const missingSourceIds = new Set(options.missing === false ? [] : ['video-source']);
	const order: string[] = [];
	const releases: ProjectBinLinkedVideoRelinkLocator[] = [];
	const revokedIds: string[] = [];
	const relinks: Array<Readonly<{
		projectId: string;
		source: unknown;
		locatorId: string;
		options: Readonly<{
			admission?: 'exact-content' | 'changed-content';
			expectedBindingToken: string;
			expectedLocatorRevision: string;
			expectedSnapshot: Blob;
			assertCanPublish(): void;
			signal: AbortSignal;
		}>;
	}>> = [];
	let publishCount = 0;
	const dependencies: ProjectBinLinkedVideoRelinkDependencies = {
		lifetime,
		missingSourceIds,
		editingBlocked: options.editingBlocked ?? (() => false),
		getProject: () => project,
		captureProject: () => projectGeneration.capture(),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		async getLinkedVideoOriginalBinding(projectId, sourceId) {
			order.push('binding');
			return options.getBinding ? options.getBinding(projectId, sourceId) : OLD_BINDING;
		},
		async digestContent(blob) {
			return `digest:${await (blob as Blob).text()}`;
		},
		async admitChangedContentCandidate(candidateFile, source, admitOptions) {
			order.push('probe');
			if (options.admitCandidate) return options.admitCandidate(candidateFile, source, admitOptions);
			return undefined;
		},
		async deleteVideoDerivatives(sourceId) {
			order.push('derivatives');
			if (options.deleteDerivatives) return options.deleteDerivatives(sourceId);
			return undefined;
		},
		async stopTimelinePlayback() { order.push('timeline'); },
		async stopProjectBinPreview() { order.push('preview'); },
		async revokeVideoVisual(sourceId) {
			revokedIds.push(sourceId);
			order.push('revoke');
			options.revoke?.(missingSourceIds);
		},
		async relinkLinkedVideoOriginal(projectId, source, locatorId, relinkOptions) {
			order.push('relink');
			relinks.push({ projectId, source, locatorId, options: relinkOptions });
			if (!options.relink) relinkOptions.assertCanPublish();
			return options.relink
				? options.relink(projectId, source, locatorId, relinkOptions)
				: replacementBinding({ locatorId, locatorRevision: relinkOptions.expectedLocatorRevision });
		},
		async releaseLinkedVideoOriginalLocator(reference) {
			order.push('release');
			releases.push(reference);
			return options.release ? options.release(reference) : true;
		},
		async activateVideoSource(source, activationOptions) {
			order.push('activate');
			if (options.activate) return options.activate(source, activationOptions);
			return Object.freeze({ mediaUrl: 'soundscaper-app://linked-video' });
		},
		publish() {
			order.push('publish');
			publishCount += 1;
		},
	};
	const service = createProjectBinLinkedVideoRelinkService(dependencies);
	return {
		service,
		project,
		missingSourceIds,
		order,
		releases,
		relinks,
		revokedIds,
		get publishCount() { return publishCount; },
	};
}

function projectFixture() {
	return Object.freeze({
		schemaVersion: 9,
		id: 'project-bin-relink-project',
		sampleRate: 48_000,
		sources: Object.freeze([
			Object.freeze({ id: 'audio-source', kind: 'audio' as const, frameCount: 48_000 }),
			Object.freeze({
				id: 'video-source', kind: 'video' as const, storageKey: 'video-storage',
				mimeType: 'video/mp4', frameCount: 48_000, sampleRate: 48_000,
				width: 1_920, height: 1_080, frameRate: 30,
				videoCodec: 'h264', audioCodec: null, hasAudio: false,
			}),
			Object.freeze({
				id: 'video-solo-source', kind: 'video' as const, storageKey: 'video-solo-storage',
				mimeType: 'video/mp4', frameCount: 24_000, sampleRate: 48_000,
				width: 1_280, height: 720, frameRate: 30,
				videoCodec: 'h264', audioCodec: null, hasAudio: false,
			}),
			Object.freeze({
				id: 'video-audible-source', kind: 'video' as const, storageKey: 'video-audible-storage',
				mimeType: 'video/mp4', frameCount: 24_000, sampleRate: 48_000,
				width: 1_280, height: 720, frameRate: 30,
				videoCodec: 'h264', audioCodec: 'aac', hasAudio: true,
			}),
		]),
		clips: Object.freeze([]),
		tracks: Object.freeze([]),
		projectBin: Object.freeze({ clips: Object.freeze([
			Object.freeze({
				id: 'bin-audio', sourceId: 'audio-source', kind: 'audio' as const, binItemId: 'compound-item',
			}),
			Object.freeze({
				id: 'bin-video', sourceId: 'video-source', kind: 'video' as const, binItemId: 'compound-item',
			}),
			Object.freeze({
				id: 'bin-solo-audio', sourceId: 'audio-source', kind: 'audio' as const, binItemId: 'solo-item',
			}),
			Object.freeze({
				id: 'bin-solo-video', sourceId: 'video-solo-source', kind: 'video' as const,
				binItemId: 'solo-video-item',
			}),
			Object.freeze({
				id: 'bin-audible-video', sourceId: 'video-audible-source', kind: 'video' as const,
				binItemId: 'audible-video-item',
			}),
		]) }),
	});
}

export function replacementBinding(
	locator: ProjectBinLinkedVideoRelinkLocator,
): ProjectBinLinkedVideoRelinkBinding {
	return Object.freeze({
		...locator,
		bindingToken: 'binding_relink_selected_0001',
		byteLength: 24,
		sha256: 'digest:published replacement',
	});
}

export function videoFile(): File {
	return new File(['same video'], 'selected.mp4', { type: 'video/mp4' });
}

export function changedVideoFile(): File {
	return new File(['replacement video body'], 'replacement.mp4', { type: 'video/mp4' });
}

export function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}
