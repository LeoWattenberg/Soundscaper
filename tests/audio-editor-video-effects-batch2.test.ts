import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VIDEO_EFFECT_DEFINITIONS,
	VIDEO_EFFECT_TYPES,
	VIDEO_EFFECT_V5_TYPES,
	createVideoEffect,
	normalizeVideoEffects,
	serializeVideoEffectsToFfmpegOperations,
	videoEffectDefaults,
} from '../src/common/editor/video-effects.js';
import { COPY_BY_LOCALE } from '../src/common/i18n/catalogs.js';

const SECOND_BATCH = [
	'chroma-key',
	'luma-key',
	'spill-suppression',
	'glow',
	'outline',
	'drop-shadow',
] as const;

test('second video effect batch is appended without widening the V5 vocabulary', () => {
	assert.deepEqual(VIDEO_EFFECT_V5_TYPES, VIDEO_EFFECT_TYPES.slice(0, 6));
	assert.deepEqual(VIDEO_EFFECT_TYPES.slice(6), SECOND_BATCH);
	assert.deepEqual(videoEffectDefaults('chroma-key'), {
		keyColor: 0x00ff00,
		similarity: 0.1,
		softness: 0.1,
	});
	assert.deepEqual(videoEffectDefaults('luma-key'), { mode: 0, cutoff: 0.2, softness: 0.1 });
	assert.deepEqual(videoEffectDefaults('spill-suppression'), { screen: 0, strength: 0.5 });
	assert.deepEqual(videoEffectDefaults('glow'), { threshold: 0.7, sigma: 8, intensity: 0.5 });
	assert.deepEqual(videoEffectDefaults('outline'), { width: 4, color: 0xffffff, opacity: 1 });
	assert.deepEqual(videoEffectDefaults('drop-shadow'), {
		offsetX: 8,
		offsetY: 8,
		sigma: 6,
		opacity: 0.6,
		color: 0,
	});
});

test('every registry label and select option is localized in English and German', () => {
	for (const definition of Object.values(VIDEO_EFFECT_DEFINITIONS)) {
		for (const locale of ['en', 'de'] as const) {
			assert.equal(typeof COPY_BY_LOCALE[locale][definition.labelKey], 'string');
		}
		for (const parameter of Object.values(definition.params) as Array<{
			labelKey: string;
			options?: Array<{ labelKey: string }>;
		}>) {
			for (const locale of ['en', 'de'] as const) {
				assert.equal(typeof COPY_BY_LOCALE[locale][parameter.labelKey], 'string');
				for (const option of parameter.options || []) {
					assert.equal(typeof COPY_BY_LOCALE[locale][option.labelKey], 'string');
				}
			}
		}
	}
});

test('color and enum parameters reject malformed and out-of-domain values', () => {
	assert.throws(() => createVideoEffect('chroma-key', { params: { keyColor: 0x1000000 } }), /between 0 and 16777215/u);
	assert.throws(() => createVideoEffect('outline', { params: { color: 1.5 } }), /integer/u);
	assert.throws(() => createVideoEffect('luma-key', { params: { mode: 2 } }), /between 0 and 1/u);
	assert.throws(() => createVideoEffect('spill-suppression', { params: { screen: 0.5 } }), /integer/u);
	assert.throws(() => normalizeVideoEffects([
		createVideoEffect('glow', { id: 'glow' }),
	], 'effects', { allowedTypes: VIDEO_EFFECT_V5_TYPES }), /not supported by this schema/u);
});

test('second-batch serialization returns only closed, typed operations and omits no-ops', () => {
	const effects = SECOND_BATCH.map((type) => createVideoEffect(type, { id: type }));
	assert.deepEqual(serializeVideoEffectsToFfmpegOperations(effects), [
		{ kind: 'multiply-alpha-matte', matte: 'chroma-key', color: 0x00ff00, similarity: 0.1, softness: 0.1 },
		{ kind: 'multiply-alpha-matte', matte: 'luma-key', mode: 0, cutoff: 0.2, softness: 0.1 },
		{ kind: 'preserve-alpha', filter: 'spill-suppression', screen: 0, strength: 0.5 },
		{ kind: 'luminance-bloom', threshold: 0.7, sigma: 8, intensity: 0.5 },
		{ kind: 'alpha-underlay', shape: 'outline', width: 4, color: 0xffffff, opacity: 1 },
		{
			kind: 'alpha-underlay',
			shape: 'drop-shadow',
			offsetX: 8,
			offsetY: 8,
			sigma: 6,
			color: 0,
			opacity: 0.6,
		},
	]);
	assert.deepEqual(serializeVideoEffectsToFfmpegOperations([
		createVideoEffect('spill-suppression', { params: { strength: 0 } }),
		createVideoEffect('glow', { params: { intensity: 0 } }),
		createVideoEffect('outline', { params: { width: 0 } }),
		createVideoEffect('drop-shadow', { params: { opacity: 0 } }),
	]), []);
});
