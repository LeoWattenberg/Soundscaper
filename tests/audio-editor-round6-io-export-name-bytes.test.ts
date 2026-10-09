/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createExportFileName, createExportPlan } from '../src/common/editor/export.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

for (const repeat of [4, 15]) test(`ordinary ${repeat === 4 ? 'short' : 'long'} Unicode names yield filesystem-admitted export files`, async () => {
	const title = '東京での録音'.repeat(repeat);
	const project = createCurrentAudioEditorProject({ title });
	const files = [createExportFileName(project, { date: '2026-10-09' }),
		...['stem', 'chapter', 'clip'].map(mode => createExportFileName(project, { mode, trackIndex: 1, trackName: title }))];
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-export-names-'));
	try {
		for (const [index, fileName] of files.entries()) {
			assert.ok(Buffer.byteLength(fileName) <= 255, `the complete export basename requires ${Buffer.byteLength(fileName)} bytes`);
			assert.ok(fileName.includes('東京での録音'));
			assert.ok(fileName.endsWith('.wav'));
			assert.ok(!fileName.includes('\uFFFD'));
			if (repeat === 4) assert.equal(fileName, index === 0 ? `${title}-mix-2026-10-09.wav` : `02-${title}.wav`);
			const content = Buffer.from(`delivered-${index}`);
			await writeFile(join(directory, fileName), content);
			assert.deepEqual(await readFile(join(directory, fileName)), content);
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('an ordinary long project title also admits its complete stem archive filename', () => {
	const title = '東京での録音'.repeat(15);
	const source = createAudioSource({ id: 'source', frameCount: 38_400, channelCount: 2, sampleRate: 48_000 });
	const track = createAudioTrack({ id: 'track', name: 'Ordinary recording', clipIds: ['clip'] });
	const clip = createAudioClip({ id: 'clip', trackId: 'track', sourceId: 'source', durationFrames: 38_400 });
	const authored = createCurrentAudioEditorProject({ title, sources: [source], tracks: [track], clips: [clip] });
	const plan = createExportPlan(authored, { mode: 'stems', date: '2026-10-09' });
	assert.ok(plan.archive);
	assert.ok(Buffer.byteLength(plan.archive.fileName) <= 255);
	assert.match(plan.archive.fileName, /-stems-2026-10-09\.zip$/u);
	assert.equal(authored.title, title);
});
