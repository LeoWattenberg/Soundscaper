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

export function deliveryReportItems(report) {
	return Array.isArray(report?.items) ? report.items : [];
}

export function formatDeliveryReportSummary(report, copy) {
	const counts = report?.counts || {};
	const items = deliveryReportItems(report);
	const count = (disposition) => Math.max(
		compatibilityCount(counts[disposition]),
		items.filter((item) => item?.disposition === disposition).length,
	);
	return copy.deliveryReportSummary
		.replace('{format}', String(report?.subject?.format || ''))
		.replace('{converted}', String(count('converted')))
		.replace('{omitted}', String(count('omitted')));
}

export function formatDeliveryReportSubject(report, copy) {
	const subject = report?.subject || {};
	return copy.deliveryReportSubject
		.replace('{format}', String(subject.format || ''))
		.replace('{sampleRate}', String(subject.sampleRate ?? ''))
		.replace('{channels}', String(subject.channelCount ?? ''));
}

/**
 * Delivery item codes are stable identifiers rather than sentences, so the
 * renderer turns `delivery.lossy-encode` into readable text without inventing
 * a per-code translation table it would then have to keep in step.
 */
export function formatDeliveryReportItem(item) {
	const message = String(item?.message || '').trim();
	if (message) return message;
	const code = String(item?.code || '').replace(/^delivery\./u, '');
	return code.replaceAll('-', ' ').replace(/^./u, (character) => character.toUpperCase());
}

export function formatDeliveryReportItemDetail(item) {
	const data = item?.data;
	if (!data || typeof data !== 'object') return '';
	return Object.entries(data)
		.filter(([, value]) => value != null && value !== '')
		.map(([key, value]) => `${key}: ${String(value)}`)
		.join(', ');
}
