import test from 'node:test';
import assert from 'node:assert/strict';

import {
	takeCycleStableId,
	takeCycleStableName,
} from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-value-validation.ts';
import { stableId as recoveryStableId } from '../src/common/editor/take-cycle-recovery-envelope-validation.ts';
import {
	stableTakeCycleRoutedId,
	stableTakeCycleRoutedName,
} from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-routed-capture-validation.ts';

test('take-cycle stable IDs preserve configurable canonical bounds', () => {
	assert.equal(recoveryStableId, takeCycleStableId);
	assert.equal(stableTakeCycleRoutedId, takeCycleStableId);
	assert.equal(takeCycleStableId('x'.repeat(256), 'capture ID'), 'x'.repeat(256));
	assert.equal(takeCycleStableId('x'.repeat(160), 'take ID', 160), 'x'.repeat(160));
	for (const [value, maximum] of [
		['x'.repeat(257), 256],
		['x'.repeat(161), 160],
		[' padded ', 256],
		['e\u0301', 256],
		['control\u0000', 256],
		['', 256],
	] as const) {
		assert.throws(() => takeCycleStableId(value, 'capture ID', maximum), {
			name: 'TypeError', message: 'capture ID is invalid.',
		});
	}
	assert.throws(() => takeCycleStableId(1, 'capture ID'), {
		name: 'TypeError', message: 'capture ID is invalid.',
	});
});

test('take-cycle source names keep their existing compatibility contract', () => {
	assert.equal(stableTakeCycleRoutedName, takeCycleStableName);
	assert.equal(takeCycleStableName('x'.repeat(255)), 'x'.repeat(255));
	assert.equal(takeCycleStableName('e\u0301'), 'e\u0301');
	assert.equal(takeCycleStableName('control\u0000'), 'control\u0000');
	for (const value of ['', ' padded ', 'x'.repeat(256), 1]) {
		assert.throws(() => takeCycleStableName(value), {
			name: 'TypeError', message: 'Take cycle source name is invalid.',
		});
	}
});
