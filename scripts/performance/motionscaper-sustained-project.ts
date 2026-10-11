/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { createMotionLayer, createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../../src/motionscaper/editor-project-revision.ts';
import { motionColor, motionScalar, motionVector } from '../../src/common/editor/motion-property.ts';
import { normalizeMotionAsset } from '../../src/common/editor/motion-asset.ts';
import { motionWavFixture } from '../lib/motionscaper-qualification-media.ts';
import { MOTION_SUSTAINED_PLAN as plan } from './motionscaper-sustained-plan.ts';

/** One fixed input closure is reused for both output ranges and both platforms. */
export function createMotionSustainedFixture(fontBytes: Uint8Array) {
	if (!fontBytes.byteLength || fontBytes.byteLength > 1024 * 1024) throw new Error('The sustained imported font must be between one byte and one MiB.');
	const wav = motionWavFixture(2, plan.projectFrames * 1600);
	const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
	const fontHash = digest(fontBytes), audioHash = digest(wav);
	const font = normalizeMotionAsset({ kind: 'font', id: 'font', name: 'Inter', family: 'Inter', style: 'Regular',
		byteLength: fontBytes.length, sha256: fontHash, storageKey: `motion-sha256:${fontHash}`, mimeType: 'font/woff2' });
	const sound = normalizeMotionAsset({ kind: 'audio', id: 'sound', name: 'Fixed 40 second stereo PCM', sampleRate: 48000, channels: 2,
		duration: { num: 40, den: 1 }, byteLength: wav.length, sha256: audioHash, storageKey: `motion-sha256:${audioHash}`, mimeType: 'audio/wav' });
	const base = createMotionscaperProject({ id: 'sustained-duration-v1', title: 'Sustained duration', compositionId: 'main',
		width: plan.width, height: plan.height, durationFrames: plan.projectFrames });
	const text = createMotionLayer({ id: 'text', name: 'Retained font', durationFrames: plan.projectFrames, content: { kind: 'text', document: {
		runs: [{ text: 'Motion', fontAssetId: 'font', fontSize: motionScalar(20), color: motionColor([1, 1, 1, 1]), tracking: motionScalar(0) }],
		align: 'left', lineHeight: motionScalar(1), boxSize: motionVector([160, 40]),
	} } });
	const solid = createMotionLayer({ id: 'solid', name: 'Animated translucent solid', durationFrames: plan.projectFrames,
		content: { kind: 'solid', color: motionColor([0.25, 0.125, 0.5, 0.5]), size: motionVector([32, 24]) } });
	const position = motionVector([0, 50, 0]);
	const animated = { ...solid, transform: { ...solid.transform, position: { ...position, curves: [{
		anchors: [{ position: { num: 0, den: 1 }, value: 0 }, { position: { num: 1199, den: 1 }, value: 96 }],
		segments: [{ kind: 'linear' as const }],
	}, null, null] as const } } };
	const project = { ...base, assets: [font, sound], compositions: [{ ...base.compositions[0]!, layers: [text, animated], audio: [{
		id: 'audio', assetId: 'sound', startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame: { num: 1200, den: 1 },
		sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, enabled: true, gain: motionScalar(1),
	}] }] };
	return { revision: createMotionscaperRevision(project), bodies: new Map<string, Uint8Array>([['font', fontBytes], ['sound', wav]]) };
}
