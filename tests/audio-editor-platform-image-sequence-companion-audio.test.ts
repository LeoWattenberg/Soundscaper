/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MEDIA_EXPORT_FORMATS } from '../src/common/editor/media-export.js';
import {
	DEFAULT_PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_V1,
	PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1,
	snapshotPlatformImageSequenceCompanionAudioChoiceV1,
} from '../src/common/editor/platform-image-sequence-companion-audio.ts';

const CATALOG = MEDIA_EXPORT_FORMATS as unknown as Readonly<Record<string, {
	readonly sampleFormats: readonly string[];
	readonly defaults: Readonly<{ readonly sampleFormat?: string }>;
}>>;

/**
 * The companion module restates the export catalog's per-format sample-format
 * table by hand — the recorded "pinned in more places than the planner" trap.
 * Deriving these expectations from the catalog itself is what makes the next
 * catalog edit fail here instead of desynchronizing choice validation from
 * what the encoder actually accepts.
 */
test('companion sample-format admission mirrors the export catalog exactly', () => {
	const sampleFormats = ['int16', 'int20', 'int24', 'int32', 'float32'] as const;
	for (const formatId of PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_FORMATS_V1) {
		const catalog = CATALOG[formatId]!;
		for (const sampleFormat of sampleFormats) {
			const admitted = (() => {
				try {
					snapshotPlatformImageSequenceCompanionAudioChoiceV1({ formatId, sampleFormat });
					return true;
				} catch { return false; }
			})();
			assert.equal(
				admitted,
				catalog.sampleFormats.includes(sampleFormat),
				`${formatId}/${sampleFormat}`,
			);
		}
		// A compressed format's fixed encoder input policy stays null; a PCM
		// format's omitted choice resolves to the catalog default.
		const defaulted = snapshotPlatformImageSequenceCompanionAudioChoiceV1({ formatId });
		assert.equal(
			defaulted.sampleFormat,
			catalog.sampleFormats.length === 0 ? null : catalog.defaults.sampleFormat,
			formatId,
		);
	}
});

test('the deterministic default stays broadcast WAV at 24-bit', () => {
	assert.deepEqual(
		snapshotPlatformImageSequenceCompanionAudioChoiceV1(),
		DEFAULT_PLATFORM_IMAGE_SEQUENCE_COMPANION_AUDIO_V1,
	);
});
