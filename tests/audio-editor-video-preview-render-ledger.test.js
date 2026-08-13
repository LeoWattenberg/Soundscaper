import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoPreviewCompositorFallbackReport,
} from '../src/common/editor/ui/video-preview-compositor.js';
import {
	beginVideoPreviewRenderLedger,
	completeVideoPreviewRenderLedger,
	createVideoPreviewFallbackReport,
	createVideoPreviewSafeFallbackReport,
	recordVideoPreviewEntryFallback,
	recordVideoPreviewEntryRendered,
	shouldContinueVideoPreviewPlayback,
} from '../src/common/editor/ui/video-preview-render-ledger.js';

const supportedEffectTypes = new Set(['color-adjust', 'pixelate']);

test('video render ledger partitions requested effects without losing stable instance IDs', () => {
	const renderedEntry = entry('clip-a', [effect('effect-a', 'color-adjust'), effect('effect-b', 'pixelate')]);
	const fallbackEntry = entry('clip-b', [effect('effect-c', 'color-adjust')]);
	const omittedEntry = entry('clip-c', [effect('effect-d', 'future-effect')]);
	const ledger = beginVideoPreviewRenderLedger([
		{ entries: [renderedEntry, fallbackEntry, omittedEntry] },
	], supportedEffectTypes);
	recordVideoPreviewEntryRendered(ledger, renderedEntry);
	recordVideoPreviewEntryFallback(ledger, fallbackEntry);
	recordVideoPreviewEntryRendered(ledger, omittedEntry);

	assert.deepEqual(completeVideoPreviewRenderLedger(ledger, 2), {
		status: 'fallback',
		rendererStatus: 'available',
		renderedEntryCount: 2,
		effects: {
			requested: ['effect-a', 'effect-b', 'effect-c', 'effect-d'],
			rendered: ['effect-a', 'effect-b'],
			fallbackRendered: ['effect-c'],
			omitted: ['effect-d'],
		},
	});
});

test('renderer failure remains fallback with an empty effect partition', () => {
	const report = createVideoPreviewFallbackReport([], new Set());
	assert.deepEqual(report, {
		status: 'fallback',
		rendererStatus: 'failed',
		renderedEntryCount: 0,
		effects: { requested: [], rendered: [], fallbackRendered: [], omitted: [] },
	});
	assert.equal(shouldContinueVideoPreviewPlayback(report, 'playing'), false);
});

test('effect fallback does not stop playback while the renderer remains available', () => {
	const futureEntry = entry('clip-a', [effect('unsupported', 'future-effect')]);
	const report = completeVideoPreviewRenderLedger(
		beginVideoPreviewRenderLedger([{ entries: [futureEntry] }], supportedEffectTypes),
		1,
	);
	assert.equal(report.status, 'fallback');
	assert.equal(report.rendererStatus, 'available');
	assert.equal(shouldContinueVideoPreviewPlayback(report, 'playing'), true);
	assert.equal(shouldContinueVideoPreviewPlayback(report, 'stopped'), false);
});

test('disabled effects are not requested and duplicate instance IDs reject', () => {
	const inactive = entry('clip-a', [effect('effect-off', 'color-adjust', false)]);
	const report = completeVideoPreviewRenderLedger(
		beginVideoPreviewRenderLedger([{ entries: [inactive] }], supportedEffectTypes),
		0,
	);
	assert.deepEqual(report.effects, {
		requested: [], rendered: [], fallbackRendered: [], omitted: [],
	});
	assert.throws(
		() => beginVideoPreviewRenderLedger([{
			entries: [
				entry('clip-a', [effect('duplicate', 'pixelate')]),
				entry('clip-b', [effect('duplicate', 'color-adjust')]),
			],
		}], supportedEffectTypes),
		/duplicate/iu,
	);
});

test('the recovery report survives layers the strict ledger rejects', () => {
	const unreportable = [{
		entries: [
			entry('clip-a', [effect('duplicate', 'pixelate')]),
			entry('clip-b', [effect('duplicate', 'color-adjust')]),
		],
	}];
	const oversized = [{
		entries: [entry('clip-a', [effect(`effect-${'x'.repeat(200)}`, 'color-adjust')])],
	}];
	for (const layers of [unreportable, oversized]) {
		assert.throws(() => createVideoPreviewFallbackReport(layers, supportedEffectTypes));
		const expected = {
			status: 'fallback',
			rendererStatus: 'failed',
			renderedEntryCount: 0,
			effects: { requested: [], rendered: [], fallbackRendered: [], omitted: [] },
		};
		assert.deepEqual(createVideoPreviewSafeFallbackReport(layers, supportedEffectTypes), expected);
		assert.deepEqual(createVideoPreviewCompositorFallbackReport(layers), expected);
	}
	assert.deepEqual(
		createVideoPreviewSafeFallbackReport(
			[{ entries: [entry('clip-a', [effect('effect-a', 'color-adjust')])] }],
			supportedEffectTypes,
		).effects.fallbackRendered,
		['effect-a'],
	);
});

test('completed reports are immutable snapshots', () => {
	const source = entry('clip-a', [effect('effect-a', 'color-adjust')]);
	const ledger = beginVideoPreviewRenderLedger([{ entries: [source] }], supportedEffectTypes);
	recordVideoPreviewEntryFallback(ledger, source);
	const report = completeVideoPreviewRenderLedger(ledger, 0);
	assert.equal(Object.isFrozen(report), true);
	assert.equal(Object.isFrozen(report.effects), true);
	assert.equal(Object.isFrozen(report.effects.requested), true);
	assert.throws(() => report.effects.requested.push('late'), TypeError);
});

function effect(id, type, enabled = true) {
	return { id, type, enabled, params: {} };
}

function entry(clipId, effects) {
	return { clipId, effects };
}
