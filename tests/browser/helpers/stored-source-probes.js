/* SPDX-License-Identifier: AGPL-3.0-only */
import { SOUNDSCAPER_DATABASE_NAME } from './editor-databases.js';

/**
 * Read decoded audio back out of the editor's own stored sources.
 *
 * A browser spec cannot listen to the output, so these open the editor's
 * IndexedDB inside the page and measure the samples an effect or an import
 * actually wrote. They are the only helpers that read the database directly,
 * which is why they sit apart from the page-driving helpers.
 */

export async function sourcePeakChannels(page, sourceName) {
	return page.evaluate(({ databaseName, name }) => new Promise((resolve, reject) => {
		const openRequest = indexedDB.open(databaseName);
		openRequest.onerror = () => reject(openRequest.error);
		openRequest.onsuccess = () => {
			const database = openRequest.result;
			const sourcesRequest = database.transaction('sources', 'readonly').objectStore('sources').getAll();
			sourcesRequest.onerror = () => reject(sourcesRequest.error);
			sourcesRequest.onsuccess = () => {
				const source = sourcesRequest.result.find((candidate) => candidate.name === name);
				if (!source) {
					database.close();
					reject(new Error(`Source ${name} was not found.`));
					return;
				}
				const peaksRequest = database.transaction('analysis', 'readonly')
					.objectStore('analysis').get(`audio-editor-peaks-v2:${source.id}`);
				peaksRequest.onerror = () => reject(peaksRequest.error);
				peaksRequest.onsuccess = () => {
					database.close();
					const peaks = peaksRequest.result?.value;
					const level = peaks?.levels?.[0];
					resolve({
						version: peaks?.version,
						channelCount: peaks?.channelCount,
						blockSizes: (peaks?.levels || []).map(({ blockSize }) => blockSize),
						channels: (level?.channels || []).map((channel) => ({
							minimum: Math.min(...channel.minimums),
							maximum: Math.max(...channel.maximums),
						})),
					});
				};
			};
		};
	}), { databaseName: SOUNDSCAPER_DATABASE_NAME, name: sourceName });
}

export async function effectSourceMetadata(page) {
	return page.evaluate((databaseName) => new Promise((resolve, reject) => {
		const openRequest = indexedDB.open(databaseName);
		openRequest.onerror = () => reject(openRequest.error);
		openRequest.onsuccess = () => {
			const database = openRequest.result;
			const request = database.transaction('sources', 'readonly').objectStore('sources').getAll();
			request.onerror = () => {
				database.close();
				reject(request.error);
			};
			request.onsuccess = () => {
				database.close();
				resolve(request.result.filter((source) => source.id?.startsWith('audacity-effect-')));
			};
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}

export async function effectSourcePeak(page, name) {
	return page.evaluate(async ({ databaseName, effectName }) => {
		const { source, peaks } = await new Promise((resolve, reject) => {
			const openRequest = indexedDB.open(databaseName);
			openRequest.onerror = () => reject(openRequest.error);
			openRequest.onsuccess = () => {
				const database = openRequest.result;
				const sourcesRequest = database.transaction('sources', 'readonly').objectStore('sources').getAll();
				sourcesRequest.onerror = () => reject(sourcesRequest.error);
				sourcesRequest.onsuccess = () => {
					const source = sourcesRequest.result.find((candidate) => candidate.name?.includes(effectName));
					if (!source) {
						database.close();
						resolve({ source: null, peaks: null });
						return;
					}
					const peaksRequest = database.transaction('analysis', 'readonly')
						.objectStore('analysis').get(`audio-editor-peaks-v2:${source.id}`);
					peaksRequest.onerror = () => reject(peaksRequest.error);
					peaksRequest.onsuccess = () => {
						database.close();
						resolve({ source, peaks: peaksRequest.result?.value || null });
					};
				};
			};
		});
		if (!source || !peaks?.levels?.length) return 0;
		let peak = 0;
		for (const level of peaks.levels) {
			for (const channel of level.channels || []) {
				for (const sample of channel.minimums || []) peak = Math.max(peak, Math.abs(sample));
				for (const sample of channel.maximums || []) peak = Math.max(peak, Math.abs(sample));
			}
		}
		return peak;
	}, { databaseName: SOUNDSCAPER_DATABASE_NAME, effectName: name });
}

