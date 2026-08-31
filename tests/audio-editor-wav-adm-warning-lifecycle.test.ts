/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	finalizeWavAdmImport,
	wavAdmWarning,
} from '../src/common/editor/wav-adm-import.ts';

test('opaque RIFF warnings survive both ADM-less finalization paths', () => {
	const warning = wavAdmWarning('adm-opaque-chunk-preservation-incomplete', 'Opaque chunk was not preserved.');
	for (const staticPayloads of [
		[],
		[{ kind: 'axml' as const, bytes: Uint8Array.of(0xff) }],
	]) {
		const result = finalizeWavAdmImport({
			container: 'bw64', staticPayloads, serialPayload: null, chna: null, channelCount: 1,
			opaqueWarnings: [warning],
		});
		assert.equal(result.metadata, null);
		assert.ok(result.warnings.includes(warning));
	}
});
