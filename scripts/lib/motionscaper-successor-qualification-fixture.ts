/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionscaperProject, createMotionLayer } from '../../src/motionscaper/editor-project.ts';
import { motionColor, motionScalar, motionVector } from '../../src/common/editor/motion-property.ts';
import { createMotionscaperRevision } from '../../src/common/editor/motion-project-revision.ts';
import { digestScapeBytes } from '../../src/common/editor/scape-archive-media.ts';
import { motionWavFixture } from './motionscaper-qualification-media.ts';
export function motionscaperSuccessorNativeFixture(revision = 0) {
	const bytes = motionWavFixture(2), sha256 = digestScapeBytes(bytes);
	const asset = { kind: 'audio' as const, id: 'sound', name: 'Retained stereo ramp', mimeType: 'audio/wav', channels: 2, sampleRate: 48000,
		duration: { num: 1, den: 10 }, sha256, byteLength: bytes.length, storageKey: `motion-sha256:${sha256}` };
	const base = createMotionscaperProject({ id: 'native-scene', compositionId: 'main', title: `Native revision ${String(revision)}`, width: 64, height: 32, durationFrames: 3 });
	const card = createMotionLayer({ id: 'card', name: 'Moving translucent card', durationFrames: 3, content: { kind: 'solid', color: motionColor([0.2, 0.05, 0.6, 0.5]), size: motionVector([32, 24]) } });
	const layer = { ...card, transform: { ...card.transform, position: { ...motionVector([4, 4, 0]), expression: { enabled: true, source: '[4 + time * 30, 4, 0]', references: [] } } } };
	const audio = [0, 1].map(offset => ({ id: `sound-${String(offset)}`, assetId: asset.id, startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame: { num: 3, den: 1 },
		sourceStart: { num: offset, den: 48000 }, timeScale: { num: 1, den: 1 }, enabled: true, gain: motionScalar(0.25) }));
	return { revision: createMotionscaperRevision({ ...base, revision, assets: [asset], compositions: [{ ...base.compositions[0]!, layers: [layer], audio }] }), bytes, asset };
}
export function motionscaperSuccessorNativeExpectedSample(frame: number, channel: number): number {
	const value = (index: number) => index >= 4800 ? 0 : (index % 127 - 63) / 128 * (channel === 0 ? 1 : -1);
	return (value(frame) + value(frame + 1)) * 0.25;
}
