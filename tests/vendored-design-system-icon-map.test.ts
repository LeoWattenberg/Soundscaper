/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ICON_SOURCE = new URL(
	'../vendor/audacity-design-system/components/src/Icon/Icon.tsx',
	import.meta.url,
);
const ICON_FONT = new URL(
	'../vendor/audacity-design-system/components/src/assets/fonts/MusescoreIcon.ttf',
	import.meta.url,
);

// MuseScore's IconCode, which the bundled font is cut from:
// `framework/ui/view/iconcodes.h` in `musescore/muse_framework`.
const SHARE_FILE = 0xef24;
const IMPORT = 0xf357;

test('the Icon map exposes MuseScore IMPORT under its own name beside SHARE_FILE', () => {
	const source = readFileSync(ICON_SOURCE, 'utf8');
	assert.match(source, /^ {2}\| 'import'$/mu, 'IconName must admit the import icon.');
	assert.match(source, /^ {2}import: '\\uF357',$/mu);
	assert.match(source, /^ {2}export: '\\uEF24',$/mu);
});

test('the bundled icon font carries both codepoints the map names', () => {
	const codepoints = readIconFontCodepoints(readFileSync(ICON_FONT));
	assert.ok(
		codepoints.has(IMPORT),
		'MusescoreIcon.ttf must carry IconCode::IMPORT; without the glyph the name renders blank.',
	);
	assert.ok(codepoints.has(SHARE_FILE));
});

/** Reads the character map of a TrueType font as the set of mapped codepoints. */
function readIconFontCodepoints(font: Buffer): Set<number> {
	const tableCount = font.readUInt16BE(4);
	let cmap = 0;
	for (let index = 0; index < tableCount; index += 1) {
		const record = 12 + index * 16;
		if (font.toString('ascii', record, record + 4) === 'cmap') cmap = font.readUInt32BE(record + 8);
	}
	assert.ok(cmap, 'The icon font must carry a cmap table.');
	let segmented = 0;
	const subtableCount = font.readUInt16BE(cmap + 2);
	for (let index = 0; index < subtableCount; index += 1) {
		const offset = font.readUInt32BE(cmap + 4 + index * 8 + 4);
		if (font.readUInt16BE(cmap + offset) === 4) segmented = cmap + offset;
	}
	assert.ok(segmented, 'The icon font must carry a format-4 cmap subtable.');
	const segmentBytes = font.readUInt16BE(segmented + 6);
	const ends = segmented + 14;
	const starts = ends + segmentBytes + 2;
	const deltas = starts + segmentBytes;
	const ranges = deltas + segmentBytes;
	const codepoints = new Set<number>();
	for (let segment = 0; segment < segmentBytes / 2; segment += 1) {
		const start = font.readUInt16BE(starts + segment * 2);
		const end = font.readUInt16BE(ends + segment * 2);
		const delta = font.readInt16BE(deltas + segment * 2);
		const rangeOffset = font.readUInt16BE(ranges + segment * 2);
		if (start === 0xffff) continue;
		for (let codepoint = start; codepoint <= end; codepoint += 1) {
			if (rangeOffset === 0) {
				if ((codepoint + delta) & 0xffff) codepoints.add(codepoint);
				continue;
			}
			const glyphIndex = ranges + segment * 2 + rangeOffset + (codepoint - start) * 2;
			if (glyphIndex + 1 >= font.length) continue;
			if (font.readUInt16BE(glyphIndex)) codepoints.add(codepoint);
		}
	}
	return codepoints;
}
