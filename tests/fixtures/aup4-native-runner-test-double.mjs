#!/usr/bin/env node

import { copyFile } from 'node:fs/promises';

const PINNED_AUDACITY_COMMIT = 'd413849acab318b68c9d73b3ce5ac5324c1bb589';
const [command, inputPath, outputPath] = process.argv.slice(2);

if (command === '--revision' && inputPath === undefined) {
	process.stdout.write(`${PINNED_AUDACITY_COMMIT}\n`);
} else if (command === '--roundtrip' && inputPath && outputPath) {
	await copyFile(inputPath, outputPath);
} else {
	process.stderr.write('Usage: test-double --revision | --roundtrip <input.aup4> <output.aup4>\n');
	process.exitCode = 64;
}
