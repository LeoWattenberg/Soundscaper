/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readLegacyAupXml } from '../src/common/editor/aup-legacy-xml.ts';
import { parseSesxDocument } from '../src/common/editor/sesx-import.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';

test('legacy AUP XML can exceed its byte threshold after approval without relaxing structure limits', async () => {
	const warnings: number[] = [];
	const input = { size: 17, text: async () => '<project/>' };
	const options = { confirmFileSizeWarning: async (warning: { byteLength: number }) => { warnings.push(warning.byteLength); return true; } };
	assert.equal((await readLegacyAupXml(input, { maximumBytes: 16 }, options)).name, 'project');
	assert.deepEqual(warnings, [17]);
	await assert.rejects(readLegacyAupXml({ size: 17, text: async () => '<project><a/><b/></project>' },
		{ maximumBytes: 16, maximumElements: 2 }, options), (error: unknown) => (
		(error as { code?: string }).code === 'PROJECT_XML_NODE_LIMIT'));
});

test('legacy AUP warning cancellation prevents the XML read', async () => {
	let reads = 0;
	await assert.rejects(readLegacyAupXml({ size: 17, text: async () => { reads += 1; return '<project/>'; } },
		{ maximumBytes: 16 }, { confirmFileSizeWarning: async () => false }), { name: 'AbortError' });
	assert.equal(reads, 0);
});

test('approved XML byte bounds can reach SESX and DAWproject parsers while DTD protections remain', () => {
	const sesx = '<sesx><session sampleRate="48000" audioChannelType="stereo"><tracks/></session></sesx>';
	assert.equal(parseSesxDocument(sesx, { maximumBytes: sesx.length }).sampleRate, 48_000);
	assert.throws(() => parseSesxDocument(sesx, { maximumBytes: 1 }), /exceeds/);
	assert.throws(() => parseSesxDocument('<!DOCTYPE sesx [<!ENTITY x "bad">]>' + sesx,
		{ maximumBytes: 1000 }), /doctype|entity/);
	assert.equal(parseDawprojectDocument('<Project/>', null, { maximumBytes: 1000 }).root.name, 'Project');
	assert.throws(() => parseDawprojectDocument('<Project/>', null, { maximumBytes: 1 }), /exceeds/);
});
