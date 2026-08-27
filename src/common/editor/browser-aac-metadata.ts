/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MetadataTags } from 'mediabunny';

/** Map the editor's normalized tags onto the metadata fields MP4 can state exactly. */
export function browserAacMetadataTags(
	metadata: Readonly<Record<string, string>> | undefined,
): MetadataTags {
	if (!metadata) return Object.freeze({});
	const tags: MetadataTags = {};
	const consumed = new Set<string>();
	const text = (source: string, target: keyof MetadataTags): void => {
		const value = metadata[source];
		if (value === undefined) return;
		(tags as Record<string, unknown>)[target] = value;
		consumed.add(source);
	};
	text('title', 'title');
	text('description', 'description');
	text('artist', 'artist');
	text('album', 'album');
	text('albumArtist', 'albumArtist');
	text('genre', 'genre');
	text('lyrics', 'lyrics');
	text('comments', 'comment');
	text('comment', 'comment');
	for (const key of ['trackNumber', 'tracksTotal', 'discNumber', 'discsTotal'] as const) {
		const value = metadata[key];
		if (value === undefined) continue;
		const number = Number(value);
		if (!Number.isSafeInteger(number) || number < 1) {
			throw new RangeError(`AAC metadata ${key} must be a positive integer.`);
		}
		tags[key] = number;
		consumed.add(key);
	}
	const dateValue = metadata.date ?? metadata.year;
	if (dateValue !== undefined) {
		const date = /^\d{4}$/u.test(dateValue)
			? new Date(`${dateValue}-01-01T00:00:00.000Z`)
			: new Date(dateValue);
		if (!Number.isFinite(date.getTime())) throw new RangeError('AAC metadata date is invalid.');
		tags.date = date;
		consumed.add(metadata.date === undefined ? 'year' : 'date');
	}
	const unsupported = Object.keys(metadata).filter((key) => !consumed.has(key));
	if (unsupported.length > 0) throw new BrowserAacMetadataUnsupportedError(unsupported);
	return Object.freeze(tags);
}

export class BrowserAacMetadataUnsupportedError extends Error {
	readonly code = 'BROWSER_AAC_METADATA_UNSUPPORTED';

	constructor(fields: readonly string[]) {
		super(`AAC/M4A browser export cannot write these metadata fields: ${fields.join(', ')}.`);
		this.name = 'BrowserAacMetadataUnsupportedError';
	}
}
