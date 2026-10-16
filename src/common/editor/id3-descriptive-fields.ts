/* SPDX-License-Identifier: AGPL-3.0-only */

/** Descriptive ID3v2.4 fields: https://id3.org/id3v2.4.0-frames */
export interface Id3DescriptiveField {
	readonly key: string;
	readonly frame: string;
	readonly group: string;
	readonly kind: 'text' | 'url' | 'pairs' | 'structured';
}

export const ID3_DESCRIPTIVE_FIELDS: readonly Id3DescriptiveField[] = Object.freeze([
	{ key: 'title', frame: 'TIT2', group: 'identity', kind: 'text' },
	{ key: 'subtitle', frame: 'TIT3', group: 'identity', kind: 'text' },
	{ key: 'grouping', frame: 'TIT1', group: 'identity', kind: 'text' },
	{ key: 'album', frame: 'TALB', group: 'identity', kind: 'text' },
	{ key: 'trackNumber', frame: 'TRCK', group: 'identity', kind: 'text' },
	{ key: 'discNumber', frame: 'TPOS', group: 'identity', kind: 'text' },
	{ key: 'setSubtitle', frame: 'TSST', group: 'identity', kind: 'text' },
	{ key: 'isrc', frame: 'TSRC', group: 'identity', kind: 'text' },
	{ key: 'artist', frame: 'TPE1', group: 'credits', kind: 'text' },
	{ key: 'albumArtist', frame: 'TPE2', group: 'credits', kind: 'text' },
	{ key: 'conductor', frame: 'TPE3', group: 'credits', kind: 'text' },
	{ key: 'remixer', frame: 'TPE4', group: 'credits', kind: 'text' },
	{ key: 'composer', frame: 'TCOM', group: 'credits', kind: 'text' },
	{ key: 'lyricist', frame: 'TEXT', group: 'credits', kind: 'text' },
	{ key: 'involvedPeople', frame: 'TIPL', group: 'credits', kind: 'pairs' },
	{ key: 'musicianCredits', frame: 'TMCL', group: 'credits', kind: 'pairs' },
	{ key: 'encodedBy', frame: 'TENC', group: 'credits', kind: 'text' },
	{ key: 'genre', frame: 'TCON', group: 'description', kind: 'text' },
	{ key: 'bpm', frame: 'TBPM', group: 'description', kind: 'text' },
	{ key: 'initialKey', frame: 'TKEY', group: 'description', kind: 'text' },
	{ key: 'language', frame: 'TLAN', group: 'description', kind: 'text' },
	{ key: 'mood', frame: 'TMOO', group: 'description', kind: 'text' },
	{ key: 'mediaType', frame: 'TMED', group: 'description', kind: 'text' },
	{ key: 'fileType', frame: 'TFLT', group: 'description', kind: 'text' },
	{ key: 'length', frame: 'TLEN', group: 'description', kind: 'text' },
	{ key: 'playlistDelay', frame: 'TDLY', group: 'description', kind: 'text' },
	{ key: 'date', frame: 'TDRC', group: 'dates', kind: 'text' },
	{ key: 'releaseDate', frame: 'TDRL', group: 'dates', kind: 'text' },
	{ key: 'originalReleaseDate', frame: 'TDOR', group: 'dates', kind: 'text' },
	{ key: 'encodingTime', frame: 'TDEN', group: 'dates', kind: 'text' },
	{ key: 'taggingTime', frame: 'TDTG', group: 'dates', kind: 'text' },
	{ key: 'originalAlbum', frame: 'TOAL', group: 'original', kind: 'text' },
	{ key: 'originalArtist', frame: 'TOPE', group: 'original', kind: 'text' },
	{ key: 'originalLyricist', frame: 'TOLY', group: 'original', kind: 'text' },
	{ key: 'originalFilename', frame: 'TOFN', group: 'original', kind: 'text' },
	{ key: 'copyright', frame: 'TCOP', group: 'rights', kind: 'text' },
	{ key: 'productionCopyright', frame: 'TPRO', group: 'rights', kind: 'text' },
	{ key: 'publisher', frame: 'TPUB', group: 'rights', kind: 'text' },
	{ key: 'owner', frame: 'TOWN', group: 'rights', kind: 'text' },
	{ key: 'termsOfUse', frame: 'USER', group: 'rights', kind: 'structured' },
	{ key: 'radioStation', frame: 'TRSN', group: 'rights', kind: 'text' },
	{ key: 'radioStationOwner', frame: 'TRSO', group: 'rights', kind: 'text' },
	{ key: 'albumSort', frame: 'TSOA', group: 'sorting', kind: 'text' },
	{ key: 'artistSort', frame: 'TSOP', group: 'sorting', kind: 'text' },
	{ key: 'titleSort', frame: 'TSOT', group: 'sorting', kind: 'text' },
	{ key: 'encoderSettings', frame: 'TSSE', group: 'description', kind: 'text' },
	{ key: 'comments', frame: 'COMM', group: 'text', kind: 'structured' },
	{ key: 'commentLanguage', frame: 'COMM', group: 'text', kind: 'structured' },
	{ key: 'commentDescription', frame: 'COMM', group: 'text', kind: 'structured' },
	{ key: 'lyrics', frame: 'USLT', group: 'text', kind: 'structured' },
	{ key: 'lyricsLanguage', frame: 'USLT', group: 'text', kind: 'structured' },
	{ key: 'lyricsDescription', frame: 'USLT', group: 'text', kind: 'structured' },
	{ key: 'termsLanguage', frame: 'USER', group: 'rights', kind: 'structured' },
	{ key: 'commercialUrl', frame: 'WCOM', group: 'links', kind: 'url' },
	{ key: 'copyrightUrl', frame: 'WCOP', group: 'links', kind: 'url' },
	{ key: 'audioFileUrl', frame: 'WOAF', group: 'links', kind: 'url' },
	{ key: 'artistUrl', frame: 'WOAR', group: 'links', kind: 'url' },
	{ key: 'audioSourceUrl', frame: 'WOAS', group: 'links', kind: 'url' },
	{ key: 'radioStationUrl', frame: 'WORS', group: 'links', kind: 'url' },
	{ key: 'paymentUrl', frame: 'WPAY', group: 'links', kind: 'url' },
	{ key: 'publisherUrl', frame: 'WPUB', group: 'links', kind: 'url' },
	{ key: 'uniqueIdentifier', frame: 'UFID', group: 'identity', kind: 'structured' },
	{ key: 'identifierOwner', frame: 'UFID', group: 'identity', kind: 'structured' },
	{ key: 'playCount', frame: 'PCNT', group: 'description', kind: 'structured' },
	{ key: 'rating', frame: 'POPM', group: 'description', kind: 'structured' },
	{ key: 'ratingEmail', frame: 'POPM', group: 'description', kind: 'structured' },
	{ key: 'ownershipPrice', frame: 'OWNE', group: 'rights', kind: 'structured' },
	{ key: 'ownershipDate', frame: 'OWNE', group: 'rights', kind: 'structured' },
	{ key: 'ownershipSeller', frame: 'OWNE', group: 'rights', kind: 'structured' },
	{ key: 'commercialPrice', frame: 'COMR', group: 'rights', kind: 'structured' },
	{ key: 'commercialValidUntil', frame: 'COMR', group: 'rights', kind: 'structured' },
	{ key: 'commercialContactUrl', frame: 'COMR', group: 'rights', kind: 'structured' },
	{ key: 'commercialReceivedAs', frame: 'COMR', group: 'rights', kind: 'structured' },
	{ key: 'commercialSeller', frame: 'COMR', group: 'rights', kind: 'structured' },
	{ key: 'commercialDescription', frame: 'COMR', group: 'rights', kind: 'structured' },
	{ key: 'synchronizedLyrics', frame: 'SYLT', group: 'text', kind: 'structured' },
	{ key: 'synchronizedLyricsLanguage', frame: 'SYLT', group: 'text', kind: 'structured' },
	{ key: 'synchronizedLyricsDescription', frame: 'SYLT', group: 'text', kind: 'structured' },
]);

