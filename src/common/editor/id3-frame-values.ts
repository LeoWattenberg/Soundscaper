/* SPDX-License-Identifier: AGPL-3.0-only */

import { ID3_DESCRIPTIVE_FIELDS } from './id3-descriptive-fields.ts';
import { decodeArtworkData, parseId3Artwork } from './id3-artwork.ts';

const encoder = new TextEncoder();
export const ID3_TEXT_FRAME_IDS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries([
	...ID3_DESCRIPTIVE_FIELDS.filter(field => field.kind === 'text' || field.kind === 'pairs' || field.kind === 'url')
		.map(field => [normalizeId3Key(field.key), field.frame]),
	['track', 'TRCK'], ['year', 'TDRC'], ['disc', 'TPOS'],
]));
export const ID3_CONTROL_KEYS = new Set(['commentlanguage', 'commentdescription', 'lyricslanguage', 'lyricsdescription',
	'termslanguage', 'id3artwork', 'identifierowner', 'ratingemail']);
for (const key of ['ownershipprice', 'ownershipdate', 'commercialvaliduntil', 'commercialcontacturl',
	'commercialreceivedas', 'commercialseller', 'commercialdescription', 'synchronizedlyricslanguage', 'synchronizedlyricsdescription']) ID3_CONTROL_KEYS.add(key);

export function normalizeId3Key(key: string): string { return key.toLowerCase().replace(/[^a-z0-9]/gu, ''); }

export function id3FramePayload(id: string, value: string): Uint8Array<ArrayBuffer> {
	if (id.startsWith('W')) {
		const url = new URL(value);
		if (!['https:', 'http:', 'mailto:', 'ftp:'].includes(url.protocol)) throw new RangeError('Unsupported metadata URL scheme.');
		return encoder.encode(url.href);
	}
	if (id === 'TIPL' || id === 'TMCL') {
		const pairs = value.split(/\r?\n/u).filter(Boolean).flatMap(line => {
			const split = line.indexOf('=');
			if (split < 1 || split === line.length - 1) throw new RangeError('Credits require one role=name pair per line.');
			return [line.slice(0, split).trim(), line.slice(split + 1).trim()];
		});
		return joinId3Bytes(Uint8Array.of(3), encoder.encode(pairs.join('\0')));
	}
	return joinId3Bytes(Uint8Array.of(3), encoder.encode(value));
}

