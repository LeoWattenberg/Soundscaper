/* SPDX-License-Identifier: AGPL-3.0-only */
export const FRAMESCAPER_SUCCESSOR_DESKTOP = Object.freeze({
	productId: 'framescaper', line: 'successor', profile: 'framescaper-successor-v2', name: 'Framescaper Development',
	appId: 'org.framescaper.successor.desktop', scheme: 'framescaper-successor-app', origin: 'framescaper-successor-app://bundle',
	partition: 'persist:framescaper-successor-v2', userDataDirectory: 'Framescaper-Successor-v2', environmentChannel: 'framescaper:successor:v1:environment',
});
export interface FramescaperSuccessorDesktopMetadata {
	readonly schemaVersion: 1; readonly id: 'framescaper'; readonly line: 'successor'; readonly desktopProfile: 'framescaper-successor-v2';
	readonly applicationVersion: string; readonly projectSchemaVersion: 2; readonly releaseEligible: false;
}
export function normalizeFramescaperSuccessorDesktopMetadata(value: unknown): FramescaperSuccessorDesktopMetadata {
	const fields = ['schemaVersion', 'id', 'line', 'desktopProfile', 'applicationVersion', 'projectSchemaVersion', 'releaseEligible'];
	if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== fields.length) throw new TypeError('Invalid Framescaper successor desktop identity.');
	const record: Record<string, unknown> = {};
	for (const field of fields) { const entry = Object.getOwnPropertyDescriptor(value, field); if (!entry?.enumerable || !Object.hasOwn(entry, 'value')) throw new TypeError('Invalid Framescaper successor desktop identity.'); record[field] = entry.value; }
	if (record.schemaVersion !== 1 || record.id !== 'framescaper' || record.line !== 'successor' || record.desktopProfile !== FRAMESCAPER_SUCCESSOR_DESKTOP.profile
		|| typeof record.applicationVersion !== 'string' || !/^1\.1\.0-dev\.[1-9][0-9]*$/u.test(record.applicationVersion) || record.projectSchemaVersion !== 2 || record.releaseEligible !== false) throw new TypeError('Invalid Framescaper successor desktop identity.');
	return Object.freeze({ schemaVersion: 1, id: 'framescaper', line: 'successor', desktopProfile: 'framescaper-successor-v2', applicationVersion: record.applicationVersion, projectSchemaVersion: 2, releaseEligible: false });
}
export function framescaperSuccessorDesktopEnvironment(version: string, platform: string, nativeDelivery = false) {
	return Object.freeze({ productId: 'framescaper', appName: FRAMESCAPER_SUCCESSOR_DESKTOP.name, version, platform, locale: 'en',
		framescaperLine: 'successor', desktopProfile: FRAMESCAPER_SUCCESSOR_DESKTOP.profile, projectSchemaVersion: 2,
		nativeCapabilities: Object.freeze(['motion-saved-files-v1', ...(nativeDelivery ? ['frame-sequence-prores-v1'] : [])]), releaseEligible: false });
}
export function framescaperSuccessorDesktopDocumentUrl(value: string): boolean {
	try { const url = new URL(value); return url.protocol === `${FRAMESCAPER_SUCCESSOR_DESKTOP.scheme}:` && url.host === 'bundle' && !url.username && !url.password && !url.search
		&& /^\/(?:embed\/)?(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?(?:index\.html)?$/u.test(url.pathname); } catch { return false; }
}
