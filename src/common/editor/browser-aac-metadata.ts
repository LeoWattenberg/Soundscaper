/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MetadataTags } from 'mediabunny';
import { decodeArtworkData, parseId3Artwork } from './id3-artwork.ts';

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
		const pair = /^(\d+)\/(\d+)$/u.exec(value);
		const number = Number(pair ? pair[1] : value);
		if (!Number.isSafeInteger(number) || number < 1 || number > 65_535) {
			throw new RangeError(`AAC metadata ${key} must be a positive integer.`);
		}
		tags[key] = number;
		if (pair && (key === 'trackNumber' || key === 'discNumber')) {
			const total = Number(pair[2]);
			if (!Number.isSafeInteger(total) || total < 1 || total > 65_535) throw new RangeError(`AAC metadata ${key} total must be a positive integer.`);
			tags[key === 'trackNumber' ? 'tracksTotal' : 'discsTotal'] = total;
		}
		consumed.add(key);
	}
	const dateValue = metadata.date ?? metadata.year;
	if (dateValue !== undefined) {
		assertValidIsoCalendarDate(dateValue);
		const date = /^\d{4}$/u.test(dateValue)
			? new Date(`${dateValue}-01-01T00:00:00.000Z`)
			: new Date(dateValue);
		if (!Number.isFinite(date.getTime())) throw new RangeError('AAC metadata date is invalid.');
		tags.date = date;
		consumed.add('date');
		consumed.add('year');
	}
	const artwork = parseId3Artwork(metadata.id3Artwork);
	if (artwork.length) {
		tags.images = artwork.map(picture => ({ data: decodeArtworkData(picture.data), mimeType: picture.mimeType,
			kind: picture.pictureType === 3 ? 'coverFront' : picture.pictureType === 4 ? 'coverBack' : 'unknown', description: picture.description }));
	}
	const raw: NonNullable<MetadataTags['raw']> = Object.fromEntries(Object.entries(metadata).filter(([key]) => !consumed.has(key)));
	// Mediabunny writes the normalized disc pair only in mdir. A binary disc item
	// retains the standard pair when mdta also carries extended project fields.
	if (tags.discNumber !== undefined) {
		const disc = new Uint8Array(8);
		const view = new DataView(disc.buffer);
		view.setUint16(2, tags.discNumber);
		view.setUint16(4, tags.discsTotal ?? 0);
		raw.disc = disc;
	} else if (tags.discsTotal !== undefined) raw.discsTotal = String(tags.discsTotal);
	if (tags.tracksTotal !== undefined && tags.trackNumber === undefined) raw.tracksTotal = String(tags.tracksTotal);
	if (dateValue && dateValue.length > 10) raw.id3RecordingTime = dateValue;
	if (Object.keys(raw).length) tags.raw = raw;
	return Object.freeze(tags);
}

/** The mdta key table can preserve descriptive fields beyond the fixed iTunes atoms. */
export function browserAacMetadataFormat(metadata: Readonly<Record<string, string>> | undefined): 'mdir' | 'mdta' {
	return browserAacMetadataTags(metadata).raw ? 'mdta' : 'mdir';
}

function assertValidIsoCalendarDate(value: string): void {
	const parts = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/u.exec(value);
	if (!parts) return;
	const year = Number(parts[1]);
	const month = Number(parts[2]);
	const day = Number(parts[3]);
	const calendar = new Date(0);
	calendar.setUTCFullYear(year, month - 1, day);
	if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1
		|| calendar.getUTCDate() !== day) {
		throw new RangeError('AAC metadata date is invalid.');
	}
}
