/* SPDX-License-Identifier: AGPL-3.0-only */

import { audacityXmlAttribute, audacityXmlChildren } from './audacity-binary-xml.js';
import { scaleSampleFrame } from './timeline-time.ts';

type XmlNode = Parameters<typeof audacityXmlAttribute>[0];
const attribute = audacityXmlAttribute as (node: XmlNode, name: string, fallback?: unknown) => unknown;
const children = audacityXmlChildren as unknown as (node: XmlNode, name: string) => XmlNode[];

export const AUP4_IMPORT_CHUNK_FRAMES = 65_536;

export interface Aup4ImportBlock {
	readonly blockId: number;
	readonly start: number;
	readonly frameCount: number;
}

export interface Aup4ImportChannel {
	readonly sampleRate: number;
	readonly frameCount: number;
	readonly outputFrames: number;
	readonly blocks: readonly Aup4ImportBlock[];
}

export interface Aup4ImportAudioPlan {
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly channelPlans: readonly Aup4ImportChannel[];
}

export interface Aup4ImportSourcePlan extends Aup4ImportAudioPlan {
	readonly sourceId: string;
}

/** Uses the validated sequence references; it never allocates sample buffers. */
export function planAup4ClipAudio(
	nodes: readonly XmlNode[], rates: readonly number[], sampleRate: number,
): Aup4ImportAudioPlan {
	if (!nodes.length || nodes.length > 2 || rates.length !== nodes.length) throw new Error('Invalid Audacity channel layout.');
	const channelPlans = nodes.map((node, index): Aup4ImportChannel => {
		const sequence = node ? children(node, 'sequence')[0] : null;
		const frameCount = safeInteger(attribute(sequence, 'numsamples', 0));
		const blocks = children(sequence, 'waveblock');
		const plan = blocks.map((block, blockIndex): Aup4ImportBlock => {
			const start = safeInteger(attribute(block, 'start', 0));
			const end = blockIndex + 1 < blocks.length
				? safeInteger(attribute(blocks[blockIndex + 1], 'start', 0)) : frameCount;
			const blockId = Number(attribute(block, 'blockid', 0));
			const length = end - start;
			const declared = attribute(block, 'length', null);
			if (!Number.isSafeInteger(blockId) || blockId === 0 || length <= 0
				|| (blockIndex === 0 && start !== 0) || end > frameCount
				|| (blockId < 0 && -blockId !== length)
				|| (declared !== null && Number(declared) !== length)) throw corruptSequence();
			return { blockId, start, frameCount: length };
		});
		if (frameCount > 0 && !plan.length) throw corruptSequence();
		const rate = rates[index]!;
		if (![rate, sampleRate].every((value) => Number.isInteger(value) && value >= 1 && value <= 768_000)) {
			throw new Error('Invalid Audacity sample rate.');
		}
		const outputFrames = frameCount ? Math.max(1, scaleSampleFrame(frameCount, rate, sampleRate)) : 0;
		return { sampleRate: rate, frameCount, outputFrames, blocks: plan };
	});
	const frameCount = Math.max(...channelPlans.map((channel) => channel.outputFrames));
	if (!Number.isSafeInteger(frameCount * nodes.length * 4)) throw corruptSequence();
	return { frameCount, channelCount: nodes.length, sampleRate, channelPlans };
}

function safeInteger(value: unknown): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw corruptSequence();
	return number;
}

function corruptSequence(): Error {
	return Object.assign(new Error('An Audacity sequence has inconsistent sample-block lengths.'), { code: 'CORRUPT_SEQUENCE' });
}
