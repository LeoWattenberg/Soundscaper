/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The helper side of a plug-in scan.
 *
 * Discovery is deliberately incremental. Listing candidates is safe, but
 * inspecting one has to call into a binary that may abort or never return, so
 * this reports which candidate is in flight before touching it. When the
 * process dies mid-inspection — which is the containment working, not a
 * surprise — main knows exactly which digest to quarantine instead of losing
 * the whole root.
 *
 * Nothing here hosts anything. A scan grants no project audio and leaves no
 * plug-in resident. Every known format is reported; hosting availability is
 * decided later by its authenticated adapter, payload, platform, and
 * containment authority; distribution metadata does not grant execution.
 */

/** Closed format-to-candidate mapping; the verified payload declares its subset. */
export const SCANNABLE_PLUGIN_FORMATS = Object.freeze({
	fixture: Object.freeze({ darwin: ['.scapefx'], linux: ['.scapefx'], win32: ['.scapefx'] }),
	vst3: Object.freeze({ darwin: ['.vst3'], linux: ['.vst3'], win32: ['.vst3'] }),
	clap: Object.freeze({ darwin: ['.clap'], linux: ['.clap'], win32: ['.clap'] }),
	au: Object.freeze({ darwin: ['.component'] }),
	lv2: Object.freeze({ linux: ['.lv2'] }),
	ladspa: Object.freeze({ linux: ['.so'] }),
	vamp: Object.freeze({ darwin: ['.dylib'], linux: ['.so'], win32: ['.dll'] }),
});

export const MAXIMUM_SCAN_ENTRIES = 512;
const MAXIMUM_VAMP_RESULT_BYTES = 15 * 1_024 * 1_024;

export function createNativePluginScanJobRunner({
	loadAddon, addonPath, addonSha256, hashFile, platform = process.platform, architecture = process.arch,
}) {
	if (typeof loadAddon !== 'function') throw new TypeError('A native addon loader is required.');
	if (typeof hashFile !== 'function') throw new TypeError('A file digest function is required.');
	let addon = null;

	return ({ grant, resourcePolicy, onProgress }) => {
		let cancelled = false;
		const completion = (async () => {
			const format = grant.format;
			if (!Object.hasOwn(SCANNABLE_PLUGIN_FORMATS, format)) {
				return refusal(format, 'unsupported-format', `This build does not implement the ${format} format.`);
			}
			addon ??= await loadAddon({ addonPath, addonSha256 });
			const declared = (await addon.describe?.())?.pluginFormats;
			const supported = Array.isArray(declared) ? declared.includes(format) : format === 'fixture';
			if (!supported) {
				return refusalFor(format, 'unsupported-format',
					`This authenticated payload does not implement ${format}.`);
			}
			const suffixes = SCANNABLE_PLUGIN_FORMATS[format][platform] ?? [];
			if (suffixes.length === 0) {
				return refusalFor(format, 'unsupported-format',
					`This platform does not implement the ${format} format.`);
			}
			let candidates;
			try {
				candidates = [...new Set((await Promise.all(suffixes.map((suffix) => (
					addon.listPluginCandidates(grant.rootPath, suffix)
				)))).flat())];
			} catch (error) {
				return refusalFor(format, 'root-unreadable',
					error instanceof Error ? error.message : String(error));
			}
			if (format === 'vamp') {
				return scanVampLibraries({
					addon, candidates, resourcePolicy, onProgress,
					hashFile, platform, architecture, cancelled: () => cancelled,
				});
			}
			const entries = [];
			const truncatedRoot = candidates.length > MAXIMUM_SCAN_ENTRIES;
			let entryBudgetExhausted = false;
			for (const [index, path] of candidates.slice(0, MAXIMUM_SCAN_ENTRIES).entries()) {
				if (cancelled) break;
				// Announced BEFORE the dangerous call, never after: a crash during
				// the inspection must leave main holding this candidate's identity.
				onProgress((index + 1) / Math.min(candidates.length, MAXIMUM_SCAN_ENTRIES));
				const digest = await hashFile(path);
				const inspections = inspectionsFor(await addon.inspectPluginCandidate(path, format, {
					identity: digest.identity, byteLength: digest.byteLength, sha256: digest.sha256, resourcePolicy,
				}), digest);
				for (const inspection of inspections) {
					if (entries.length >= MAXIMUM_SCAN_ENTRIES) { entryBudgetExhausted = true; break; }
					entries.push(describeEntry(path, digest, inspection));
				}
				if (entryBudgetExhausted) break;
				await new Promise((resolve) => { setTimeout(resolve, 0); });
			}
			const oversized = truncatedRoot || entryBudgetExhausted;
			return Object.freeze({
				format,
				status: oversized ? 'root-oversized' : 'scanned',
				detail: oversized
					? `Only the first ${String(MAXIMUM_SCAN_ENTRIES)} descriptors were inspected.`
					: '',
				entries: Object.freeze(entries),
			});
		})();
		return Object.freeze({
			completion,
			cancel: async () => {
				cancelled = true;
				await completion.catch(() => undefined);
			},
		});
	};
}

