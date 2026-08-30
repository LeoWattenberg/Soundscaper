/* SPDX-License-Identifier: AGPL-3.0-only */

/** Match one notice version as a complete package-version token. */
export function thirdPartyNoticeRecordsVersion(notices, dependency, version) {
	const marker = dependency === 'electron'
		? `Electron ${version}`
		: `\`${dependency}\` ${version}`;
	return new RegExp(`${escapeRegex(marker)}(?![0-9A-Za-z+_.-])`, 'u').test(notices);
}

function escapeRegex(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