const CORE_KEYS = new Set(['title', 'artist', 'album', 'trackNumber', 'year', 'comments']);
const FIELD_KEYS = new Map([...ID3_DESCRIPTIVE_FIELDS.map(field => field.key), ...CORE_KEYS, 'id3Artwork']
	.map(key => [normalizedKey(key), key]));
for (const [alias, key] of [['track', 'trackNumber'], ['disc', 'discNumber'], ['comment', 'comments']] as const) FIELD_KEYS.set(alias, key);

export function isId3ProjectTag(key: string): boolean {
	return FIELD_KEYS.has(normalizedKey(key));
}

export function id3ProjectFieldValue(metadata: Readonly<Record<string, unknown>>, key: string): string {
	const canonical = FIELD_KEYS.get(normalizedKey(key)) ?? key;
	const tags = canonicalTags(record(metadata.tags));
	const root = metadata[canonical];
	const value = CORE_KEYS.has(canonical) && root != null && String(root) !== ''
		? root : tags[canonical] ?? root;
	return String(value ?? (canonical === 'date' ? id3ProjectFieldValue(metadata, 'year') : ''));
}

export function updateId3ProjectField(metadata: Readonly<Record<string, unknown>>, key: string, value: string): Readonly<Record<string, unknown>> {
	const canonical = FIELD_KEYS.get(normalizedKey(key));
	if (!canonical) throw new RangeError('Unknown ID3 field.');
	const entries = Object.entries(record(metadata.tags));
	const retained = entries.filter(([tag]) => FIELD_KEYS.get(normalizedKey(tag)) !== canonical);
	const tags = Object.fromEntries(retained);
	if (CORE_KEYS.has(canonical)) return retained.length === entries.length ? { [canonical]: value } : { [canonical]: value, tags };
	return { tags: { ...tags, [canonical]: value } };
}

/** Share one complete tag projection with dialog defaults and direct export commands. */
export function projectAudioMetadata(value: unknown): Readonly<Record<string, string>> {
	const metadata = record(value);
	const tags = canonicalTags(record(metadata.tags));
	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(tags)) {
		if (item != null && String(item) !== '') Object.defineProperty(result, key, { value: String(item), enumerable: true, configurable: true, writable: true });
	}
	for (const key of [...CORE_KEYS, 'genre', 'copyright']) {
		if (!CORE_KEYS.has(key) && Object.hasOwn(tags, key)) continue;
		if (metadata[key] != null && String(metadata[key]) !== '') result[key] = String(metadata[key]);
	}
	return result;
}

function normalizedKey(key: string): string { return key.toLowerCase().replace(/[^a-z0-9]/gu, ''); }

function canonicalTags(tags: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(tags)) {
		const canonical = FIELD_KEYS.get(normalizedKey(key)) ?? key;
		if (canonical !== key && Object.hasOwn(tags, canonical)) continue;
		Object.defineProperty(result, canonical, { value, enumerable: true, configurable: true, writable: true });
	}
	return result;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}
