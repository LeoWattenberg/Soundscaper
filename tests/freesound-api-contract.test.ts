/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	normalizeFreesoundLicense,
	normalizeFreesoundSearch,
	normalizeFreesoundSound,
} from '../functions/api/freesound/_shared/contracts.ts';

const previewUrl = 'https://cdn.freesound.org/previews/123/123456_789-hq.ogg';
const waveformUrl = 'https://cdn.freesound.org/displays/123/123456_789_wave_bw_M.png';

function soundFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 123456,
		name: 'Rain, close.ogg',
		tags: ['rain', 'field-recording'],
		description: 'A close recording of steady rain.',
		category: 'Sound effects',
		subcategory: 'Weather',
		created: '2026-04-16T20:07:11.145',
		license: 'http://creativecommons.org/licenses/by/4.0/',
		gen_ai_preference: 'no-additional-preferences',
		type: 'ogg',
		channels: 2,
		filesize: 4_096,
		duration: 12.25,
		samplerate: 48_000,
		username: 'field-recorder',
		md5: '0123456789abcdef0123456789abcdef',
		is_explicit: false,
		previews: { 'preview-hq-ogg': previewUrl },
		images: { waveform_m: waveformUrl },
		num_downloads: 42,
		avg_rating: 4.75,
		num_ratings: 8,
		...overrides,
	};
}

test('normalizes each supported Freesound license to a stable owned contract', () => {
	assert.deepEqual(normalizeFreesoundLicense('Creative Commons 0'), {
		code: 'cc0',
		name: 'Creative Commons 0',
		url: 'https://creativecommons.org/publicdomain/zero/1.0/',
		requiresAttribution: false,
		commercialUseAllowed: true,
	});
	assert.equal(normalizeFreesoundLicense('Attribution').code, 'cc-by');
	assert.equal(normalizeFreesoundLicense('Attribution NonCommercial').code, 'cc-by-nc');
	assert.deepEqual(normalizeFreesoundLicense('Sampling+'), {
		code: 'sampling-plus',
		name: 'Sampling+ 1.0',
		url: 'https://creativecommons.org/licenses/sampling+/1.0/',
		requiresAttribution: true,
		commercialUseAllowed: false,
	});
});