async function scanVampLibraries({
	addon, candidates, resourcePolicy, onProgress, hashFile, platform, architecture, cancelled,
}) {
	if (typeof addon.scanExactLibrary !== 'function'
		|| !['darwin', 'linux', 'win32'].includes(platform)
		|| !['arm64', 'x64'].includes(architecture)) {
		return vampRefusal('unsupported-format', 'This payload cannot inspect exact Vamp libraries on this machine.');
	}
	const libraries = [];
	let skipped = 0;
	let resultBytes = 0;
	let oversized = candidates.length > MAXIMUM_SCAN_ENTRIES;
	const inspected = candidates.slice(0, MAXIMUM_SCAN_ENTRIES);
	for (const [index, path] of inspected.entries()) {
		if (cancelled()) break;
		onProgress((index + 1) / inspected.length);
		const digest = await hashFile(path);
		let descriptors;
		try {
			descriptors = await addon.scanExactLibrary(path, 48_000, {
				identity: digest.identity, byteLength: digest.byteLength,
				sha256: digest.sha256, resourcePolicy,
			});
		} catch (error) {
			if (!['library-malformed', 'library-unreadable'].includes(error?.code)) throw error;
			skipped += 1;
			continue;
		}
		const observation = Object.freeze({
			kind: 'analyzer-library', format: 'vamp', libraryPath: path,
			libraryBytes: digest.byteLength, librarySha256: digest.sha256,
			identity: Object.freeze({ dev: digest.identity.dev, ino: digest.identity.ino }),
			platform, architecture, compatibility: 'compatible',
			descriptors: Object.freeze([...descriptors]),
		});
		const observationBytes = Buffer.byteLength(JSON.stringify(observation));
		if (observationBytes > MAXIMUM_VAMP_RESULT_BYTES - resultBytes) {
			oversized = true;
			break;
		}
		resultBytes += observationBytes;
		libraries.push(observation);
		await new Promise((resolve) => { setTimeout(resolve, 0); });
	}
	const detail = oversized
		? `Only the first ${String(libraries.length)} admitted Vamp libraries fit one scan result.`
		: skipped === 0 ? ''
			: `Skipped ${String(skipped)} ${skipped === 1 ? 'library' : 'libraries'} that did not expose an admitted Vamp descriptor set.`;
	return Object.freeze({
		format: 'vamp', status: oversized ? 'root-oversized' : 'scanned', detail,
		libraries: Object.freeze(libraries),
	});
}

function vampRefusal(status, detail) {
	return Object.freeze({
		format: 'vamp', status, detail: String(detail).slice(0, 1_024), libraries: Object.freeze([]),
	});
}

function refusalFor(format, status, detail) {
	return format === 'vamp' ? vampRefusal(status, detail) : refusal(format, status, detail);
}

function inspectionsFor(value, digest) {
	if (!Array.isArray(value)) return [value];
	if (value.length < 1 || value.length > MAXIMUM_SCAN_ENTRIES || value.some((entry, index) => (
		!entry || typeof entry !== 'object' || !validStableId(entry.stableId)
		|| value.findIndex((candidate) => candidate?.stableId === entry.stableId) !== index
	))) return [{ status: 'malformed', detail: 'The bundle descriptor set is ambiguous.', stableId: `unreadable:${digest.sha256}` }];
	return [...value].sort((left, right) => left.stableId < right.stableId ? -1 : left.stableId > right.stableId ? 1 : 0);
}

function validStableId(value) {
	return typeof value === 'string' && value.length > 0 && !value.includes('\0')
		&& new TextEncoder().encode(value).byteLength <= 512;
}

function describeEntry(path, digest, inspection) {
	const compatibility = compatibilityFor(inspection.status);
	const usable = compatibility === 'compatible';
	return Object.freeze({
		// A candidate that would not load has no identity of its own, so it is
		// keyed by its digest rather than by a name we would have to invent.
		stableId: usable && inspection.stableId ? inspection.stableId : `unreadable:${digest.sha256}`,
		name: usable && inspection.name ? inspection.name : basename(path),
		vendor: usable && inspection.vendor ? inspection.vendor : 'unknown',
		version: usable && inspection.version ? inspection.version : '0.0.0',
		binaryPath: path,
		binaryBytes: digest.byteLength,
		binarySha256: digest.sha256,
		classification: usable ? inspection.classification : 'unknown',
		channelSupport: usable
			? Object.freeze([Object.freeze({ inputs: inspection.inputChannels, outputs: inspection.outputChannels })])
			: Object.freeze([]),
		realtime: usable && inspection.realtime === true,
		offline: usable && inspection.offline === true,
		reportedLatencyFrames: usable ? inspection.reportedLatencyFrames : null,
		compatibility,
		descriptorVersion: 1,
	});
}

function compatibilityFor(status) {
	if (status === 'ok') return 'compatible';
	if (status === 'not-a-module') return 'wrong-architecture';
	if (status === 'no-entry') return 'unsupported-format';
	return 'malformed';
}

function refusal(format, status, detail) {
	return Object.freeze({ format, status, detail, entries: Object.freeze([]) });
}

function basename(path) {
	const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	return index >= 0 ? path.slice(index + 1) : path;
}
