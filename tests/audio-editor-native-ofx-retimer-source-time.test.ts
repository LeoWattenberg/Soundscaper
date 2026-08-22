/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	assertAuthenticatedOfxRetimerSourceTimeV1,
	createOfxRetimerSourceTimeV1,
} from '../src/common/editor/native-ofx-retimer-source-time.ts';
import { ofxStandardParameterForContext } from '../src/common/editor/native-ofx-descriptor.ts';
import { createVideoRetimeExactOrdinalAuthority } from '../src/common/editor/video-retime-exact-ordinal-authority.ts';
import {
	bindCfrTiming,
	createFiveModeIntent,
} from './helpers/video-retime-export-fixtures.ts';

test('OFX Retimer SourceTime is the exact ordinal-oracle value', () => {
	assert.equal(ofxStandardParameterForContext('retimer'), 'SourceTime');
	const timing = bindCfrTiming('curve-source', 20, { num: 1, den: 1 });
	const authority = createVideoRetimeExactOrdinalAuthority(
		createFiveModeIntent(),
		new Map([['curve-source', timing]]),
	);
	const sourceTime = createOfxRetimerSourceTimeV1(authority, {
		outputOrdinal: 3, clipId: 'curve-clip', sourceId: 'curve-source',
	});
	assert.deepEqual(sourceTime, {
		parameter: 'SourceTime', outputOrdinal: 3, clipId: 'curve-clip', sourceId: 'curve-source',
		numerator: '25', denominator: '2',
	});
	assert.doesNotThrow(() => assertAuthenticatedOfxRetimerSourceTimeV1(sourceTime));
	assert.throws(() => assertAuthenticatedOfxRetimerSourceTimeV1(structuredClone(sourceTime)), /exact ordinal oracle/iu);
	assert.throws(() => createOfxRetimerSourceTimeV1(authority, {
		outputOrdinal: 3, clipId: 'missing', sourceId: 'curve-source',
	}), /one exact oracle picture binding/iu);
});

test('the OFX family reaches retime ordinals only through the authenticated authority', async () => {
	const directory = new URL('../src/common/editor/', import.meta.url);
	const files = (await readdir(directory)).filter((name) => /^native-ofx.*\.ts$/u.test(name));
	const rawOracleConsumers: string[] = [];
	const authorityConsumers: string[] = [];
	for (const name of files) {
		const source = await readFile(new URL(name, directory), 'utf8');
		if (/from ['"]\.\/video-retime-exact-ordinal-oracle\.ts['"]/u.test(source)) rawOracleConsumers.push(name);
		if (/from ['"]\.\/video-retime-exact-ordinal-authority\.ts['"]/u.test(source)) authorityConsumers.push(name);
	}
	assert.deepEqual(rawOracleConsumers, []);
	assert.deepEqual(authorityConsumers, ['native-ofx-retimer-source-time.ts']);
});
