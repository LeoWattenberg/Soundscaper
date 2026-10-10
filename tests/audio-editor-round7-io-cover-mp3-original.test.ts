/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { ordinaryCoverMp3Fixture } from './helpers/ordinary-cover-mp3-fixture.ts';
import { nativeOriginalImportFixture } from './helpers/native-original-import-fixture.ts';

for (const illustrated of [false, true]) test(`ordinary MP3 original overwrite retains its supported frame profile with album artwork=${String(illustrated)}`, async () => {
	const file = await ordinaryCoverMp3Fixture(illustrated);
	const native = await nativeOriginalImportFixture(file);
	try {
		const selections = await native.bridge.chooseFiles({ purpose: 'audio' });
		assert.ok(Array.isArray(selections));
		assert.equal(selections.length, 1);
		const selected = selections[0] as Readonly<{ name: string; originalFile: Readonly<{ id: string; name: string }> }>;
		assert.equal(selected.name, file.name);
		assert.equal(selected.originalFile.name, file.name);
		assert.ok(await native.bridge.prepareOriginalOverwrite(selected.originalFile.id));
	} finally { await native.close(); }
	const reads: [number, number][] = [];
	const settings = await resolveDesktopOriginalExportSettings({ name: file.name, size: file.size,
		slice(start: number, end: number) { reads.push([start, end]); return file.slice(start, end); },
	}, [{ id: 'audio', kind: 'audio', sampleRate: 48_000, originalSampleRate: 48_000, channelCount: 1, frameCount: 48_000 }]);
	assert.ok(settings, 'Ordinary embedded album covers must not hide the supported original overwrite action.');
	assert.equal(settings.format, 'mp3');
	assert.equal(settings.sampleRate, 48_000);
	assert.equal(settings.channelMapping, 'mono');
	assert.equal(settings.bitRateMode, 'constant');
	assert.equal(settings.bitRate, 128);
	const plan = createExportPlan(createCurrentAudioEditorProject({ title: 'Space programme', sampleRate: 48_000 }), {
		...settings, range: { startFrame: 0, endFrame: 48_000 },
	});
	assert.equal(plan.format, 'mp3');
	assert.equal(plan.encoding.bitRate, 128);
	assert.ok(reads.every(([start, end]) => end - start <= 1024 ** 2));
	if (illustrated) assert.ok(reads.some(([start]) => start > 1024 ** 2));
});
