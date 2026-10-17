/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionComposition } from './motion-composition.ts';
import { verifyMotionscaperRevision, type MotionscaperRevision } from './motion-project-revision.ts';
import { freezeMotionValue, motionEnum, motionId, motionInteger, motionRational, motionRecord } from './motion-values.ts';

export type MotionCompositionOutput = Pick<MotionComposition, 'width' | 'height' | 'frameRate' | 'durationFrames' | 'color'>;
export interface MotionCompositionOffer {
	readonly protocol: 'motionscaper-composition-link'; readonly version: 1;
	readonly compositionId: string; readonly output: MotionCompositionOutput; readonly revision: MotionscaperRevision;
}
export const MOTION_LINK_MAXIMUM_OFFER_BYTES = 32 * 1024 * 1024;

/** Wire intent contains a complete saved revision; windows, paths, tokens and reader capabilities remain transport-local. */
export function createMotionCompositionOffer(compositionId: string, savedRevision: unknown): MotionCompositionOffer {
	const revision = verifyMotionscaperRevision(savedRevision); motionId(compositionId);
	const composition = revision.project.compositions.find((entry) => entry.id === compositionId);
	if (!composition) throw new ReferenceError('Linked composition is absent from its saved revision.');
	const { width, height, frameRate, durationFrames, color } = composition;
	const offer = freezeMotionValue({ protocol: 'motionscaper-composition-link' as const, version: 1 as const, compositionId,
		output: { width, height, frameRate, durationFrames, color }, revision });
	const text = JSON.stringify(offer); let byteLength = 0;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code < 0x80) byteLength++; else if (code < 0x800) byteLength += 2;
		else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) { byteLength += 4; index++; }
		else byteLength += 3;
		if (byteLength > MOTION_LINK_MAXIMUM_OFFER_BYTES) throw new RangeError('Motion composition offer exceeds its metadata byte budget.');
	}
	return offer;
}

export function normalizeMotionCompositionOffer(value: unknown): MotionCompositionOffer {
	const record = motionRecord(value, ['protocol', 'version', 'compositionId', 'output', 'revision'], 'motion composition offer');
	if (record.protocol !== 'motionscaper-composition-link' || record.version !== 1) throw new RangeError('Unsupported motion composition link protocol/version.');
	const expected = createMotionCompositionOffer(motionId(record.compositionId), record.revision);
	const output = motionRecord(record.output, ['width', 'height', 'frameRate', 'durationFrames', 'color'], 'link output');
	const color = motionRecord(output.color, ['workingSpace', 'outputSpace', 'alphaMode'], 'link color');
	const actual = { width: motionInteger(output.width, 'link width', 1, 65536), height: motionInteger(output.height, 'link height', 1, 65536),
		frameRate: motionRational(output.frameRate, 'link frame rate', true), durationFrames: motionInteger(output.durationFrames, 'link duration', 1, 100_000_000),
		color: { workingSpace: motionEnum(color.workingSpace, ['linear-rec709-d65'], 'link working space'), outputSpace: motionEnum(color.outputSpace, ['srgb', 'rec709'], 'link output space'), alphaMode: motionEnum(color.alphaMode, ['premultiplied'], 'link alpha') } };
	if (JSON.stringify(actual) !== JSON.stringify(expected.output)) throw new RangeError('Motion link output differs from its saved composition.');
	return expected;
}
