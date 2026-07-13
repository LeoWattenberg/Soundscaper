const CLOUD_METADATA_TOKENS = new Set([
	'account', 'audio', 'id', 'metadata', 'project', 'remote', 'share', 'snapshot',
	'state', 'sync', 'token', 'upload', 'user',
]);

/**
 * Cloud/account state is intentionally outside the browser editor profile.
 * Audacity extensions are otherwise lossless, so this filter is deliberately
 * limited to identifiers which unambiguously describe that excluded state.
 */
export function isExcludedAup4MetadataIdentifier(value) {
	const identifier = String(value || '').trim();
	if (!identifier) return false;
	if (/audio\s*[._/-]?\s*com/i.test(identifier)) return true;
	if (/(?:cloud(?:account|audio|metadata|project|snapshot|state|sync|user)|(?:account|audio|project|snapshot|sync|user)cloud)/i.test(identifier)) return true;
	const tokens = identifier
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	if (tokens.includes('audiocom') || tokens.includes('account') || tokens.includes('oauth')) return true;
	if ((tokens.includes('access') || tokens.includes('refresh')) && tokens.includes('token')) return true;
	const cloudIndex = tokens.indexOf('cloud');
	if (cloudIndex < 0) return false;
	return tokens.length === 1 || tokens.some((token, index) => index !== cloudIndex && CLOUD_METADATA_TOKENS.has(token));
}

export function sanitizeAup4Document(value) {
	const report = createReport();
	const roots = (value?.roots || []).map((entry) => sanitizeEntry(entry, report)).filter(Boolean);
	return {
		document: {
			...value,
			roots,
			root: roots.find((entry) => entry.kind === 'node')?.node || null,
			// The tree changed, so the original binary representation must not be
			// reused by a later encoder.
			original: undefined,
		},
		report: freezeReport(report),
	};
}

export function sanitizeAup4ProjectRoot(root) {
	const report = createReport();
	const node = sanitizeNode(root, report, { allowRoot: true });
	return { node, report: freezeReport(report) };
}

export function sanitizeAup4OpaqueEntry(entry) {
	const report = createReport();
	return { entry: sanitizeEntry(entry, report), report: freezeReport(report) };
}

export function inspectAup4ExcludedMetadata(root) {
	return sanitizeAup4ProjectRoot(root).report;
}

export function mergeAup4SanitizationReports(reports) {
	const merged = createReport();
	for (const report of reports || []) {
		merged.discardedEntries += Number(report?.discardedEntries || 0);
		for (const name of report?.nodeNames || []) merged.nodeNames.add(String(name));
		for (const name of report?.attributeNames || []) merged.attributeNames.add(String(name));
		for (const name of report?.tagNames || []) merged.tagNames.add(String(name));
	}
	return freezeReport(merged);
}

function sanitizeNode(node, report, options = {}) {
	if (!node || typeof node.name !== 'string') return null;
	if (!options.allowRoot && isExcludedAup4MetadataIdentifier(node.name)) {
		report.discardedEntries += 1;
		report.nodeNames.add(node.name);
		return null;
	}
	if (node.name === 'tag') {
		const name = node.content?.find((entry) => entry?.kind === 'attribute' && entry.name === 'name')?.value;
		if (isExcludedAup4MetadataIdentifier(name)) {
			report.discardedEntries += 1;
			report.tagNames.add(String(name));
			return null;
		}
	}
	return {
		...node,
		content: (node.content || []).map((entry) => sanitizeEntry(entry, report)).filter(Boolean),
	};
}

function sanitizeEntry(entry, report) {
	if (!entry || typeof entry !== 'object') return entry;
	if (entry.kind === 'node') {
		const node = sanitizeNode(entry.node, report);
		return node ? { ...entry, node } : null;
	}
	if (entry.name != null && isExcludedAup4MetadataIdentifier(entry.name)) {
		report.discardedEntries += 1;
		report.attributeNames.add(String(entry.name));
		return null;
	}
	if (entry.value instanceof Uint8Array) return { ...entry, value: entry.value.slice() };
	return { ...entry };
}

function createReport() {
	return {
		discardedEntries: 0,
		nodeNames: new Set(),
		attributeNames: new Set(),
		tagNames: new Set(),
	};
}

function freezeReport(report) {
	return Object.freeze({
		discardedEntries: report.discardedEntries,
		nodeNames: Object.freeze([...report.nodeNames].sort()),
		attributeNames: Object.freeze([...report.attributeNames].sort()),
		tagNames: Object.freeze([...report.tagNames].sort()),
	});
}
