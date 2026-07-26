export function formatAup4CompatibilitySummary(report, copy) {
	const counts = report?.counts || {};
	const items = aup4CompatibilityItems(report);
	const count = (disposition) => Math.max(
		compatibilityCount(counts[disposition]),
		items.filter((item) => item?.disposition === disposition).length,
	);
	return copy.aup4CompatibilitySummary
		.replace('{direction}', report?.direction === 'open' ? copy.aup4CompatibilityOpen : copy.aup4CompatibilitySave)
		.replace('{converted}', String(count('converted')))
		.replace('{missing}', String(count('missing')))
		.replace('{omitted}', String(count('omitted')));
}

export function aup4CompatibilityItems(report) {
	const items = [...(Array.isArray(report?.items) ? report.items : [])];
	const legacyItems = [
		...(report?.missingAudio || []).map((entry) => ({
			code: 'MISSING_LOCAL_AUDIO',
			severity: 'warning',
			disposition: 'missing',
			data: entry,
		})),
		...(Number(report?.discardedCloudMetadata?.discardedEntries) > 0 ? [{
			code: 'EXCLUDED_CLOUD_METADATA',
			severity: 'warning',
			disposition: 'omitted',
			data: report.discardedCloudMetadata,
		}] : []),
	];
	const key = (item) => `${item?.code || ''}:${item?.data?.blockId ?? ''}`;
	const seen = new Set(items.map(key));
	for (const item of legacyItems) {
		const itemKey = key(item);
		if (!seen.has(itemKey)) {
			seen.add(itemKey);
			items.push(item);
		}
	}
	return items;
}

export function formatAup4CompatibilityItem(item, copy) {
	const name = String(item?.data?.name || item?.name || '').trim();
	if (item?.disposition === 'missing' && name) {
		return copy.missingEffectLabel.replace('{name}', name);
	}
	const message = String(item?.message || '').trim();
	if (message) return message;
	return String(item?.code || copy.aup4CompatibilityDetails).replaceAll('_', ' ');
}

export function rackEffectLabel(effect, labels, copy) {
	if (effect?.type === 'missing') {
		const name = String(effect.missing?.name || copy.missingEffectUnknown).trim() || copy.missingEffectUnknown;
		return copy.missingEffectLabel.replace('{name}', name);
	}
	return labels.get(effect?.type) || String(effect?.type || '');
}

export function formatAup4CompatibilityScope(scope) {
	if (typeof scope === 'string') return scope;
	if (!scope || typeof scope !== 'object') return '';
	return [scope.kind || scope.type, scope.name || scope.trackName].filter(Boolean).join(': ');
}

export function compatibilityCount(value, items = [], disposition = '') {
	const count = Number(value);
	if (Number.isSafeInteger(count) && count >= 0) return count;
	return items.filter((item) => item?.disposition === disposition).length;
}

export function recordingOffsetSources(snapshot, copy) {
	const inputs = snapshot.recordingInputs || {};
	const sources = new Map([['global', copy.recordingDefaultInput]]);
	for (const [index, device] of (inputs.devices || []).entries()) {
		sources.set(`device:${device.deviceId}`, device.label || copy.recordingInputUnnamedDevice.replace('{number}', String(index + 1)));
	}
	for (const route of Object.values(inputs.routes || {})) {
		if (route?.kind === 'display') sources.set('display', route.label || copy.recordingDesktopAudio);
		else if (route?.kind === 'device' && route.deviceId) sources.set(`device:${route.deviceId}`, route.deviceLabel || copy.recordingInputUnknownDevice);
	}
	for (const source of inputs.sources || []) {
		const key = source.key || source.sourceKey;
		if (!key || sources.has(key)) continue;
		sources.set(key, source.label || (key === 'display' ? copy.recordingDesktopAudio : copy.recordingInputUnknownDevice));
	}
	for (const key of Object.keys(inputs.offsets || {})) {
		if (!sources.has(key)) sources.set(key, key === 'display' ? copy.recordingDesktopAudio : copy.recordingInputUnknownDevice);
	}
	return [...sources].map(([key, label]) => ({ key, label }));
}
