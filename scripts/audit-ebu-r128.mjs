import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { createEbuR128Meter } from '../src/common/editor/ebu-r128.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';

const root = process.argv[2] || process.env.EBU_LOUDNESS_TEST_SET;
if (!root) {
	throw new Error('Extract EBU Loudness Test Set v5, then pass its directory or set EBU_LOUDNESS_TEST_SET.');
}
if (!(await stat(root)).isDirectory()) {
	throw new Error('The EBU audit path must be an extracted test-set directory.');
}

const fixtures = (await listWavFiles(root))
	.map((file) => ({ file, expectation: expectationFor(path.basename(file)) }))
	.filter(({ expectation }) => expectation);
if (!fixtures.length) throw new Error('No recognized EBU Tech 3341/3342 WAV fixtures were found.');

let failures = 0;
for (const { file, expectation } of fixtures) {
	const blob = new Blob([await readFile(file)]);
	const descriptor = await inspectWavBlobPcm(blob);
	const meter = createEbuR128Meter({
		sampleRate: descriptor.sampleRate,
		channelCount: descriptor.channelCount,
		running: true,
	});
	await streamWavBlobPcm(blob, {
		descriptor,
		onChunk(channels) { meter.push(channels); },
	});
	const actual = meter.snapshot().loudness[expectation.field];
	const minimum = expectation.expected - expectation.minus;
	const maximum = expectation.expected + expectation.plus;
	const passed = Number.isFinite(actual) && actual >= minimum && actual <= maximum;
	if (!passed) failures += 1;
	const relative = path.relative(root, file);
	process.stdout.write(
		`${passed ? 'PASS' : 'FAIL'} ${relative}: ${expectation.field} ${format(actual)}, `
		+ `expected ${expectation.expected} +${expectation.plus}/-${expectation.minus}\n`,
	);
}

if (failures) {
	process.exitCode = 1;
	process.stderr.write(`${failures} EBU fixture audit${failures === 1 ? '' : 's'} failed.\n`);
} else {
	process.stdout.write(`All ${fixtures.length} recognized EBU fixtures passed.\n`);
}

function expectationFor(fileName) {
	const name = fileName.toLowerCase();
	const lra = name.match(/3342[-_ ]?([1-4])(?:\D|$)/);
	if (lra) {
		return {
			field: 'loudnessRangeLu',
			expected: [10, 5, 20, 15][Number(lra[1]) - 1],
			plus: 1,
			minus: 1,
		};
	}
	const loudness = name.match(/3341(?:-2011)?[-_ ]?([1-9]|1[0-9]|2[0-3])(?:\D|$)/);
	if (!loudness) return null;
	const number = Number(loudness[1]);
	if (number === 1) return symmetric('integratedLufs', -23, 0.1);
	if (number === 2) return symmetric('integratedLufs', -33, 0.1);
	if (number >= 3 && number <= 6) return symmetric('integratedLufs', -23, 0.1);
	if (number === 9) return symmetric('shortTermLufs', -23, 0.1);
	if (number === 12) return symmetric('momentaryLufs', -23, 0.1);
	if (number >= 15 && number <= 18) return { field: 'maximumTruePeakDbtp', expected: -6, plus: 0.2, minus: 0.4 };
	if (number === 19) return { field: 'maximumTruePeakDbtp', expected: 3, plus: 0.2, minus: 0.4 };
	if (number >= 20 && number <= 23) return { field: 'maximumTruePeakDbtp', expected: 0, plus: 0.2, minus: 0.4 };
	return null;
}

function symmetric(field, expected, tolerance) {
	return { field, expected, plus: tolerance, minus: tolerance };
}

async function listWavFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...await listWavFiles(file));
		else if (entry.isFile() && entry.name.toLowerCase().endsWith('.wav')) files.push(file);
	}
	return files.sort();
}

function format(value) {
	return Number.isFinite(value) ? value.toFixed(3) : 'no result';
}
