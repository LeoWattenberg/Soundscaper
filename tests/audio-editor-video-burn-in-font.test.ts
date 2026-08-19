/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
	loadVideoBurnInFonts,
	VIDEO_BURN_IN_FONT_URLS,
} from '../src/common/editor/video-burn-in-font.ts';
import {
	resolveVideoBurnInFontChoice,
	VIDEO_BURN_IN_FONT_SUBSETS,
	videoBurnInFontSubset,
} from '../src/common/editor/video-burn-in-font-subsets.ts';
import {
	resolveVideoBurnInStage,
	videoBurnInFontSubsetIds,
	videoBurnInUndrawableCharacters,
} from '../src/common/editor/video-caption-burn-in.ts';

const CANVAS = { width: 1_280, height: 720 };
const SR = 1_000;

test('a caption is drawn with a subset that covers the script it is written in', () => {
	// Measured against the pinned core: the Latin subset renders Cyrillic text as
	// blanks (a 1059-byte frame where the Cyrillic subset renders 2425), and this
	// build has no fontconfig — `drawtext=font=Inter` fails to initialize — so
	// there is no fallback to lean on and the subset has to be chosen here.
	assert.equal(resolveVideoBurnInFontChoice('Hello world').subsetId, 'latin');
	assert.equal(resolveVideoBurnInFontChoice('Привет мир').subsetId, 'cyrillic');
	assert.equal(resolveVideoBurnInFontChoice('Γεια σου κόσμε').subsetId, 'greek');
	// Punctuation and spacing are Latin whatever the script, so a mostly-ASCII
	// line stays on the file that draws ASCII.
	assert.equal(resolveVideoBurnInFontChoice('"Yes," she said.').subsetId, 'latin');

	// A script whose letters are ASCII and whose accents are not cannot be drawn
	// whole from any one file. The line still lands on the subset that draws most
	// of it, and the accents it cannot draw are named rather than blanked.
	for (const [line, undrawable] of [
		['Chào thế giới', ['ế', 'ớ']],
		['Cześć świecie', ['ś', 'ć']],
	] as const) {
		const choice = resolveVideoBurnInFontChoice(line);
		assert.equal(choice.subsetId, 'latin', line);
		assert.deepEqual([...choice.undrawable], undrawable, line);
	}
});

test('characters no subset can draw are named rather than silently blanked', () => {
	// Counting what is missing rather than what is covered is what keeps this on
	// the Cyrillic file: Latin covers more characters here and would have blanked
	// every word of it.
	const mixed = resolveVideoBurnInFontChoice('Привет, Ada');
	assert.equal(mixed.subsetId, 'cyrillic');
	assert.deepEqual([...mixed.undrawable], [',', 'A', 'd', 'a']);

	// A script this build ships no subset for is the same case, not a crash.
	const han = resolveVideoBurnInFontChoice('世界');
	assert.ok(videoBurnInFontSubset(han.subsetId), 'a script no subset covers still names a real subset');
	assert.equal(han.subsetId, 'latin');
	assert.deepEqual([...han.undrawable], ['世', '界']);
});

test('a burned stage names the subsets it needs and what it still cannot draw', () => {
	const stage = resolveVideoBurnInStage([
		{ startFrame: 0, endFrame: 100, title: 'Hello world' },
		{ startFrame: 100, endFrame: 200, title: 'Привет мир' },
		{ startFrame: 200, endFrame: 300, title: 'Hello again' },
	], CANVAS, SR)!;

	assert.deepEqual(stage.cues.map((cue) => cue.fontSubset), ['latin', 'cyrillic', 'latin']);
	assert.deepEqual([...videoBurnInFontSubsetIds(stage)], ['latin', 'cyrillic']);
	assert.deepEqual([...videoBurnInUndrawableCharacters(stage)], []);
	assert.deepEqual(
		[...videoBurnInUndrawableCharacters(
			resolveVideoBurnInStage([{ startFrame: 0, endFrame: 100, title: 'Привет, Ada' }], CANVAS, SR),
		)],
		[',', 'A', 'd', 'a'],
	);
});

test('every subset the catalog names is fetched exactly once, by its own URL', async () => {
	const asked: string[] = [];
	const fonts = await loadVideoBurnInFonts(['cyrillic', 'latin', 'cyrillic'], async (url) => {
		asked.push(url);
		return { ok: true, status: 200, blob: async () => new Blob([url]) };
	});

	assert.deepEqual([...fonts.keys()], ['cyrillic', 'latin']);
	assert.equal(asked.length, 2);
	assert.equal(asked[0], VIDEO_BURN_IN_FONT_URLS.cyrillic);
	assert.equal(asked[1], VIDEO_BURN_IN_FONT_URLS.latin);
	await assert.rejects(
		() => loadVideoBurnInFonts(['klingon'], async () => ({ ok: true, status: 200, blob: async () => new Blob() })),
		/No caption font subset named klingon/u,
	);
	await assert.rejects(
		() => loadVideoBurnInFonts(['latin'], async () => ({ ok: false, status: 404, blob: async () => new Blob() })),
		/latin caption font could not be loaded \(404\)/u,
	);
});

test('the staged subsets are the ranges the font itself declares', async () => {
	// The ranges are a copy of the font package's own stylesheet, and a copy can
	// drift. Reading the stylesheet back is what stops a subset silently claiming
	// coverage the file does not have.
	const stylesheet = await readFile('node_modules/@fontsource/inter/600.css', 'utf8');
	const declared = new Map<string, string>();
	const pattern = /\/\* inter-(?<subset>[a-z-]+)-600-normal \*\/[\s\S]*?unicode-range:(?<ranges>[^;]+);/gu;
	for (const match of stylesheet.matchAll(pattern)) {
		declared.set(match.groups!.subset!, match.groups!.ranges!.trim());
	}

	assert.equal(declared.size, VIDEO_BURN_IN_FONT_SUBSETS.length, 'every shipped subset is staged');
	assert.deepEqual(
		Object.keys(VIDEO_BURN_IN_FONT_URLS).sort(),
		VIDEO_BURN_IN_FONT_SUBSETS.map(({ id }) => id).sort(),
		'every subset the rule can choose has a file to draw from',
	);
	for (const subset of VIDEO_BURN_IN_FONT_SUBSETS) {
		const ranges = declared.get(subset.id);
		assert.ok(ranges, `${subset.id} is a subset this font ships`);
		const stated = ranges.split(',').map((entry) => {
			const [from, to] = entry.trim().replace('U+', '').split('-');
			return [Number.parseInt(from!, 16), Number.parseInt(to ?? from!, 16)];
		});
		assert.deepEqual(subset.ranges.map((range) => [...range]), stated, subset.id);
	}
});
