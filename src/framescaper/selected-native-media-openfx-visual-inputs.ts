/* SPDX-License-Identifier: AGPL-3.0-only */
import {
	materializeUnifiedExactRenderVisualEntryV13,
	type UnifiedExactRenderVisualRgbaV13,
} from '../common/editor/unified-exact-render-visual-materializer-v13.ts';
import type {
	UnifiedExactRenderVisualFrameEntryV13,
	UnifiedExactRenderVisualFrameLayerV13,
} from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import type { FramescaperVideoFrameAddressFinishing } from './video-frame-address-finishing.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';
import type { createFramescaperSelectedOpenFxExactPlanesNativeMedia } from './selected-native-media-openfx-exact-planes.ts';

export async function materializeFramescaperSelectedOpenFxVisualsNativeMedia(
	entries: readonly UnifiedExactRenderVisualFrameEntryV13[],
	stills: ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>,
	width: number,
	height: number,
	signal: AbortSignal,
	openFx: ReturnType<typeof createFramescaperSelectedOpenFxExactPlanesNativeMedia> | null,
): Promise<ReadonlyMap<string, UnifiedExactRenderVisualRgbaV13>> {
	const result = new Map<string, UnifiedExactRenderVisualRgbaV13>();
	for (const entry of entries) {
		const sourceId = 'source' in entry.authoredState ? String(entry.authoredState.source.id) : null;
		const external = entry.modelKind === 'external-generator' && sourceId !== null;
		if (external && !openFx?.has('generator', sourceId) && !openFx?.has('general', sourceId)) {
			throw new Error('An external generator requires an exact selected nativeMedia OpenFX node.');
		}
		const raw = external ? Object.freeze({
			width, height, pixels: new Uint8Array(width * height * 4),
		}) : await materializeUnifiedExactRenderVisualEntryV13(Object.freeze({
			...entry, masks: Object.freeze([]),
		}), {
			targetWidth: width, targetHeight: height,
			decodeStill: (source) => Promise.resolve(required(stills, source.id)),
			signal,
		});
		result.set(entry.modelId, raw);
		if (sourceId !== null) result.set(sourceId, raw);
	}
	return result;
}

export function orderedFramescaperSelectedOpenFxVisualEntriesNativeMedia(
	layers: readonly UnifiedExactRenderVisualFrameLayerV13[],
) {
	const values = layers.flatMap(({ trackId, entries }) => entries.map((entry) => ({ trackId, entry })));
	const bySource = new Map(values.flatMap((value) => 'source' in value.entry.authoredState
		? [[String(value.entry.authoredState.source.id), value] as const] : []));
	const dependencies = new Map(values.map((value) => {
		const state = 'source' in value.entry.authoredState ? value.entry.authoredState.source : null;
		const generator = state?.kind === 'generator' ? state.generator : null;
		const inputs = generator?.kind === 'external-generator' ? generator.inputs : [];
		return [value, new Set(inputs.map(({ sourceRef }) => sourceRef).filter((id) => bySource.has(id)))] as const;
	}));
	const output: typeof values = [];
	const completed = new Set<string>();
	while (output.length < values.length) {
		const ready = values.filter((value) => !output.includes(value)
			&& [...dependencies.get(value)!].every((id) => completed.has(id)))
			.sort((left, right) => compareText(left.entry.modelId, right.entry.modelId));
		if (ready.length === 0) throw new Error('Selected nativeMedia external-generator dependencies cannot be ordered.');
		for (const value of ready) {
			output.push(value);
			if ('source' in value.entry.authoredState) completed.add(String(value.entry.authoredState.source.id));
		}
	}
	return output;
}

export function framescaperSelectedOpenFxFrozenFrameResolverNativeMedia(
	plan: FramescaperSelectedOpenFxExecutionNativeMedia['plan'],
	sourceFrames: FramescaperVideoFrameAddressFinishing,
): NonNullable<FramescaperSelectedOpenFxExecutionNativeMedia['resolveFrozenFrame']> {
	return async (fallback, _effect, outputOrdinal, signal) => {
		const source = plan.sources.find(({ sourceId }) => sourceId === fallback.externalMediaSourceId);
		const timing = source?.timing as unknown as Readonly<{ readonly frameCount?: unknown }> | undefined;
		if (!source || source.contentSha256 !== fallback.renderedAssetSha256
			|| timing?.frameCount !== fallback.frameCount || outputOrdinal >= fallback.frameCount) return null;
		try {
			const value = await sourceFrames.resolve({
				sourceId: source.sourceId, sourceFrame: outputOrdinal,
				width: plan.output.canvas.width, height: plan.output.canvas.height, signal,
			});
			return Object.freeze({ width: value.width, height: value.height,
				pixels: value.pixels.slice() as Uint8Array<ArrayBuffer> });
		} catch (error) {
			if (signal.aborted) throw error;
			return null;
		}
	};
}

function required<Value>(values: ReadonlyMap<string, Value>, id: string): Value {
	const value = values.get(id);
	if (!value) throw new ReferenceError(`Selected finishing visual ${id} is unavailable.`);
	return value;
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
