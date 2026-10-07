/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';
import { parseXmlDocument, type XmlElement } from '../src/common/editor/dawproject-xml.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

function elements(element: XmlElement, name: string): readonly XmlElement[] {
	return [...(element.name === name ? [element] : []), ...element.children.flatMap(child => elements(child, name))];
}

function cameraProject(keepAudio: boolean) {
	const camera = createVideoSource({ id: 'camera', name: 'camera.webm', hasAudio: true, sampleRate: 48_000,
		sampleFrameCount: 48_000, sourceFrameCount: 25, frameRate: { num: 25, den: 1 }, width: 96, height: 54 });
	const recording = createAudioSource({ id: 'recording', name: 'camera audio', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const picture = { id: 'picture', kind: 'video', sourceId: camera.id, sequenceId: 'main',
		sequenceStartFrame: 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25 };
	const audio = createAudioClip({ id: 'audio', sourceId: recording.id, durationFrames: 48_000 });
	return projectForRuntimeConsumers(createSoundscaperProject({
		id: 'camera-project', sampleRate: 48_000, sources: [camera, recording], clips: [picture, ...(keepAudio ? [audio] : [])],
		tracks: [createVideoTrack({ id: 'picture-track', clipIds: [picture.id] }),
			...(keepAudio ? [createAudioTrack({ id: 'audio-track', clipIds: [audio.id] })] : [])],
		sequences: [{ id: 'main', name: 'Main', rate: { num: 25, den: 1 },
			trackNodes: [{ kind: 'track', id: 'picture-track', parentFolderId: null },
				...(keepAudio ? [{ kind: 'track', id: 'audio-track', parentFolderId: null }] : [])] }], primarySequenceId: 'main',
	}) as never) as unknown as Readonly<Record<string, unknown>>;
}

for (const keepAudio of [true, false]) {
	test(`FCPXML camera components retain ${keepAudio ? 'one authored audio leaf' : 'the authored absence of audio'}`, () => {
		const project = cameraProject(keepAudio);
		const before = structuredClone(project);
		const document = parseXmlDocument(createFcpxmlExport({ project, sequenceRate: { num: 25, den: 1 } }).text);
		const assets = new Map(elements(document, 'asset').map(asset => [asset.attributes.id!, asset.attributes]));
		const clips = elements(document, 'asset-clip');
		const enabledAudio = clips.filter(clip => assets.get(clip.attributes.ref!)?.hasAudio === '1'
			&& (clip.attributes.srcEnable || 'all') !== 'video');
		assert.equal(enabledAudio.length, keepAudio ? 1 : 0);
		assert.equal(clips[0]!.attributes.srcEnable, 'video');
		assert.equal(assets.get(clips[0]!.attributes.ref!)!.hasAudio, '1', 'original media metadata stays truthful');
		if (keepAudio) assert.equal(clips[1]!.attributes.srcEnable, 'audio');
		assert.deepEqual(project, before);
	});
}
