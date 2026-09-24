/* SPDX-License-Identifier: AGPL-3.0-only */

const ALL_TARGETS = Object.freeze([
	Object.freeze({ runner: 'windows-2025', platform: 'win', arch: 'x64', node_arch: 'x64' }),
	Object.freeze({ runner: 'windows-11-arm', platform: 'win', arch: 'arm64', node_arch: 'x64' }),
	Object.freeze({ runner: 'macos-15', platform: 'mac', arch: 'arm64', node_arch: 'arm64' }),
	Object.freeze({ runner: 'ubuntu-22.04', platform: 'linux', arch: 'x64', node_arch: 'x64' }),
	Object.freeze({ runner: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64', node_arch: 'arm64' }),
]);

const WINDOWS_TARGETS = Object.freeze(ALL_TARGETS.filter(({ platform }) => platform === 'win'));
const WIN_X64_TARGETS = Object.freeze(WINDOWS_TARGETS.filter(({ arch }) => arch === 'x64'));

export function selectDesktopNightlyTestTargets(selection) {
	if (selection === 'all') return ALL_TARGETS;
	if (selection === 'windows') return WINDOWS_TARGETS;
	if (selection === 'win-x64') return WIN_X64_TARGETS;
	throw new TypeError(`Unknown nightly-with-tests target selection: ${String(selection)}`);
}
