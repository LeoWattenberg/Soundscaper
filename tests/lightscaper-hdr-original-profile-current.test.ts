/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import * as profile from '../src/common/editor/imaging/image-hdr-original-profile-v1.ts';
import * as contract from '../src/common/editor/imaging/image-hdr-original-contract-v1.ts';
import { staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const EXPORTS = ['IMAGE_HDR_ORIGINAL_FORMAT_V1', 'IMAGE_HDR_ORIGINAL_LIMITS_V1', 'IMAGE_HDR_ORIGINAL_MAGIC_V1',
	'IMAGE_HDR_ORIGINAL_MIME_TYPE_V1', 'IMAGE_HDR_ORIGINAL_SUFFIX_V1'] as const;

test('HDR startup profile has no executable dependency or provenance authority', () => {
	const path = new URL('../src/common/editor/imaging/image-hdr-original-profile-v1.ts', import.meta.url);
	const executable = transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code;
	assert.deepEqual(staticRelativeDependencies(executable), []);
	assert.doesNotMatch(executable, /\b(?:import\s*\(|require\s*\(|from\s*["'])/u,
		'An inert profile cannot acquire the validator, serializer, codec, renderer or storage through any value import.');
	assert.deepEqual(Object.keys(profile).sort(), [...EXPORTS].sort(), 'Profile exports only the existing format identity and data limits.');
});

test('existing HDR contract exports keep the exact profile values and the same frozen limits object', () => {
	for (const name of EXPORTS) assert.equal(contract[name], profile[name], name);
	assert.equal(profile.IMAGE_HDR_ORIGINAL_MIME_TYPE_V1, 'image/x-lightscaper-hdr');
	assert.equal(profile.IMAGE_HDR_ORIGINAL_FORMAT_V1, 'lightscaper-hdr');
	assert.equal(profile.IMAGE_HDR_ORIGINAL_SUFFIX_V1, '.lshdr');
	assert.equal(profile.IMAGE_HDR_ORIGINAL_MAGIC_V1, 'LSCHDRF1');
	const limits = profile.IMAGE_HDR_ORIGINAL_LIMITS_V1;
	assert.equal(Object.isFrozen(limits), true);
	assert.equal(Reflect.set(limits, 'maximumInputs', 10), false);
	assert.equal(contract.IMAGE_HDR_ORIGINAL_LIMITS_V1.maximumInputs, 9);
	assert.deepEqual(limits, { headerBytes: 64, maximumMetadataBytes: 65_536, maximumEncodedBytes: 205_520_896,
		maximumSide: 8192, maximumPixels: 16_777_216, maximumDecodedBytes: 268_435_456,
		maximumWorkingBytes: 805_306_368, maximumInputs: 9, maximumInputOriginalBytes: 67_108_864 });
});

test('inert limits still admit the declared RGBFloat32LE body and RGBAFloat32 consumer phases without raising any bound', () => {
	const limits = profile.IMAGE_HDR_ORIGINAL_LIMITS_V1;
	assert.equal(new TextEncoder().encode(profile.IMAGE_HDR_ORIGINAL_MAGIC_V1).byteLength, 8);
	assert.equal(limits.headerBytes, 8 + 6 * 4 + 32, 'The fixed header includes six LE words and the metadata SHA256.');
	assert.equal(limits.maximumDecodedBytes, limits.maximumPixels * 4 * Float32Array.BYTES_PER_ELEMENT);
	const alignedHeader = Math.ceil((limits.headerBytes + limits.maximumMetadataBytes) / 4) * 4;
	assert.ok(alignedHeader + limits.maximumPixels * 3 * Float32Array.BYTES_PER_ELEMENT <= limits.maximumEncodedBytes,
		'The maximum declared opaque image retains every RGBFloat32LE word.');
	assert.ok(2 * limits.maximumEncodedBytes + limits.maximumDecodedBytes < limits.maximumWorkingBytes,
		'The established encoded snapshot plus native decode phase retains bounded scratch capacity.');
	assert.ok(limits.maximumInputOriginalBytes < limits.maximumEncodedBytes);
	assert.equal(typeof contract.normalizeImageHdrOriginalProvenanceV1, 'function');
	assert.equal(typeof contract.serializeImageHdrOriginalProvenanceV1, 'function');
	assert.equal(Object.hasOwn(profile, 'normalizeImageHdrOriginalProvenanceV1'), false);
	assert.equal(Object.hasOwn(profile, 'serializeImageHdrOriginalProvenanceV1'), false);
});
