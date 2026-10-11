/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveVideoPreviewVisual } from './video-preview-visual.ts';

type Entry = Readonly<{ source?: unknown; clipId: string; sourceId: string }>;
/** Product materializers supply composition pixels; HTML media owns only decoded URL leaves. */
export function resolveVideoPreviewMediaLayers<E extends Entry, L extends Readonly<{ clips: readonly E[] }>>(options: Readonly<{
	layers: readonly L[]; controller: Parameters<typeof resolveVideoPreviewVisual>[0];
	missingSourceIds: ReadonlySet<string>; failedSources: ReadonlyMap<string, string | null>;
}>): (Omit<L, 'clips'> & { clips: (E & { sourceUrl: string | null; available: boolean })[] })[] {
	return options.layers.map(layer => ({ ...layer, clips: layer.clips.flatMap(entry => {
		const visual = resolveVideoPreviewVisual(options.controller, entry.clipId, entry.sourceId);
		if (visual?.mediaKind === 'composition') return [];
		const sourceUrl = visual?.mediaUrl || visual?.url || null;
		return [{ ...entry, sourceUrl, available: Boolean(entry.source && sourceUrl && visual?.available !== false
			&& (visual?.mediaKind === 'proxy' || !options.missingSourceIds.has(entry.sourceId)) && options.failedSources.get(entry.clipId) !== sourceUrl) }];
	}) }));
}
