#!/usr/bin/env node

import { copyFile } from 'node:fs/promises';

const PINNED_AUDACITY_COMMIT = '4c177d436e48c1d20f231eada44035593cb26292';
const [command, inputPath, outputPath] = process.argv.slice(2);

if (command === '--revision' && inputPath === undefined) {
	process.stdout.write(`${PINNED_AUDACITY_COMMIT}\n`);
} else if (command === '--roundtrip' && inputPath && outputPath) {
	await copyFile(inputPath, outputPath);
} else {
	process.stderr.write('Usage: test-double --revision | --roundtrip <input.aup4> <output.aup4>\n');
	process.exitCode = 64;
}
