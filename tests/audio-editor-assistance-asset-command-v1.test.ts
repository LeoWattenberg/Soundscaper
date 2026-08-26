/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyAssistanceAssetUpsertCommandV1,
	snapshotAssistanceAssetUpsertCommandV1,
} from '../src/common/editor/assistance/assistance-asset-command-v1.ts';
import {
	ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
} from '../src/common/editor/assistance/assistance-asset-reference-v1.ts';

const SOURCE_SHA256 = 'ab'.repeat(32);
const MODEL_SHA256 = '12'.repeat(32);

function reference(id: string, bodySha256: string) {
	return {
		id, kind: 'transcript-v1', sourceId: 'dialogue-source',
		sourceSha256: SOURCE_SHA256, sourceStartFrame: 0, sourceEndFrame: 48_000,
		sourceVideoTimingSha256: null, recipeId: 'speech-transcript', recipeVersion: 1,
		modelArtifactSha256s: [MODEL_SHA256],
		body: {
			storageKey: `assistance-transcript-sha256:${bodySha256}`,
			mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
			byteLength: 512, sha256: bodySha256,
		},
	};
}

test('transcript reference command snapshots a closed strict upsert and preserves unaffected custody', () => {
	const retained = reference('transcript-retained', 'cd'.repeat(32));
	const inserted = reference('transcript-inserted', 'ef'.repeat(32));
	const command = snapshotAssistanceAssetUpsertCommandV1({
		type: 'assistance-asset/upsert', expectedReference: null, reference: inserted,
	});
	const applied = applyAssistanceAssetUpsertCommandV1([retained], command);
	assert.deepEqual(applied, [retained, inserted]);
	assert.deepEqual(applied[0], retained);
	assert.equal(Object.isFrozen(command), true);
	assert.equal(Object.isFrozen(command.reference.body), true);
	assert.deepEqual(command.commands, []);
	assert.equal(Object.isFrozen(command.commands), true);
	assert.throws(() => snapshotAssistanceAssetUpsertCommandV1({
		...command, unownedPath: '/tmp/transcript.json',
	}), /unsupported field/iu);
	assert.throws(() => snapshotAssistanceAssetUpsertCommandV1({
		type: 'assistance-asset/upsert', expectedReference: null, reference: inserted,
		commands: [{ type: 'assistance-asset/upsert' }],
	}), /only ordinary editor commands/iu);
});

test('transcript reference command replaces by exact expected value and refuses stale state', () => {
	const before = reference('transcript-01', 'cd'.repeat(32));
	const after = reference('transcript-01', 'ef'.repeat(32));
	const command = snapshotAssistanceAssetUpsertCommandV1({
		type: 'assistance-asset/upsert', expectedReference: before, reference: after,
	});
	assert.deepEqual(applyAssistanceAssetUpsertCommandV1([before], command), [after]);
	assert.throws(() => applyAssistanceAssetUpsertCommandV1([after], command), /expected.*stale/iu);
	assert.throws(() => snapshotAssistanceAssetUpsertCommandV1({
		type: 'assistance-asset/upsert',
		expectedReference: reference('another-transcript', '34'.repeat(32)),
		reference: after,
	}), /cannot change.*identity/iu);
});
