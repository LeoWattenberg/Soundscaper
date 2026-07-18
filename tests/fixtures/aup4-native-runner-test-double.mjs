#!/usr/bin/env node

import { copyFile } from 'node:fs/promises';

const PINNED_AUDACITY_COMMIT = '908ad0a526e5bfdab68de780e893cebe172d27eb';
const [command, inputPath, outputPath] = process.argv.slice(2);

if (command === '--revision' && inputPath === undefined) {
	process.stdout.write(`${PINNED_AUDACITY_COMMIT}\n`);
} else if (command === '--roundtrip' && inputPath && outputPath) {
	await copyFile(inputPath, outputPath);
} else {
	process.stderr.write('Usage: test-double --revision | --roundtrip <input.aup4> <output.aup4>\n');
	process.exitCode = 64;
}
