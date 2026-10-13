/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { BrowserContext } from '@playwright/test';
import type { MotionSustainedVideoReference, verifyMotionSustainedWebm } from './motionscaper-sustained-webm.ts';

/** Separate post-measurement decoder page uses the actual OPFS File with lazy bounded source reads. */
export async function verifyMotionSustainedBrowserVideo(application: Readonly<{ context: BrowserContext }>, options: Readonly<{
	url: string; bundle: string; directoryName: string; fileName: string; frames: 300 | 1200; references: readonly MotionSustainedVideoReference[]; outputPath: string;
	transfer: Readonly<{ sha256: string; byteLength: number }>;
}>) {
	const page = await application.context.newPage();
	try {
		await page.goto(options.url); await page.addScriptTag({ content: options.bundle });
		const result = await page.evaluate(async args => {
			const value = Reflect.get(globalThis, 'MotionSustainedVerification') as { verifyMotionSustainedWebm: typeof verifyMotionSustainedWebm };
			const root = await navigator.storage.getDirectory(), directory = await root.getDirectoryHandle(args.directoryName);
			const file = await (await directory.getFileHandle(args.fileName)).getFile();
			return value.verifyMotionSustainedWebm(file, args.frames, args.references);
		}, { directoryName: options.directoryName, fileName: options.fileName, frames: options.frames, references: options.references });
		assert.equal(result.sourceSha256, options.transfer.sha256); assert.equal(result.sourceByteLength, options.transfer.byteLength);
		await writeFile(options.outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' }); return result;
	} finally { await page.close(); }
}
