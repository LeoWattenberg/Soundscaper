/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { normalizeMotionAsset } from '../src/common/editor/motion-asset.ts';
import { motionWavFixture } from '../scripts/lib/motionscaper-qualification-media.ts';

/** One extra authored frame makes the first refused public range selectable in the same project.
 * Audio has no implicit looping: each 40-second placement restarts the actual retained WAV.
 */
export function createMotionMaximumIndexFixture() {
	const durationFrames = 32769, wav = motionWavFixture(2, 1_920_000);
	const sha256 = createHash('sha256').update(wav).digest('hex');
	const sound = normalizeMotionAsset({ kind: 'audio', id: 'sound', name: 'Repeated retained 40 second stereo source',
		sampleRate: 48000, channels: 2, duration: { num: 40, den: 1 }, byteLength: wav.length, sha256,
		storageKey: `motion-sha256:${sha256}`, mimeType: 'audio/wav' });
	const base = createMotionscaperProject({ id: 'native-maximum-index-v1', title: 'Native maximum index', compositionId: 'main', width: 16, height: 16, durationFrames });
	const moving = createMotionLayer({ id: 'animated', name: 'Every picture changes', durationFrames,
		content: { kind: 'solid', color: { ...motionColor([.08, .2, .62, .5]), expression: {
			source: '[.08 + .54 * frame / 32767, .2 + .12 * frame / 32767, .62 - .54 * frame / 32767, .5 + .25 * frame / 32767]', enabled: true, references: [],
		} }, size: motionVector([8, 16]) } });
	const opaque = createMotionLayer({ id: 'opaque', name: 'Opaque alpha endpoint', durationFrames,
		content: { kind: 'solid', color: motionColor([.25, .5, .125, 1]), size: motionVector([8, 8]) } });
	const project = { ...base, assets: [sound], compositions: [{ ...base.compositions[0]!, layers: [moving,
		{ ...opaque, transform: { ...opaque.transform, position: motionVector([8, 0, 0]) } }],
		audio: Array.from({ length: 28 }, (_, index) => ({ id: `audio-${index}`, assetId: 'sound',
			startFrame: { num: index * 1200, den: 1 }, inFrame: { num: index * 1200, den: 1 },
			outFrame: { num: Math.min((index + 1) * 1200, durationFrames), den: 1 },
			sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, enabled: true, gain: motionScalar(1),
		})),
	}] };
	return { revision: createMotionscaperRevision(project), bodies: new Map<string, Uint8Array>([['sound', wav]]) };
}
