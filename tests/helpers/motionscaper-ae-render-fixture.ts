/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMotionLayer, createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { motionColor, motionScalar, motionVector } from '../../src/common/editor/motion-property.ts';
import { normalizeMotionscaperProject } from '../../src/motionscaper/editor-project-validation.ts';
import { digestScapeBytes } from '../../src/common/editor/scape-archive-media.ts';
export function motionAeRenderFixture(durationFrames = 3) {
	const base = createMotionscaperProject({ id: `render-source-${durationFrames}`, title: 'Full rendered source', compositionId: 'main', width: 64, height: 32, frameRate: { num: 30000, den: 1001 }, durationFrames });
	const card = createMotionLayer({ id: 'card', name: 'Animated depth card', durationFrames, content: { kind: 'solid', color: motionColor([1, 0.1, 0, 0.5]), size: motionVector([8, 8]) } });
	const camera = createMotionLayer({ id: 'camera', name: 'Defocused perspective', durationFrames, content: { kind: 'camera', projection: 'perspective', zoom: motionScalar(64), near: 1, far: 1000, focusDistance: motionScalar(64), aperture: motionScalar(32) } });
	const bytes = new Uint8Array(44 + 160 * 4), view = new DataView(bytes.buffer); const ascii = (at: number, text: string) => bytes.set(new TextEncoder().encode(text), at);
	ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 48000, true); view.setUint32(28, 192000, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, 640, true); for (let at = 44; at < bytes.length; at += 2) view.setInt16(at, 4096, true);
	const sha256 = digestScapeBytes(bytes);
	const project = normalizeMotionscaperProject({ ...base, assets: [{ id: 'original-audio', kind: 'audio', name: 'Retained original stereo.wav', byteLength: bytes.length, sha256, storageKey: `motion-sha256:${sha256}`, mimeType: 'audio/wav', channels: 2, sampleRate: 48000, duration: { num: 1, den: 300 } }],
		compositions: [{ ...base.compositions[0]!, workArea: { startFrame: { num: 1, den: 1 }, endFrame: { num: 2, den: 1 } }, depthOfFieldSamples: 4,
			temporal: { shutterOpenFrames: { num: -1, den: 2 }, shutterCloseFrames: { num: 1, den: 2 }, samples: 4 },
			audio: [{ id: 'audio', assetId: 'original-audio', enabled: true, startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame: { num: durationFrames, den: 1 }, sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, gain: motionScalar(1) }],
			layers: [{ ...card, is3D: true, transform: { ...card.transform, position: { ...motionVector([28, 12, 64]), expression: { source: '[28 + frame * 8, 12, 64]', enabled: true, references: [] } } } }, { ...camera, transform: { ...camera.transform, position: motionVector([32, 16, -64]) } }] }] });
	return { project, bytes };
}
