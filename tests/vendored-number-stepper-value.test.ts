/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { stepNumberStepperValue } from '../vendor/audacity-design-system/components/src/NumberStepper/number-stepper-value.ts';

test('numeric stepping retains scientific notation, decimal prefixes, and trimmed units', () => {
	for (const [value, expected] of [
		['1e3', '1010'], ['.5', '10.5'], ['+20 dB', '30 dB'], ['20dB', '30 dB'],
		[' \t-2.5e+2\n Hz \t', '-240 Hz'], ['12. ms', '22 ms'],
		['1e999 Hz', '10 Hz'], ['', '10'], [' Hz ', '10 Hz'],
		['12 Hz\ninvalid', '10 12 Hz\ninvalid'],
	]) {
		assert.equal(stepNumberStepperValue(value, 10), expected, value);
	}
	assert.equal(stepNumberStepperValue('-100', 10, 0, 24_000), '0');
	assert.equal(stepNumberStepperValue('25000', -10, 1, 24_000), '24000');
});

test('long malformed pasted values cannot stall numeric stepping', () => {
	const moduleUrl = new URL('../vendor/audacity-design-system/components/src/NumberStepper/number-stepper-value.ts', import.meta.url);
	const result = spawnSync(process.execPath, ['--input-type=module', '--eval', String.raw`
import assert from 'node:assert/strict';
import { stepNumberStepperValue } from ${JSON.stringify(moduleUrl.href)};
for (const value of ['0' + ' '.repeat(100_000) + 'Hz\ninvalid', '1'.repeat(100_000) + '\nHz\ninvalid']) {
    assert.equal(stepNumberStepperValue(value, 1), '1 ' + value.trim());
}
console.log('completed');
`], { encoding: 'utf8', timeout: 5_000 });
	assert.equal(result.error, undefined, 'numeric stepping exceeded its subprocess timeout');
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), 'completed');
});
