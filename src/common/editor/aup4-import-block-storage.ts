/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Aup4ImportBlock, Aup4ImportSourcePlan } from './aup4-import-plan.ts';
import type { SampleBlockReference } from './storage/sample-block-source.ts';

export interface AudacitySampleBlockSequence {
	readonly sourceId: string;
	readonly baseSourceId: string;
	readonly channels: readonly (readonly SampleBlockReference[])[];
}

export interface AudacitySampleBlockStoragePlan {
	readonly pcmBytes: number;
	readonly backingSources: readonly Aup4ImportSourcePlan[];
	readonly sequences: readonly AudacitySampleBlockSequence[];
}

/** Keep Audacity block identity, order and silence while storing each compatible block once. */
export function planAudacitySampleBlockStorage(
	sources: readonly Aup4ImportSourcePlan[], poolSourceId: string,
): AudacitySampleBlockStoragePlan {
	const poolBlocks: Aup4ImportBlock[] = [];
	const blocksById = new Map<number, Aup4ImportBlock>();
	const backingSources: Aup4ImportSourcePlan[] = [];
	const sequences: AudacitySampleBlockSequence[] = [];
	let poolFrames = 0;
	for (const source of sources) {
		// Whole-channel resampling needs neighbouring samples. Preserve the existing
		// bounded stream for incompatible channel rates rather than resample blocks separately.
		if (source.channelPlans.some((channel) => channel.sampleRate !== source.sampleRate)) {
			backingSources.push(source);
			continue;
		}
		const channels = source.channelPlans.map((channel) => channel.blocks.map((block): SampleBlockReference => {
			if (block.blockId < 0) return { start: block.start, frameCount: block.frameCount, poolStartFrame: null };
			let pooled = blocksById.get(block.blockId);
			if (pooled && pooled.frameCount !== block.frameCount) throw new Error('An Audacity sample block has inconsistent reference lengths.');
			if (!pooled) {
				pooled = { ...block, start: poolFrames };
				blocksById.set(block.blockId, pooled);
				poolBlocks.push(pooled);
				poolFrames += block.frameCount;
			}
			return { start: block.start, frameCount: block.frameCount, poolStartFrame: pooled.start };
		}));
		sequences.push({ sourceId: source.sourceId, baseSourceId: poolSourceId, channels });
	}
	if (sequences.length) {
		// A one-frame backing source keeps all-silence projects on the same fenced
		// source lifetime without materializing their potentially enormous silence.
		if (!poolFrames) { poolFrames = 1; poolBlocks.push({ blockId: -1, start: 0, frameCount: 1 }); }
		backingSources.unshift({ sourceId: poolSourceId, sampleRate: sources[0]!.sampleRate,
			channelCount: 1, frameCount: poolFrames, channelPlans: [{ sampleRate: sources[0]!.sampleRate,
				frameCount: poolFrames, outputFrames: poolFrames, blocks: poolBlocks }] });
	}
	const pcmBytes = backingSources.reduce((total, source) => total + source.frameCount * source.channelCount * 4, 0);
	if (!Number.isSafeInteger(pcmBytes)) throw new RangeError('Audacity backing PCM exceeds the safe byte range.');
	return { pcmBytes, backingSources, sequences };
}
