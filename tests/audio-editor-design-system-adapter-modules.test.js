import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { sourceLineCount } from '../scripts/lib/source-line-count.mjs';

const EDITOR_ROOT = new URL('../src/common/editor/', import.meta.url);
const ADAPTER_ROOT = new URL('design-system-adapters/', EDITOR_ROOT);
const EXPECTED_EXPORTS = Object.freeze([
	'DESIGN_SYSTEM_GAIN_DB_MAXIMUM',
	'DESIGN_SYSTEM_GAIN_DB_MINIMUM',
	'boundedCanvasDimensions',
	'createTimelineProjectIndex',
	'designValueToPan',
	'designValueToProgress',
	'designVolumeToGainDb',
	'framesToSeconds',
	'gainDbToDesignVolume',
	'panToDesignValue',
	'prepareBoundedWaveformWindow',
	'preparePeakPyramidWaveformWindow',
	'progressToDesignValue',
	'projectClipsToViewport',
	'rightmostVisibleClip',
	'secondsToFrames',
]);

test('the public design-system adapter surface remains stable', async () => {
	const adapters = await import('../src/common/editor/design-system-adapters.js');
	assert.deepEqual(Object.keys(adapters).sort(), [...EXPECTED_EXPORTS].sort());
	const focusedOwners = Object.assign({},
		await import('../src/common/editor/design-system-adapters/canvas.ts'),
		await import('../src/common/editor/design-system-adapters/control-values.ts'),
		await import('../src/common/editor/design-system-adapters/timeline.ts'),
		await import('../src/common/editor/design-system-adapters/waveform.ts'),
	);
	for (const exportName of EXPECTED_EXPORTS) {
		assert.strictEqual(adapters[exportName], focusedOwners[exportName]);
	}
});

test('the legacy adapter path is a bounded compatibility facade', async () => {
	const facade = await readFile(new URL('design-system-adapters.js', EDITOR_ROOT), 'utf8');
	assert.ok(sourceLineCount(facade) <= 30);
	assert.doesNotMatch(facade, /function prepareBoundedWaveformWindow/);
	assert.match(facade, /design-system-adapters\//);
});

test('typed adapter modules have focused owners within the maintenance budget', async () => {
	const moduleNames = (await readdir(ADAPTER_ROOT)).filter((name) => name.endsWith('.ts'));
	assert.ok(moduleNames.length >= 5, 'expected focused typed adapter modules');
	for (const moduleName of moduleNames) {
		const source = await readFile(new URL(moduleName, ADAPTER_ROOT), 'utf8');
		assert.ok(
			sourceLineCount(source) <= 600,
			`${moduleName} must stay at or below 600 lines`,
		);
	}
});
