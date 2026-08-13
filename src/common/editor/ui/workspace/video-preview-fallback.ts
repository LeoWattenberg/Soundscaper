/* SPDX-License-Identifier: AGPL-3.0-only */

interface VideoPreviewFallbackClip {
	readonly available?: unknown;
	readonly clipId?: unknown;
	readonly clip?: Readonly<{ videoEffects?: readonly unknown[] }>;
	readonly renderDescription?: unknown;
}

interface VideoPreviewFallbackLayer {
	readonly clips?: readonly VideoPreviewFallbackClip[];
}

interface VideoPreviewFallbackLedgerEntry {
	readonly clipId: string;
	readonly effects: readonly unknown[];
	readonly renderDescription?: unknown;
}

interface VideoPreviewFallbackLedgerLayer {
	readonly blendMode?: string;
	readonly entries: readonly VideoPreviewFallbackLedgerEntry[];
}

export interface VideoPreviewRenderIssue {
	readonly requestedEffectCount: number;
	readonly omittedEffectIds: readonly string[];
	readonly requestedCompositionCount: number;
	readonly omittedCompositionClipIds: readonly string[];
}

/** Preserve canonical composition identity when WebGL construction never starts. */
export function createVideoPreviewFallbackLedgerLayers(
	layers: readonly VideoPreviewFallbackLayer[],
	effectsFor: (clipId: string, effects: readonly unknown[]) => readonly unknown[],
): readonly VideoPreviewFallbackLedgerLayer[] {
	if (!Array.isArray(layers) || typeof effectsFor !== 'function') {
		throw new TypeError('Video preview fallback layers and an effect resolver are required.');
	}
	const sourceLayers: readonly VideoPreviewFallbackLayer[] = layers;
	return Object.freeze(sourceLayers.map((layer) => {
		const entries = Object.freeze((layer?.clips ?? [])
			.filter((clip) => clip?.available === true)
			.map((clip) => {
				if (typeof clip.clipId !== 'string' || clip.clipId.length === 0) {
					throw new TypeError('Video preview fallback clips require stable IDs.');
				}
				return Object.freeze({
					clipId: clip.clipId,
					effects: effectsFor(clip.clipId, clip.clip?.videoEffects ?? []),
					...(clip.renderDescription == null
						? {}
						: { renderDescription: clip.renderDescription }),
				});
			}));
		const blendMode = entries
			.map((entry) => renderDescriptionBlendMode(entry.renderDescription))
			.find((value) => value != null);
		return Object.freeze({
			...(blendMode == null ? {} : { blendMode }),
			entries,
		});
	}));
}

/** Reduce the renderer ledger to the bounded diagnostics exposed by the panel. */
export function resolveVideoPreviewRenderIssue(report: unknown): VideoPreviewRenderIssue {
	const record = objectRecord(report);
	const effects = objectRecord(record?.effects);
	const composition = objectRecord(record?.composition);
	const requestedEffects = stringArray(effects?.requested);
	const omittedEffects = stringArray(effects?.omitted);
	const requestedComposition = requestedCompositionIds(composition?.requested);
	const omittedComposition = uniqueStrings([
		...stringArray(composition?.fallbackRendered),
		...stringArray(composition?.omitted),
	]);
	return Object.freeze({
		requestedEffectCount: requestedEffects.length,
		omittedEffectIds: omittedEffects,
		requestedCompositionCount: requestedComposition.length,
		omittedCompositionClipIds: omittedComposition,
	});
}

/** A raw contain-fit video is never a valid fallback for a canonical description. */
export function shouldHideVideoPreviewIdentityFallback(
	rendererState: unknown,
	renderDescription: unknown,
): boolean {
	return rendererState === 'fallback' && renderDescription != null;
}

function renderDescriptionBlendMode(value: unknown): string | null {
	const record = objectRecord(value);
	return typeof record?.blendMode === 'string' ? record.blendMode : null;
}

function requestedCompositionIds(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	return uniqueStrings(value.flatMap((item) => {
		const record = objectRecord(item);
		return typeof record?.clipId === 'string' ? [record.clipId] : [];
	}));
}

function stringArray(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	return uniqueStrings(value.filter((item): item is string => typeof item === 'string'));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
	return Object.freeze([...new Set(values)]);
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}
