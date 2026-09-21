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

function soundFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 123456,
		name: 'Rain, close.ogg',
		tags: ['rain', 'field-recording'],
		description: 'A close recording of steady rain.',
		category: 'Sound effects',
		subcategory: 'Weather',
		created: '2026-04-16T20:07:11.145',
		license: 'Attribution',
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
		license: normalizeFreesoundLicense('Attribution'),
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
	});
	assert.equal(normalized.previewUrl.href, previewUrl);
	assert.doesNotMatch(JSON.stringify(normalized.sound), /cdn\.freesound/u);
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
