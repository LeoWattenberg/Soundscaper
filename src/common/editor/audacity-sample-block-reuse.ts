/* SPDX-License-Identifier: AGPL-3.0-only */

import { crc32 } from './wavpack/pcm.js';
import { audacityXmlAttribute, audacityXmlChildren } from './audacity-binary-xml.js';
import { AUP4_MAX_BLOCK_SAMPLES } from './aup4-profile-values.js';

type XmlNode = Parameters<typeof audacityXmlAttribute>[0];
const attribute = audacityXmlAttribute as (node: XmlNode, name: string, fallback?: unknown) => unknown;
const children = audacityXmlChildren as unknown as (node: XmlNode, name: string) => XmlNode[];

interface SampleBlock {
	readonly sampleformat: number;
	readonly samples: Uint8Array;
}

interface ExportVariant {
	readonly targetRate: number;
	readonly targetChannels: number;
	readonly transform: unknown;
	readonly inputSource: Readonly<{
		sampleRate: number; channelCount: number; frameCount: number;
		opaqueExtensions?: Readonly<Record<string, unknown>>;
	}>;
}

interface BlockRange {
	readonly start: number;
	readonly frameCount: number;
	readonly silent: boolean;
}

/** A transaction-local index: rolled-back rows never enter the snapshot's reuse index. */
export function createAudacitySampleBlockReuse(
	committed: Map<string, number[]>,
	read: (id: number) => SampleBlock | null,
) {
	const pending = new Map<string, number[]>();
	return {
		write(block: SampleBlock, insert: () => number): { blockId: number; inserted: boolean } {
			const key = `${block.sampleformat}:${block.samples.length}:${crc32(block.samples)}`;
			for (const id of [...(pending.get(key) ?? []), ...(committed.get(key) ?? [])]) {
				const candidate = read(id);
				// Checksums only select candidates; exact bytes decide whether reuse is safe.
				if (candidate?.sampleformat === block.sampleformat && equalBytes(candidate.samples, block.samples)) {
					return { blockId: id, inserted: false };
				}
			}
			const blockId = insert();
			const ids = pending.get(key) ?? [];
			ids.push(blockId);
			pending.set(key, ids);
			return { blockId, inserted: true };
		},
		commit(): void {
			for (const [key, ids] of pending) committed.set(key, [...(committed.get(key) ?? []), ...ids]);
			pending.clear();
		},
	};
}

/** Original boundaries are usable only while rate, layout and material are unchanged. */
export function audacityExportBlockRanges(variant: ExportVariant, channel: number, frames: number): BlockRange[] {
	const opaque = variant.inputSource.opaqueExtensions?.aup4ChannelSequences as readonly Readonly<{ node: XmlNode }>[] | undefined;
	const sequence = !variant.transform && variant.targetRate === variant.inputSource.sampleRate
		&& variant.targetChannels === variant.inputSource.channelCount ? opaque?.[channel]?.node : undefined;
	const blocks = sequence ? children(sequence, 'waveblock') : [];
	const starts = blocks.map((block) => Number(attribute(block, 'start', -1)));
	const valid = starts.length > 0 && starts[0] === 0
		&& Number(attribute(sequence, 'numsamples', -1)) === frames
		&& starts.every((start, index) => Number.isSafeInteger(start) && start >= 0 && start < frames
			&& (index === 0 || start > starts[index - 1]!));
	const boundaries = valid ? starts : [0];
	const ranges: BlockRange[] = [];
	for (const [index, start] of boundaries.entries()) {
		const end = boundaries[index + 1] ?? frames;
		for (let offset = start; offset < end; offset += AUP4_MAX_BLOCK_SAMPLES) {
			ranges.push({ start: offset, frameCount: Math.min(end - offset, AUP4_MAX_BLOCK_SAMPLES),
				silent: valid && Number(attribute(blocks[index], 'blockid', 0)) < 0 });
		}
	}
	return ranges;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
