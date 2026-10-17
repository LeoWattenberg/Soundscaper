/* SPDX-License-Identifier: AGPL-3.0-only */
import { freezeMotionValue, motionArray, motionDigest, motionId, motionInteger, motionRecord, motionRational, motionEnum } from '../common/editor/motion-values.ts';
import type { MotionComposition } from '../common/editor/motion-composition.ts';
import { verifyMotionscaperRevision, type MotionscaperRevision } from '../common/editor/motion-project-revision.ts';

export interface FramescaperCompositionLink {
	readonly kind: 'motionscaper-composition'; readonly sourceId: string;
	/** Optional PCM placement shares this one accepted revision and receiver state. */
	readonly audioSourceId?: string;
	readonly projectId: string; readonly compositionId: string;
	readonly acceptedRevision: number; readonly acceptedDigest: string;
	readonly output: Pick<MotionComposition, 'width' | 'height' | 'frameRate' | 'durationFrames' | 'color'>;
	readonly snapshot: MotionscaperRevision;
	readonly dependencyDigests: readonly string[];
}

/** This persisted relation owns intent and bytes only; discovery transports remain platform-local. */
export function createFramescaperCompositionLink(sourceId: string, compositionId: string, value: unknown, options: Readonly<{ audioSourceId?: string }> = {}): FramescaperCompositionLink {
	const snapshot = verifyMotionscaperRevision(value);
	const composition = snapshot.project.compositions.find(({ id }) => id === compositionId);
	if (!composition) throw new RangeError('Linked composition is absent from the saved revision.');
	const { width, height, frameRate, durationFrames, color } = composition;
	const audioSourceId = options.audioSourceId === undefined ? undefined : motionId(options.audioSourceId);
	if (audioSourceId === sourceId) throw new RangeError('Composition audio and video sources must have distinct identities.');
	return freezeMotionValue({ kind: 'motionscaper-composition' as const, sourceId: motionId(sourceId),
		...(audioSourceId === undefined ? {} : { audioSourceId }),
		projectId: snapshot.projectId, compositionId: motionId(compositionId),
		acceptedRevision: snapshot.revision, acceptedDigest: snapshot.digest,
		output: { width, height, frameRate, durationFrames, color }, snapshot,
		dependencyDigests: snapshot.assetDigests });
}

export function normalizeFramescaperCompositionLink(value: unknown): FramescaperCompositionLink {
	const fields = ['kind', 'sourceId', 'projectId', 'compositionId', 'acceptedRevision', 'acceptedDigest', 'output', 'snapshot', 'dependencyDigests'];
	const record = motionRecord(value, [...fields, 'audioSourceId'], 'Framescaper composition link', fields);
	if (record.kind !== 'motionscaper-composition') throw new RangeError('Unsupported composition link kind.');
	const expected = createFramescaperCompositionLink(motionId(record.sourceId), motionId(record.compositionId), record.snapshot, record.audioSourceId === undefined ? {} : { audioSourceId: motionId(record.audioSourceId) });
	if (motionId(record.projectId) !== expected.projectId || motionInteger(record.acceptedRevision, 'accepted revision') !== expected.acceptedRevision
		|| motionDigest(record.acceptedDigest) !== expected.acceptedDigest) throw new RangeError('Link revision identity does not match its immutable snapshot.');
	const output = motionRecord(record.output, ['width', 'height', 'frameRate', 'durationFrames', 'color'], 'link output');
	const color = motionRecord(output.color, ['workingSpace', 'outputSpace', 'alphaMode'], 'link output color');
	const normalizedOutput = { width: motionInteger(output.width, 'link width', 1, 65536), height: motionInteger(output.height, 'link height', 1, 65536),
		frameRate: motionRational(output.frameRate, 'link frame rate', true), durationFrames: motionInteger(output.durationFrames, 'link duration', 1),
		color: { workingSpace: motionEnum(color.workingSpace, ['linear-rec709-d65'], 'link working space'), outputSpace: motionEnum(color.outputSpace, ['srgb', 'rec709'], 'link output space'), alphaMode: motionEnum(color.alphaMode, ['premultiplied'], 'link alpha') } };
	for (const field of ['width', 'height', 'frameRate', 'durationFrames', 'color'] as const) {
		if (JSON.stringify(normalizedOutput[field]) !== JSON.stringify(expected.output[field])) throw new RangeError('Link output differs from its composition contract.');
	}
	const digests = motionArray(record.dependencyDigests, 16384, 'link dependency closure').map((digest) => motionDigest(digest));
	if (JSON.stringify(digests) !== JSON.stringify(expected.dependencyDigests)) throw new RangeError('Link dependency closure is incomplete or noncanonical.');
	return expected;
}