export function structuredId3Payload(key: string, value: string, metadata: Readonly<Record<string, string>>): Readonly<{ id: string; payload: Uint8Array<ArrayBuffer> }> | null {
	if (key === 'ownershipseller') {
		return { id: 'OWNE', payload: joinId3Bytes(Uint8Array.of(3), asciiPrice(metadata.ownershipPrice || ''), Uint8Array.of(0),
			compactDate(metadata.ownershipDate || ''), encoder.encode(value)) };
	}
	if (key === 'commercialprice') {
		const received = Number(metadata.commercialReceivedAs || '0');
		if (!Number.isInteger(received) || received < 0 || received > 8) throw new RangeError('Commercial received-as must be 0–8.');
		const contact = id3FramePayload('WCOM', metadata.commercialContactUrl || '');
		return { id: 'COMR', payload: joinId3Bytes(Uint8Array.of(3), asciiPrice(value), Uint8Array.of(0),
			compactDate(metadata.commercialValidUntil || ''), contact, Uint8Array.of(0, received),
			encoder.encode(metadata.commercialSeller || ''), Uint8Array.of(0), encoder.encode(metadata.commercialDescription || ''), Uint8Array.of(0, 0)) };
	}
	if (key === 'synchronizedlyrics') {
		const language = metadata.synchronizedLyricsLanguage || 'eng';
		if (!/^[a-z]{3}$/u.test(language)) throw new RangeError('Timed lyrics require an ISO 639-2 language code.');
		const lines = value.split(/\r?\n/u).filter(Boolean).map(line => {
			const match = /^\[(\d+):([0-5]\d)(?:\.(\d{1,3}))?\](.*)$/u.exec(line);
			if (!match) throw new RangeError('Timed lyrics require [mm:ss.xxx] text on each line.');
			const milliseconds = Number(match[1]) * 60000 + Number(match[2]) * 1000 + Number((match[3] || '').padEnd(3, '0'));
			if (!Number.isSafeInteger(milliseconds) || milliseconds > 0xffff_ffff) throw new RangeError('A lyric timestamp exceeds the ID3 limit.');
			const time = new Uint8Array(4);
			new DataView(time.buffer).setUint32(0, milliseconds);
			return joinId3Bytes(encoder.encode(match[4]), Uint8Array.of(0), time);
		});
		return { id: 'SYLT', payload: joinId3Bytes(Uint8Array.of(3), encoder.encode(language), Uint8Array.of(2, 1),
			encoder.encode(metadata.synchronizedLyricsDescription || ''), Uint8Array.of(0), ...lines) };
	}
	if (key === 'comment' || key === 'comments' || key === 'lyrics' || key === 'termsofuse') {
		const prefix = key === 'lyrics' ? 'lyrics' : key === 'termsofuse' ? 'terms' : 'comment';
		const language = metadata[`${prefix}Language`] || 'eng';
		if (!/^[a-z]{3}$/u.test(language)) throw new RangeError('ID3 text language requires an ISO 639-2 code.');
		const id = prefix === 'lyrics' ? 'USLT' : prefix === 'terms' ? 'USER' : 'COMM';
		return { id, payload: joinId3Bytes(Uint8Array.of(3), encoder.encode(language),
			...(id === 'USER' ? [] : [encoder.encode(metadata[`${prefix}Description`] || ''), Uint8Array.of(0)]), encoder.encode(value)) };
	}
	if (key === 'uniqueidentifier') {
		const owner = metadata.identifierOwner;
		if (!owner || /[^\x20-\x7e]/u.test(owner)) throw new RangeError('A unique identifier requires an ASCII owner URL.');
		const bytes = encoder.encode(value);
		if (bytes.length > 64) throw new RangeError('A unique identifier supports at most 64 bytes.');
		return { id: 'UFID', payload: joinId3Bytes(encoder.encode(owner), Uint8Array.of(0), bytes) };
	}
	if (key === 'playcount') return { id: 'PCNT', payload: counter(value) };
	if (key === 'rating') {
		const rating = Number(value);
		if (!Number.isInteger(rating) || rating < 0 || rating > 255) throw new RangeError('ID3 rating must be 0–255.');
		const email = metadata.ratingEmail || '';
		if (/[^\x20-\x7e]/u.test(email)) throw new RangeError('ID3 rating email must be ASCII.');
		return { id: 'POPM', payload: joinId3Bytes(encoder.encode(email), Uint8Array.of(0, rating), counter(metadata.playCount || '0')) };
	}
	return null;
}

function asciiPrice(value: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Z]{3}\d+(?:\.\d+)?(?:\/[A-Z]{3}\d+(?:\.\d+)?)*$/u.test(value)) throw new RangeError('A price requires a currency code and amount, for example EUR12.99.');
	return encoder.encode(value);
}

function compactDate(value: string): Uint8Array<ArrayBuffer> {
	if (!/^\d{8}$/u.test(value)) throw new RangeError('An ownership or offer date requires YYYYMMDD.');
	const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}T00:00:00Z`);
	if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10).replaceAll('-', '') !== value) throw new RangeError('Invalid ownership or offer date.');
	return encoder.encode(value);
}

export function id3ArtworkFrames(metadata: Readonly<Record<string, string>>): readonly Uint8Array<ArrayBuffer>[] {
	return parseId3Artwork(metadata.id3Artwork).map(picture => createId3Frame('APIC', joinId3Bytes(
		Uint8Array.of(3), encoder.encode(picture.mimeType), Uint8Array.of(0, picture.pictureType),
		encoder.encode(picture.description), Uint8Array.of(0), decodeArtworkData(picture.data),
	)));
}

export function createId3Frame(id: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(10 + payload.length);
	bytes.set(encoder.encode(id));
	bytes.set(id3Synchsafe(payload.length), 4);
	bytes.set(payload, 10);
	return bytes;
}

export function id3Synchsafe(value: number): Uint8Array<ArrayBuffer> {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fff_ffff) throw new RangeError('ID3 metadata is too large.');
	return Uint8Array.of((value >>> 21) & 127, (value >>> 14) & 127, (value >>> 7) & 127, value & 127);
}

export function joinId3Bytes(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) { bytes.set(part, offset); offset += part.length; }
	return bytes;
}

function counter(value: string): Uint8Array<ArrayBuffer> {
	if (!/^\d{1,20}$/u.test(value)) throw new RangeError('Play count must be a non-negative integer.');
	let count = BigInt(value);
	const bytes: number[] = [];
	do { bytes.unshift(Number(count & 255n)); count >>= 8n; } while (count);
	while (bytes.length < 4) bytes.unshift(0);
	return Uint8Array.from(bytes);
}
