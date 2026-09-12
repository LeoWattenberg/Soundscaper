/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const toolRoot = fileURLToPath(new URL('../scripts/models/milestone-7-conversion-tool/', import.meta.url));

function runPython(source) {
	const result = spawnSync('python3', ['-S', '-B', '-c', source], {
		encoding: 'utf8', env: { ...process.env, PYTHONPATH: toolRoot },
	});
	assert.equal(result.status, 0, result.stderr || String(result.error));
}

test('dereverb export and parity entrypoints import without loading optional frameworks', () => {
	runPython(`
from soundscaper_m7_conversion.dereverb_room import export_dereverb_room, run_dereverb_room
assert callable(export_dereverb_room)
assert callable(run_dereverb_room)
`);
});

test('TIGER export pooling adaptation restores the source operation after a failed export', () => {
	runPython(`
from types import SimpleNamespace
from soundscaper_m7_conversion.tiger_onnx import adaptive_average_pool_onnx
original = object()
functional = SimpleNamespace(adaptive_avg_pool1d=original)
torch = SimpleNamespace(nn=SimpleNamespace(functional=functional))
try:
    with adaptive_average_pool_onnx(torch):
        assert functional.adaptive_avg_pool1d is not original
        raise RuntimeError('export failed')
except RuntimeError:
    pass
assert functional.adaptive_avg_pool1d is original
`);
});
