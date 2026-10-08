/* SPDX-License-Identifier: AGPL-3.0-only */

type Data = Readonly<Record<string, unknown>>;

/** Inherited splits allocate new effect identities; keep their layer membership replay-safe. */
export function adjustmentLayersAfterSplit(
	layers: readonly Data[], originalClips: readonly Data[], appliedClips: readonly Data[],
	command: unknown,
): Data[] {
	const clips = new Map(originalClips.map((clip) => [String(clip.id), clip]));
	const replacements = new Map<string, Set<string>>();
	const allocate = (source: Data | undefined, targetId: unknown, effectIds: unknown): void => {
		if (!source || typeof targetId !== 'string' || !Array.isArray(effectIds)) return;
		const effects = records(source.videoEffects);
		if (effects.length !== effectIds.length) return;
		const cloned = effects.map((effect, index) => {
			const nextId: unknown = effectIds[index];
			if (typeof nextId !== 'string') return effect;
			const priorId = String(effect.id);
			const targets = replacements.get(priorId) ?? new Set<string>();
			targets.add(nextId);
			replacements.set(priorId, targets);
			return { ...effect, id: nextId };
		});
		clips.set(targetId, { ...source, id: targetId, videoEffects: cloned });
	};
	const visit = (value: unknown): void => {
		const item = record(value);
		if (!item) return;
		if (item.type === 'batch' && Array.isArray(item.commands)) {
			for (const child of item.commands) visit(child);
			return;
		}
		if (item.type !== 'clip/split') return;
		const source = clips.get(String(item.clipId));
		allocate(source, item.rightClipId, item.rightVideoEffectIds);
		if (source?.avLinkId) {
			const peer = [...clips.values()].find((clip) => clip.id !== source.id && clip.avLinkId === source.avLinkId);
			allocate(peer, item.linkedRightClipId, item.linkedRightVideoEffectIds);
		}
	};
	visit(command);
	const surviving = new Set(appliedClips.flatMap((clip) => records(clip.videoEffects).map((effect) => String(effect.id))));
	return layers.map((layer) => {
		const ids = new Set(Array.isArray(layer.effectIds) ? layer.effectIds.map(String) : []);
		const expand = (id: string): void => {
			for (const target of replacements.get(id) ?? []) {
				if (!surviving.has(target) || ids.has(target)) continue;
				ids.add(target);
				expand(target);
			}
		};
		for (const id of ids) expand(id);
		return { ...layer, effectIds: [...ids] };
	});
}

/** Resolve the member this selected clip owns, rather than another segment's effect. */
export function selectedAdjustmentEffectId(layer: Data, clip: Data): string | null {
	const ids = Array.isArray(layer.effectIds) ? layer.effectIds : [];
	const owned = records(clip.videoEffects).filter((effect) => ids.includes(effect.id));
	return owned.length === 1 && typeof owned[0]?.id === 'string' ? owned[0].id : null;
}

function record(value: unknown): Data | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : null;
}

function records(value: unknown): Data[] {
	return Array.isArray(value) ? value.map(record).filter((item): item is Data => item !== null) : [];
}
