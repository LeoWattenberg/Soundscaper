/* SPDX-License-Identifier: AGPL-3.0-only */

export interface WorkspaceSwitcherOption {
	readonly id: string;
	readonly name: string;
}

// A stored custom workspace carries its whole layout; the switcher only needs
// its identity, so accept the record as it is persisted and project it down.
export interface CustomWorkspaceEntry extends WorkspaceSwitcherOption {
	readonly [key: string]: unknown;
}

interface WorkspaceSwitcherCopy {
	readonly workspaceModern: string;
	readonly workspaceAudacity: string;
	readonly workspaceMusic: string;
	readonly workspaceClassic: string;
	readonly workspaceVideo: string;
}

// The single source for every workspace picker outside the application menus:
// the lifecycle hook publishes it to the brand sidebar and the action-bar switcher.
export function workspaceSwitcherOptions(
	productId: string,
	copy: WorkspaceSwitcherCopy,
	customWorkspaces: readonly CustomWorkspaceEntry[] | null | undefined = [],
): WorkspaceSwitcherOption[] {
	const builtIn: WorkspaceSwitcherOption[] = productId === 'soundscaper'
		? [
			{ id: 'modern', name: copy.workspaceModern },
			{ id: 'audacity', name: copy.workspaceAudacity },
			{ id: 'music', name: copy.workspaceMusic },
			{ id: 'classic', name: copy.workspaceClassic },
		]
		: [{ id: 'video-editor', name: copy.workspaceVideo }];
	return [
		...builtIn,
		...(customWorkspaces || []).map(({ id, name }) => ({ id, name })),
	];
}
