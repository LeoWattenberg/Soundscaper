/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import { expect } from '@playwright/test';
import { SOUNDSCAPER_DATABASE_NAME } from './editor-databases.js';
import { exportSamples } from './round2-audio-export.js';

export async function primaryReleaseDryPeak(page, editor, recording, qualifyWithExport = false) {
	const frames = (recording.buffer.length - 44) / 2;
	const pcm = Buffer.alloc(frames * 4), header = Buffer.alloc(4);
	header.writeUInt32LE(frames);
	let sourcePeak = 0;
	for (let frame = 0; frame < frames; frame++) {
		const sample = recording.buffer.readInt16LE(44 + frame * 2) / 32768;
		pcm.writeFloatLE(sample, frame * 4);
		if (frame >= 96 && frame < frames - 96) sourcePeak = Math.max(sourcePeak, Math.abs(sample));
	}
	const sourceHash = createHash('sha256').update(header).update(pcm).digest('hex');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const projectId = await editor.getAttribute('data-project-id');
	const project = await page.evaluate(async ({ databaseName, id }) => {
		const request = input => new Promise((resolve, reject) => {
			input.onsuccess = () => resolve(input.result);
			input.onerror = () => reject(input.error);
		});
		const database = await request(indexedDB.open(databaseName));
		try { return await request(database.transaction('projects', 'readonly').objectStore('projects').get(id)); }
		finally { database.close(); }
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, id: projectId });
	expect(project).toMatchObject({ sampleRate: 48_000, masterChannels: 2, automationLanes: [] });
	expect(project.sources).toHaveLength(1);
	expect(project.sources[0]).toMatchObject({ name: recording.name, channelCount: 1,
		frameCount: frames, sampleRate: 48_000, contentSha256: sourceHash, byteLength: pcm.length + 4 });
	expect(project.clips).toHaveLength(1);
	const clip = project.clips[0];
	expect(clip).toMatchObject({ sourceId: project.sources[0].id, timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: frames, durationFrames: frames, gain: 1,
		fadeInFrames: 96, fadeOutFrames: 96, reversed: false, inverted: false, envelope: [],
		pitchCents: 0, speedRatio: 1, warpMap: null });
	const neutralStrip = { gain: 1, pan: 0, mute: false, solo: false, effects: [], effectsActive: true };
	expect(project.master).toMatchObject(neutralStrip);
	expect(project.tracks).toHaveLength(2);
	const populatedTrack = project.tracks.find(track => track.clipIds.includes(clip.id));
	expect(populatedTrack.clipIds).toEqual([clip.id]);
	expect(project.mixer).toMatchObject({ groups: [], sends: [], cues: [], vcas: [],
		outputs: [{ id: 'main', role: 'main', channelCount: 2 }] });
	expect(project.mixer.edges).toHaveLength(3);
	for (const track of project.tracks) {
		expect(track).toMatchObject(neutralStrip);
		expect(track.clipIds).toEqual(track === populatedTrack ? [clip.id] : []);
		expect(project.mixer.edges.find(edge => edge.source.kind === 'track' && edge.source.id === track.id))
			.toMatchObject({ kind: 'assignment', destination: { kind: 'master' }, position: 'post-fader',
				level: 1, enabled: true, channelMap: track === populatedTrack ? [0, 0] : [0, 1] });
	}
	expect(project.mixer.edges.find(edge => edge.source.kind === 'master')).toMatchObject({
		kind: 'assignment', destination: { kind: 'output', id: 'main' }, position: 'post-fader',
		level: 1, enabled: true, channelMap: [0, 1],
	});
	// One real render qualifies the authenticated mono PCM and centered stereo route.
	// The other two cases share that dry peak; every effect and history render remains.
	const expected = sourcePeak * Math.SQRT1_2;
	if (!qualifyWithExport) return expected;
	const actual = (await exportSamples(page, editor)).reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
	expect(actual).toBeCloseTo(expected, 6);
	return actual;
}
