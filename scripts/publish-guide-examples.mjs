#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Publish the guide example recordings to the assets bucket.
 *
 * The tutorials tell a reader to download the very file the browser suite
 * replays them with. The files are synthesised from the recipes in
 * `handbook/guides/fixtures.mjs`, so they are neither checked in nor bundled
 * with the site: this script writes them to a staging directory and, with
 * `--upload`, puts each one in the bucket behind assets.soundscaper.org under
 * the path `handbook/guides/example-audio.mjs` links to.
 *
 *   node scripts/publish-guide-examples.mjs            # stage and list digests
 *   node scripts/publish-guide-examples.mjs --upload   # also wrangler r2 object put
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { GUIDE_FIXTURES } from '../handbook/guides/fixtures.mjs';
import { GUIDE_EXAMPLE_BASE_URL, exampleAudio } from '../handbook/guides/example-audio.mjs';

export const STAGING_DIRECTORY = '.wrangler/guide-examples';
export const BUCKET_NAME = 'soundscaper-assets';
/** The bucket was created in the EU jurisdiction; Wrangler cannot find it without being told so. */
export const BUCKET_JURISDICTION = 'eu';
const BUCKET_PREFIX = new URL(GUIDE_EXAMPLE_BASE_URL).pathname.replace(/^\/+/u, '');

function run(command, args) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { stdio: 'inherit' });
		child.on('error', reject);
		child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${String(code)}.`))));
	});
}

/** Write every example to the staging directory and report its digest and public URL. */
export async function stageExamples(repositoryRoot) {
	const directory = resolve(repositoryRoot, STAGING_DIRECTORY);
	await mkdir(directory, { recursive: true });
	const staged = [];
	for (const [id, fixture] of Object.entries(GUIDE_FIXTURES)) {
		const bytes = exampleAudio(id);
		const path = resolve(directory, fixture.file);
		await writeFile(path, bytes);
		staged.push({
			id,
			path,
			key: `${BUCKET_PREFIX}/${fixture.file}`,
			url: `${GUIDE_EXAMPLE_BASE_URL}/${fixture.file}`,
			bytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		});
	}
	return staged;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (invokedDirectly) {
	const upload = process.argv.includes('--upload');
	const unknown = process.argv.slice(2).filter((argument) => argument !== '--upload');
	if (unknown.length > 0) {
		console.error(`Unknown option: ${unknown.join(', ')}.`);
		process.exitCode = 1;
	} else {
		const staged = await stageExamples(resolve(import.meta.dirname, '..'));
		for (const example of staged) console.log(`${example.sha256}  ${String(example.bytes).padStart(8)}  ${example.url}`);
		if (upload) {
			for (const example of staged) {
				// Wrangler 4 writes to its local R2 simulation unless told otherwise;
				// `--remote` is what puts the object in the real bucket, and the
				// jurisdiction is part of the bucket's identity there.
				await run('npx', [
					'wrangler', 'r2', 'object', 'put', `${BUCKET_NAME}/${example.key}`,
					'--file', example.path, '--content-type', 'audio/wav', '--remote', '--jurisdiction', BUCKET_JURISDICTION,
				]);
			}
			console.log(`Uploaded ${String(staged.length)} example recordings.`);
		}
	}
}
