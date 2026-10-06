/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { installDirectPcmTarget } from './helpers/direct-pcm-save-target.js';

test('the PCM destination fixture retains complete writes while checking payload presence once', async ({ page }) => {
	await installDirectPcmTarget(page, {
		fileName: 'fixture.wav', pcmOffset: 4, prefixBytes: 7, suffixBytes: 4,
	});
	const observed = await page.evaluate(async () => {
		const handle = await globalThis.showSaveFilePicker({ suggestedName: 'fixture.wav' });
		const writer = await handle.createWritable();
		await writer.write(Uint8Array.of(2, 3, 4, 5, 0, 0, 0));
		const session = globalThis.__directPcmSave.sessions[0];
		const headerOnly = session.hasNonzeroPcm;
		await writer.write(Uint8Array.of(0, 0));
		const silentPayload = session.hasNonzeroPcm;
		// Prefix/suffix copies use native subarray operations; numeric reads below
		// observe only the presence probe, which must stop at its first witness.
		function guardedBytes(bytes, firstUnreadIndex) {
			return new Proxy(Uint8Array.from(bytes), {
				get(target, key) {
					if (typeof key === 'string' && /^\d+$/u.test(key) && Number(key) >= firstUnreadIndex) {
						throw new Error('The fixture scanned PCM after establishing its nonzero witness.');
					}
					const value = Reflect.get(target, key, target);
					return typeof value === 'function' ? value.bind(target) : value;
				},
			});
		}
		await writer.write(guardedBytes([0, 11, 0, 0], 2));
		await writer.write(guardedBytes([0, 0, 12, 13], 0));
		await writer.close();
		return {
			headerOnly, silentPayload, ...session,
			prefix: Array.from(session.prefix), suffix: Array.from(session.suffix),
		};
	});
	expect(observed).toMatchObject({
		headerOnly: false, silentPayload: false, hasNonzeroPcm: true,
		prefix: [2, 3, 4, 5, 0, 0, 0], suffix: [0, 0, 12, 13],
		prefixBytes: 7, suffixBytes: 4, totalBytes: 17, writeCalls: 4,
		opens: 1, closes: 1, commits: 1, publications: 1, aborts: 0,
		maximumWriteBytes: 7, activeWrites: 0, maxConcurrentWrites: 1,
	});
});