test('normalizes Freesound deed URLs while preserving the attribution license version', () => {
	for (const [deed, code, name, canonical] of [
		['http://creativecommons.org/publicdomain/zero/1.0/', 'cc0', 'Creative Commons 0', 'https://creativecommons.org/publicdomain/zero/1.0/'],
		['http://creativecommons.org/licenses/by/3.0/', 'cc-by', 'Attribution 3.0', 'https://creativecommons.org/licenses/by/3.0/'],
		['https://creativecommons.org/licenses/by/4.0/', 'cc-by', 'Attribution 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
		['http://creativecommons.org/licenses/by-nc/3.0/', 'cc-by-nc', 'Attribution NonCommercial 3.0', 'https://creativecommons.org/licenses/by-nc/3.0/'],
		['https://creativecommons.org/licenses/by-nc/4.0/', 'cc-by-nc', 'Attribution NonCommercial 4.0', 'https://creativecommons.org/licenses/by-nc/4.0/'],
		['http://creativecommons.org/licenses/sampling+/1.0/', 'sampling-plus', 'Sampling+ 1.0', 'https://creativecommons.org/licenses/sampling+/1.0/'],
	] as const) {
		const license = normalizeFreesoundLicense(deed);
		assert.equal(license.code, code);
		assert.equal(license.name, name);
		assert.equal(license.url, canonical);
	}
	assert.throws(
		() => normalizeFreesoundLicense('https://creativecommons.org/licenses/by/4.0/?redirect=evil'),
		/unsupported license/u,
	);
	assert.throws(
		() => normalizeFreesoundLicense('https://attacker.example/licenses/by/4.0/'),
		/unsupported license/u,
	);
});

test('normalizes a sound without exposing the upstream preview URL', () => {
	const normalized = normalizeFreesoundSound(soundFixture());

	assert.deepEqual(normalized.sound, {
		id: 123456,
		name: 'Rain, close.ogg',
		pageUrl: 'https://freesound.org/s/123456/',
		creator: {
			username: 'field-recorder',
			pageUrl: 'https://freesound.org/people/field-recorder/',
		},
		description: 'A close recording of steady rain.',
		tags: ['rain', 'field-recording'],
		category: 'Sound effects',
		subcategory: 'Weather',
		createdAt: '2026-04-16T20:07:11.145',
		license: normalizeFreesoundLicense('http://creativecommons.org/licenses/by/4.0/'),
		generativeAiPreference: 'no-additional-preferences',
		explicit: false,
		durationSeconds: 12.25,
		originalFile: {
			format: 'ogg',
			channels: 2,
			byteLength: 4_096,
			sampleRate: 48_000,
			md5: '0123456789abcdef0123456789abcdef',
		},
		statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
		preview: { available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
		waveform: {
			available: true,
			url: '/api/freesound/sounds/123456/waveform?asset=789&source=cdn',
		},
	});
	assert.equal(normalized.previewUrl.href, previewUrl);
	assert.equal(normalized.waveformUrl?.href, waveformUrl);
	assert.doesNotMatch(JSON.stringify(normalized.sound), /cdn\.freesound/u);
});

test('normalizes an unavailable waveform and rejects untrusted image URLs', () => {
	const unavailable = normalizeFreesoundSound(soundFixture({ images: {} }));
	assert.deepEqual(unavailable.sound.waveform, { available: false, url: null });
	assert.equal(unavailable.waveformUrl, null);
	const legacy = normalizeFreesoundSound(soundFixture({
		images: { waveform_m: 'https://freesound.org/data/displays/123/123456_789_wave_bw_M.png' },
	}));
	assert.equal(legacy.sound.waveform.url, '/api/freesound/sounds/123456/waveform?asset=789&source=site');
	for (const url of [
		'https://attacker.example/displays/123/123456_789_wave_bw_M.png',
		'https://cdn.freesound.org.evil.example/displays/123/123456_789_wave_bw_M.png',
		'https://cdn.freesound.org/displays/999/123456_789_wave_bw_M.png',
		'https://cdn.freesound.org/displays/123/999999_789_wave_bw_M.png',
		'https://cdn.freesound.org/displays/123/123456_789_wave_M.png',
		'https://cdn.freesound.org/displays/123/123456_789_spec_M.jpg',
		'https://cdn.freesound.org/displays/123/123456_789_wave_bw_M.png?redirect=evil',
	]) {
		assert.throws(() => normalizeFreesoundSound(soundFixture({ images: { waveform_m: url } })), /waveform URL/u);
	}
});

test('rejects malformed sound fields and preview URLs outside the Freesound CDN', () => {
	assert.throws(
		() => normalizeFreesoundSound(soundFixture({ duration: Number.NaN })),
		/duration/u,
	);
	assert.throws(
		() => normalizeFreesoundSound(soundFixture({ previews: {
			'preview-hq-ogg': 'https://attacker.example/audio.ogg',
		} })),
		/preview URL/u,
	);
	assert.throws(
		() => normalizeFreesoundSound(soundFixture({ tags: new Array(201).fill('tag') })),
		/tags/u,
	);
});

test('normalizes a bounded search page and derives pagination locally', () => {
	const normalized = normalizeFreesoundSearch({
		count: 21,
		next: 'https://freesound.org/apiv2/search/?page=2&token=must-not-leak',
		previous: null,
		results: [soundFixture()],
	}, { query: 'rain', page: 1, pageSize: 20 });

	assert.equal(normalized.query, 'rain');
	assert.equal(normalized.totalCount, 21);
	assert.equal(normalized.totalPages, 2);
	assert.equal(normalized.hasNextPage, true);
	assert.equal(normalized.hasPreviousPage, false);
	assert.equal(normalized.results.length, 1);
	assert.doesNotMatch(JSON.stringify(normalized), /token=must-not-leak/u);
});

test('rejects oversized or structurally invalid search responses', () => {
	assert.throws(
		() => normalizeFreesoundSearch({ count: 1, results: 'not-an-array' }, {
			query: '', page: 1, pageSize: 20,
		}),
		/results/u,
	);
	assert.throws(
		() => normalizeFreesoundSearch({ count: 21, results: new Array(21).fill(soundFixture()) }, {
			query: '', page: 1, pageSize: 20,
		}),
		/page size/u,
	);
});

test('Cloudflare invokes Functions only for the Freesound API namespace', () => {
	const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8')) as unknown;
	assert.deepEqual(routes, {
		version: 1,
		include: ['/api/freesound/*'],
		exclude: [],
	});
});

test('Pages Wrangler configuration omits the Worker-only secrets declaration', () => {
	const configuration = JSON.parse(
		readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
	) as Readonly<Record<string, unknown>>;

	assert.equal(Object.hasOwn(configuration, 'secrets'), false);
});
