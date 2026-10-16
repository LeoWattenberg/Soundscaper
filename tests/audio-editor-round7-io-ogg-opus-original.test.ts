/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ordinaryOggOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

test('the ordinary .ogg and .opus controls contain exactly the same encoded recording', async () => {
	const ogg = await ordinaryOggOpusFixture('ogg');
	const opus = await ordinaryOggOpusFixture('opus');
	assert.deepEqual(await ogg.arrayBuffer(), await opus.arrayBuffer());
});

for (const extension of ['ogg', 'opus'] as const) test(`the same ordinary Ogg Opus recording retains supported overwrite settings as .${extension}`, async () => {
	const file = await ordinaryOggOpusFixture(extension);
	const source = { id: 'voice', name: file.name, kind: 'audio', sampleRate: 48_000, originalSampleRate: 48_000,
		channelCount: 1, frameCount: 48_000 };
	const settings = await resolveDesktopOriginalExportSettings(file, [source]);
	assert.equal(settings?.format, 'opus');
	assert.equal(settings?.sampleRate, 48_000);
	assert.ok(settings);
	const project = createSoundscaperProject({ id: 'voice', sampleRate: 48_000, sources: [source],
		tracks: [{ id: 'track', name: 'Programme', clipIds: ['voice-clip'] }],
		clips: [{ id: 'voice-clip', sourceId: source.id, title: 'Voice', timelineStartFrame: 0,
			sourceStartFrame: 0, sourceDurationFrames: source.frameCount, durationFrames: source.frameCount }],
	});
	const plan = createExportPlan(project, settings);
	assert.equal(plan.format, 'opus');
});
