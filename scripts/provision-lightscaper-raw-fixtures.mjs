#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import manifest from '../config/lightscaper-raw-fixtures.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'vendor/lightscaper-raw-fixtures');
const args = process.argv.slice(2);
if (args.some(argument => argument !== '--check') || args.length > 1) throw new TypeError('Expected only optional --check.');
const checkOnly = args.includes('--check');
if (manifest.schemaVersion !== 1 || manifest.fixtures.length !== 1) throw new RangeError('Unknown Lightscaper RAW fixture register.');
await mkdir(directory, { recursive: true });
for (const pin of manifest.fixtures) {
	if (!/^[\w.-]+$/u.test(pin.fileName) || !/^[a-f0-9]{64}$/u.test(pin.sha256)
		|| !Number.isSafeInteger(pin.byteLength) || pin.byteLength < 1 || pin.byteLength > 8 * 1024 * 1024
		|| pin.license !== 'CC0-1.0' || !pin.licenseEvidence.startsWith('https://discuss.pixls.us/')) throw new TypeError('Unreviewed RAW fixture pin.');
	const target = resolve(directory, pin.fileName);
	let existing;
	try { existing = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
	if (existing && valid(existing, pin)) { console.log(`Verified ${pin.fileName} (${pin.byteLength} bytes).`); continue; }
	if (checkOnly) throw new Error(`Missing or corrupt ${pin.fileName}; run node scripts/provision-lightscaper-raw-fixtures.mjs.`);
	const response = await fetch(pin.url, { credentials: 'omit', signal: AbortSignal.timeout(60_000) });
	if (!response.ok || !response.body) throw new Error(`RAW fixture download failed (${response.status}).`);
	const reader = response.body.getReader(), parts = []; let length = 0;
	try {
		for (;;) {
			const result = await reader.read(); if (result.done) break;
			length += result.value.byteLength;
			if (length > pin.byteLength) throw new RangeError('RAW fixture exceeds its exact byte pin.');
			parts.push(Buffer.from(result.value));
		}
		const bytes = Buffer.concat(parts); if (!valid(bytes, pin)) throw new Error('RAW fixture SHA256 or length differs from its pin.');
		const staged = `${target}.${process.pid}.tmp`;
		try { await writeFile(staged, bytes, { flag: 'wx' }); await rename(staged, target); }
		finally { await rm(staged, { force: true }); }
		console.log(`Provisioned ${pin.fileName} (${pin.byteLength} bytes; ${pin.license}).`);
	} finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
}

function valid(bytes, pin) {
	return bytes.byteLength === pin.byteLength && createHash('sha256').update(bytes).digest('hex') === pin.sha256;
}
