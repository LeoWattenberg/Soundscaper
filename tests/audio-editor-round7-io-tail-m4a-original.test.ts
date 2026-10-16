/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobSource, Input, MP4 } from 'mediabunny';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
import { ordinaryTailM4aFixture } from './helpers/ordinary-tail-m4a-fixture.ts';

for (const fastStart of [false, 'in-memory'] as const) test(`ordinary AAC M4A overwrite reads movie metadata with fastStart=${String(fastStart)}`, async () => {
	const file = await ordinaryTailM4aFixture(fastStart);
	const input = new Input({ source: new BlobSource(file), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack();
		assert.ok(track);
		assert.equal(track.codec, 'aac');
		assert.equal(await track.computeDuration(), 4_000 * 1024 / 44_100);
		const reads: [number, number][] = [];
		const settings = await resolveDesktopOriginalExportSettings({ name: file.name, size: file.size,
			slice(start: number, end: number) { reads.push([start, end]); return file.slice(start, end); },
		}, [{ id: 'audio', kind: 'audio', sampleRate: 44_100,
			originalSampleRate: 44_100, channelCount: 2, frameCount: 4_000 * 1024 }]);
		assert.ok(settings, 'Ordinary tail metadata must not disable the supported original overwrite action.');
		assert.equal(settings.format, 'aac-m4a');
		assert.equal(settings.sampleRate, 44_100);
		assert.ok(reads.every(([start, end]) => end - start <= 1024 ** 2));
		if (fastStart === false) assert.ok(reads.some(([start, end]) => start > 1024 ** 2 && end - start > 16));
	} finally { input.dispose(); }
});
