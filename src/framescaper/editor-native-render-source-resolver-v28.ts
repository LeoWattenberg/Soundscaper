/* SPDX-License-Identifier: AGPL-3.0-only */

/** Mixed HTML-video/native-sequence resolution for the selected V28 Web carrier. */

import { normalizeNativeMediaImageSequenceSourceV25 } from '../common/editor/native-media-image-sequence-v25.ts';
import {
	createFramescaperNativeImageSequenceSourceResolver,
	type FramescaperNativeImageSequenceSourceAsset,
	type FramescaperNativeImageSequenceSourceResolver,
} from '../common/editor/ui/framescaper-native-image-sequence-source-resolver.ts';
import type { FramescaperNativeServicesBridge } from '../common/editor/ui/framescaper-native-services-bridge.ts';
import type {
	VideoKeyframeOfflineHtmlVideoSourceAsset,
	VideoKeyframeOfflineHtmlVideoSourceResolver,
} from '../common/editor/ui/video-keyframe-offline-html-video-source-resolver.ts';
import type { VideoKeyframeOfflineSourceResolver } from '../common/editor/ui/video-keyframe-offline-rgba-source.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';

export interface FramescaperNativeCarrierSourceResolverV28 {
	readonly resolveSource: VideoKeyframeOfflineSourceResolver;
	dispose(): PromiseLike<void> | void;
}

export interface FramescaperNativeCarrierSourceResolverDependenciesV28 {
	readonly createHtmlResolver: (
		options: Readonly<{ sources: readonly VideoKeyframeOfflineHtmlVideoSourceAsset[] }>,
	) => VideoKeyframeOfflineHtmlVideoSourceResolver;
	readonly createImageSequenceResolver?: typeof createFramescaperNativeImageSequenceSourceResolver;
	readonly nativeBridge: () => FramescaperNativeServicesBridge | null;
	readonly createCanvas: () => HTMLCanvasElement;
	readonly assertCurrent: () => void;
}

/** Never hand a custom sequence pack to HTMLVideoElement; route its source ID to the decoded claim. */
export function createFramescaperNativeCarrierSourceResolverV28(
	assets: readonly VideoKeyframeOfflineHtmlVideoSourceAsset[],
	project: FramescaperProjectV28,
	dependencies: FramescaperNativeCarrierSourceResolverDependenciesV28,
): FramescaperNativeCarrierSourceResolverV28 {
	const sequenceAssets = nativeSequenceAssets(assets, project);
	const sequenceIds = new Set(sequenceAssets.map(({ sourceId }) => sourceId));
	const ordinaryAssets = assets.filter(({ sourceId }) => !sequenceIds.has(sourceId));
	const html = ordinaryAssets.length ? dependencies.createHtmlResolver({ sources: ordinaryAssets }) : null;
	let sequence: FramescaperNativeImageSequenceSourceResolver | null = null;
	try {
		if (sequenceAssets.length) {
			if (typeof project.id !== 'string' || !Number.isSafeInteger(project.revision)
				|| Number(project.revision) < 0) {
				throw new TypeError('Native sequence carrier project identity is invalid.');
			}
			sequence = (dependencies.createImageSequenceResolver
				?? createFramescaperNativeImageSequenceSourceResolver)({
				projectId: project.id, projectRevision: Number(project.revision),
				sources: sequenceAssets, bridge: nativeSequenceBridge(dependencies.nativeBridge()),
				createCanvas: dependencies.createCanvas,
			});
		}
	} catch (error) {
		try { html?.dispose(); } catch (cleanup) {
			throw new AggregateError([error, cleanup], 'Carrier source setup and cleanup failed.', { cause: error });
		}
		throw error;
	}
	return Object.freeze({
		resolveSource: (
			entry: Readonly<Record<string, unknown>>,
			request: Readonly<{ readonly signal: AbortSignal }>,
		) => {
			dependencies.assertCurrent();
			const descriptor = Object.getOwnPropertyDescriptor(entry, 'sourceId');
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
				|| typeof descriptor.value !== 'string') {
				throw new TypeError('Carrier source entry has no own source identity.');
			}
			const selected = sequenceIds.has(descriptor.value) ? sequence : html;
			if (!selected) throw new ReferenceError(`Carrier source ${descriptor.value} has no resolver.`);
			return selected.resolveSource(entry, request);
		},
		async dispose(): Promise<void> {
			const results = await Promise.allSettled([
				Promise.resolve().then(() => html?.dispose()),
				Promise.resolve().then(() => sequence?.dispose()),
			]);
			const failures = results.filter((value): value is PromiseRejectedResult => value.status === 'rejected')
				.map(({ reason }) => reason);
			if (failures.length) throw new AggregateError(failures, 'Carrier source resolvers did not close.');
		},
	});
}

function nativeSequenceAssets(
	assets: readonly VideoKeyframeOfflineHtmlVideoSourceAsset[],
	project: FramescaperProjectV28,
): readonly FramescaperNativeImageSequenceSourceAsset[] {
	const sequences = new Map(project.sources.flatMap((source) => {
		if (source.kind !== 'video' || source.imageSequence == null) return [];
		const sequence = normalizeNativeMediaImageSequenceSourceV25(source.imageSequence);
		return [[sequence.id, sequence] as const];
	}));
	return Object.freeze(assets.flatMap((asset) => {
		const source = sequences.get(asset.sourceId);
		if (!source) return [];
		if (asset.identity !== source.sourcePack.sha256
			|| asset.decodedWidth !== source.characteristics.codedWidth
			|| asset.decodedHeight !== source.characteristics.codedHeight) {
			throw new Error('Native sequence source geometry or pack identity changed during carrier admission.');
		}
		return [Object.freeze({
			sourceId: asset.sourceId, identity: asset.identity,
			extension: source.extension as 'png' | 'tif' | 'tiff' | 'exr',
			clipIds: asset.clipIds, frameCount: source.frameCount, frameRate: source.frameRate,
			decodedWidth: asset.decodedWidth, decodedHeight: asset.decodedHeight,
			displayWidth: asset.displayWidth, displayHeight: asset.displayHeight,
			presentationForEntry: asset.presentationForEntry,
		})];
	}));
}

function nativeSequenceBridge(value: FramescaperNativeServicesBridge | null) {
	const methods = ['decodeImageSequenceSource', 'cancelImageSequenceDecode',
		'readImageSequenceDecode', 'releaseImageSequenceDecode'] as const;
	if (!value || methods.some((method) => typeof value[method] !== 'function')) {
		throw new Error('The pathless native image-sequence decode bridge is unavailable.');
	}
	return Object.freeze({
		decodeImageSequenceSource: value.decodeImageSequenceSource!.bind(value),
		cancelImageSequenceDecode: value.cancelImageSequenceDecode!.bind(value),
		readImageSequenceDecode: value.readImageSequenceDecode!.bind(value),
		releaseImageSequenceDecode: value.releaseImageSequenceDecode!.bind(value),
	});
}
