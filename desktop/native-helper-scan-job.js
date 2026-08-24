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
 * plug-in resident, and the formats whose licensing rows are still closed are
 * reported as seen-but-not-enabled rather than quietly skipped: a user who put
 * a VST3 in the folder deserves to know the editor found it and why it is not
 * offered.
 */

/** Closed format-to-candidate mapping; the verified payload declares its subset. */
export const SCANNABLE_PLUGIN_FORMATS = Object.freeze({
	fixture: '.scapefx',
	vst3: '.vst3',
	clap: '.clap',
	au: '.component',
	lv2: '.lv2',
});

export const MAXIMUM_SCAN_ENTRIES = 512;

export function createNativePluginScanJobRunner({ loadAddon, addonPath, addonSha256, hashFile }) {
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
				return refusal(format, 'unsupported-format', `This authenticated payload does not implement ${format}.`);
			}
			const suffix = SCANNABLE_PLUGIN_FORMATS[format];
			let candidates;
			try {
				candidates = await addon.listPluginCandidates(grant.rootPath, suffix);
			} catch (error) {
				return refusal(format, 'root-unreadable', error instanceof Error ? error.message : String(error));
			}
			const entries = [];
			let oversized = candidates.length > MAXIMUM_SCAN_ENTRIES;
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
					if (entries.length >= MAXIMUM_SCAN_ENTRIES) { oversized = true; break; }
					entries.push(describeEntry(path, digest, inspection));
				}
				if (oversized) break;
				await new Promise((resolve) => { setTimeout(resolve, 0); });
			}
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
		// Nothing in this build verifies a code signature yet, and claiming a
		// verdict we did not compute would be worse than admitting we did not.
		signature: 'unverifiable',
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
