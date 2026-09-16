/* SPDX-License-Identifier: AGPL-3.0-only */
import { parseContributionSnapshot, type ContributionSnapshot, type ContributionEntry } from './community-translations.ts';

/** Browser-safe PO emitter; parsing is confined to the maintainer's Node tooling. */
export function emitTranslationPo(snapshot: ContributionSnapshot, template = false, changes: readonly ContributionEntry[] = []): string {
	const header = [
		'Project-Id-Version: Soundscaper\n',
		`Language: ${template ? '' : snapshot.locale}\n`,
		'Content-Type: text/plain; charset=UTF-8\n',
		'Content-Transfer-Encoding: 8bit\n',
		`X-Soundscaper-Snapshot: ${snapshot.snapshotId}\n`,
	].join('');
	const lines = [
		'# Soundscaper community contributions use AGPL-3.0-only.',
		'# Existing Audacity translations retain GPL-3.0-only and their upstream notices in manifest.json.',
		'# Edit msgstr translations; keep msgctxt, msgid and manifest.json unchanged.',
		'msgid ""', `msgstr ${quotePo(header)}`, '',
	];
	for (const entry of Object.values(snapshot.entries)) {
		const change = changes.find(({ key }) => key === entry.key);
		if (!template && change?.note) lines.push(...change.note.split(/\r?\n/u).map(line => `# ${line}`));
		if (!template && change?.contributor) lines.push(`#. Soundscaper-Contributor: ${JSON.stringify(change.contributor)}`);
		if (entry.baselineEntry?.[0] === 'audacity' || snapshot.community?.[entry.key]?.upstreamProvenance) {
			lines.push('#. Existing translation derives from Audacity (GPL-3.0-only); see manifest.json upstreamNotices and community attribution.');
		}
		lines.push(`#. Stable application key: ${entry.key}`, `msgctxt ${quotePo(entry.key)}`,
			`msgid ${quotePo(entry.source)}`, `msgstr ${quotePo(template ? '' : change?.translation ?? entry.baselineText)}`, '');
	}
	return `${lines.join('\n')}\n`;
}

export function createTranslationPoManifest(snapshot: ContributionSnapshot): string {
	return `${JSON.stringify(parseContributionSnapshot(snapshot), null, '\t')}\n`;
}

function quotePo(value: string): string {
	return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\t', '\\t')
		.replaceAll('\r', '\\r').replaceAll('\n', '\\n')}"`;
}
