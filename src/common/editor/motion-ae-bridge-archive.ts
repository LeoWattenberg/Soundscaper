/* SPDX-License-Identifier: AGPL-3.0-only */
import { TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { createScapeExportDestination } from './scape-export-destination.ts';
import { throwIfScapeAborted } from './scape-abort.ts';

/** A bounded script download, containing only the explicit readable source inventory. */
export async function createMotionAeBridgeArchive(files: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<Blob> {
	throwIfScapeAborted(signal);
	const entries = Object.entries(files), names = new Set(entries.map(([name]) => name));
	if (entries.length < 1 || entries.length > 32) throw new RangeError('AE bridge download entry budget exceeded.');
	let bytes = 0;
	for (const [name, source] of entries) {
		if (!/^[A-Za-z0-9][A-Za-z0-9-]*\.(?:jsx|jsxinc|txt)$/u.test(name)) throw new TypeError('AE bridge filename must be a flat script or instruction file.');
		if (typeof source !== 'string' || source.length > 1_048_576) throw new RangeError('AE bridge source budget exceeded.');
		bytes += new TextEncoder().encode(source).byteLength; if (bytes > 1_048_576) throw new RangeError('AE bridge source budget exceeded.');
		if (name.endsWith('.jsx') || name.endsWith('.jsxinc')) for (const line of source.split('\n')) {
			if (!/^\s*#include\b/u.test(line)) continue;
			const include = /^\s*#include "([A-Za-z0-9][A-Za-z0-9-]*\.jsxinc)"\s*$/u.exec(line);
			if (!include || !names.has(include[1]!)) throw new Error('AE bridge include closure is incomplete or unsafe.');
		}
	}
	const destination = createScapeExportDestination(undefined, 'application/zip', 2_097_152);
	const writer = new ZipWriter(destination.target, { level: 0, zip64: false, useWebWorkers: false, signal });
	try {
		for (const [name, source] of entries) { throwIfScapeAborted(signal); await writer.add(name, new TextReader(source), { level: 0, signal, lastModDate: new Date('1980-01-01T00:00:00Z') }); }
		const result = await destination.finish(writer, signal); if (!result) throw new Error('AE bridge archive did not produce a download.'); return result;
	} catch (error) { return destination.abort(writer, error); }
}
