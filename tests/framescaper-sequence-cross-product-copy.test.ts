/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperSessionClipboardSequence,
	prepareFramescaperMulticameraCrossProductCopySequence,
	prepareFramescaperNestedSequenceCrossProductCopySequence,
} from '../src/framescaper/editor-project-sequence-interchange.ts';
import { createFramescaperProjectSequence } from '../src/framescaper/editor-project-sequence.ts';

type Data = Record<string, unknown>;

const REQUEST = Object.freeze({ targetProduct: 'soundscaper', mode: 'copy-only-preservation' });

function flatProject(): Data {
	return createFramescaperProjectSequence(PROFILE, {}) as unknown as Data;
}

function nestedProject(): Data {
	const base = flatProject();
	const main = structuredClone((base.sequences as Data[])[0]!);
	return createFramescaperProjectSequence(PROFILE, {
		sequences: [main, { ...structuredClone(main), id: 'nested-sequence', name: 'Nested' }],
		subsequences: [{
			id: 'subsequence-1',
			sequenceId: 'main-sequence',
			sourceSequenceId: 'nested-sequence',
			sequenceStartFrame: 0,
			sequenceFrameCount: 10,
			sourceInFrame: 0,
			sourceFrameCount: 10,
		}],
	} as never) as unknown as Data;
}

function prepareNested(project: Data, request: unknown = REQUEST): Data {
	return prepareFramescaperNestedSequenceCrossProductCopySequence(
		PROFILE,
		project,
		request as never,
	) as unknown as Data;
}

test('a nested-sequence copy is detached as forbidden-to-activate and not editable', () => {
	const copy = prepareNested(nestedProject());

	assert.equal(copy.kind, 'framescaper-nested-sequence-cross-product-copy');
	assert.equal(copy.targetProduct, 'soundscaper');
	assert.equal(copy.mode, 'copy-only-preservation');
	assert.equal(copy.activation, 'forbidden');
	assert.equal(copy.editable, false);
	assert.equal(((copy.project as Data).subsequences as unknown[]).length, 1);
});

test('a cross-product copy requires a nonempty graph of the kind it preserves', () => {
	assert.throws(() => prepareNested(flatProject()), /nonempty sequence graph/u);
	assert.throws(
		() => prepareFramescaperMulticameraCrossProductCopySequence(
			PROFILE,
			flatProject(),
			REQUEST as never,
		),
		/nonempty sequence graph/u,
	);
});

test('a cross-product copy may only target Soundscaper as copy-only preservation', () => {
	const project = nestedProject();

	assert.throws(
		() => prepareNested(project, { targetProduct: 'framescaper', mode: 'copy-only-preservation' }),
		RangeError,
	);
	assert.throws(
		() => prepareNested(project, { targetProduct: 'soundscaper', mode: 'editable' }),
		RangeError,
	);
});

test('the copy request is an exact two-field record', () => {
	const project = nestedProject();

	assert.throws(() => prepareNested(project, { ...REQUEST, extra: 1 }), TypeError);
	assert.throws(() => prepareNested(project, { targetProduct: 'soundscaper' }), TypeError);
	assert.throws(() => prepareNested(project, []), TypeError);
	assert.throws(() => prepareNested(project, null), TypeError);
});

test('an unauthenticated runtime profile cannot author a cross-product copy', () => {
	assert.throws(
		() => prepareFramescaperNestedSequenceCrossProductCopySequence(
			{},
			nestedProject(),
			REQUEST as never,
		),
		TypeError,
	);
});

test('the flat session clipboard fails closed on a nested-sequence graph', () => {
	assert.throws(
		() => createFramescaperSessionClipboardSequence(PROFILE, nestedProject(), {}),
		/cannot preserve a nested-sequence graph/u,
	);
});
