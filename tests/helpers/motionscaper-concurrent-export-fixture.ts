/* SPDX-License-Identifier: AGPL-3.0-only */
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionscaperProject, createMotionLayer } from '../../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../../src/common/editor/motion-project-revision.ts';
import { motionScalar, motionVector } from '../../src/common/editor/motion-property.ts';
import { digestScapeBytes } from '../../src/common/editor/scape-archive-media.ts';
import { exportMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import { motionWavFixture } from '../../scripts/lib/motionscaper-qualification-media.ts';

/** Compatible A/B revisions deliberately change both image and native stereo originals. */
export async function motionscaperConcurrentExportFixtures() {
	const kit = await CanvasKitInit();
	return Promise.all([0, 1].map(async revision => {
		const surface = kit.MakeSurface(2, 2); if (!surface) throw new Error('Fixture image surface is absent.');
		surface.getCanvas().clear(kit.Color(revision === 0 ? 255 : 0, 0, revision === 1 ? 255 : 0, 1)); surface.flush();
		const image = surface.makeImageSnapshot(), encoded = image.encodeToBytes(); if (!encoded) throw new Error('Fixture PNG encoding failed.');
		const picture = new Uint8Array(encoded); image.delete(); surface.delete();
		const pcm = motionWavFixture(2); const view = new DataView(pcm.buffer);
		const samples = revision === 0 ? [0.25, -0.125] : [-0.5, 0.375];
		for (let index = 0; index < 4800; index++) for (let channel = 0; channel < 2; channel++) view.setInt16(44 + (index * 2 + channel) * 2, samples[channel]! * 32768, true);
		const retained = (bytes: Uint8Array) => ({ sha256: digestScapeBytes(bytes), byteLength: bytes.length, storageKey: `motion-sha256:${digestScapeBytes(bytes)}` });
		const imageAsset = { ...retained(picture), kind: 'image' as const, id: 'picture', name: 'Saved color.png', mimeType: 'image/png', width: 2, height: 2, hasAlpha: false };
		const audioAsset = { ...retained(pcm), kind: 'audio' as const, id: 'sound', name: 'Saved stereo.wav', mimeType: 'audio/wav', channels: 2, sampleRate: 48000, duration: { num: 1, den: 10 } };
		const base = createMotionscaperProject({ id: 'concurrent-sender', compositionId: 'main', title: `Concurrent revision ${revision}`, width: 8, height: 4, durationFrames: 3 });
		const layer = createMotionLayer({ id: 'picture', name: 'Saved picture', durationFrames: 3, content: { kind: 'image', assetId: 'picture' } });
		const project = { ...base, revision, assets: [imageAsset, audioAsset], compositions: [{ ...base.compositions[0]!, layers: [{ ...layer, transform: { ...layer.transform, scale: motionVector([4, 2, 1]) } }],
			audio: [{ id: 'sound', assetId: 'sound', startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame: { num: 3, den: 1 }, sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, enabled: true, gain: motionScalar(1) }] }] };
		const snapshot = createMotionscaperRevision(project), bodies = new Map([['picture', picture], ['sound', pcm]]);
		const archive = await exportMotionscaperArchive(snapshot.project, asset => new Blob([bodies.get(asset.id)!])); if (!archive) throw new Error('Concurrent archive is absent.');
		return { snapshot, samples, archive: [...new Uint8Array(await archive.arrayBuffer())], originals: [imageAsset, audioAsset] };
	}));
}
