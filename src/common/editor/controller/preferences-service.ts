export interface ToolbarPreference extends Record<string, unknown> {
	readonly visible: boolean;
	readonly order: number;
}

export interface PanelPreference extends Record<string, unknown> {
	readonly visible: boolean;
	readonly dock: unknown;
	readonly order: number;
}

export interface EditorPreferencesShape extends Record<string, unknown> {
	readonly workspace: {
		readonly activeId: string;
		readonly toolbars: Record<string, ToolbarPreference>;
		readonly panels: Record<string, PanelPreference>;
		readonly toolbarButtons: Record<string, boolean>;
		readonly [key: string]: unknown;
	};
	readonly shortcuts: Record<string, string[]>;
}

interface ShortcutConflict {
	readonly binding: string;
	readonly actionIds: string[];
}

export type PreferenceGuard = <Value>(value: PromiseLike<Value> | Value) => Promise<Value>;

export interface EditorPreferencesServiceDependencies<Preferences extends EditorPreferencesShape> {
	readonly productId: string;
	readonly preferenceSettingKey: string;
	readonly defaultWorkspace: string;
	readonly newerSchemaMessage: string;
	readonly shortcutActionRequired?: string;
	readonly shortcutConflict?: string;
	readonly getPreferences: () => Preferences;
	readonly setPreferences: (preferences: Preferences) => void;
	readonly getReadOnly: () => boolean;
	readonly setReadOnly: (readOnly: boolean) => void;
	readonly loadSetting: (key: string, fallback: unknown) => Promise<unknown>;
	readonly persistSetting: (key: string, value: unknown) => Promise<unknown>;
	readonly persistSettingRequired?: (key: string, value: unknown) => Promise<unknown>;
	readonly publish: () => void;
	readonly loadPreferences: (saved: unknown) => { readonly readOnly: boolean; readonly preferences: Preferences };
	readonly createPreferences: (defaultWorkspace: string) => Preferences;
	readonly applyWorkspace: (preferences: Preferences, workspaceId: string) => Preferences;
	readonly updatePreferences: (preferences: Preferences, patch: unknown) => Preferences;
	readonly normalizeShortcut: (binding: string) => string;
	readonly findShortcutConflicts: (shortcuts: Record<string, string[]>) => ShortcutConflict[];
	readonly createWorkspace: (preferences: Preferences, options: { readonly id: string; readonly name: string }) => Preferences;
	readonly updateWorkspace: (preferences: Preferences, workspaceId: string, changes: unknown) => Preferences;
	readonly deleteWorkspace: (preferences: Preferences, workspaceId: string) => Preferences;
}

export function createEditorPreferencesService<Preferences extends EditorPreferencesShape>(
	dependencies: EditorPreferencesServiceDependencies<Preferences>,
) {
	let persistenceTail: Promise<void> = Promise.resolve();
	let durablePreferences: Preferences | null = null;

	return Object.freeze({
		load,
		update,
		revertFactorySettings,
		setWorkspace,
		toggleToolbar,
		moveToolbar,
		setToolbarButton,
		togglePanel,
		setPanel,
		movePanel,
		setShortcut,
		createWorkspace,
		updateWorkspace,
		deleteWorkspace,
	});

	async function load(guard: PreferenceGuard): Promise<Preferences> {
		let saved = await guard(dependencies.loadSetting(dependencies.preferenceSettingKey, null));
		if (!saved && dependencies.productId === 'soundscaper') {
			saved = await guard(dependencies.loadSetting('audio-editor-preferences-v1', null));
		}
		if (!saved) return dependencies.getPreferences();
		let loaded: { readonly readOnly: boolean; readonly preferences: Preferences };
		try {
			loaded = dependencies.loadPreferences(saved);
		} catch {
			const preferences = dependencies.createPreferences(dependencies.defaultWorkspace);
			dependencies.setPreferences(preferences);
			await guard(dependencies.persistSetting(dependencies.preferenceSettingKey, preferences));
			return preferences;
		}
		if (loaded.readOnly) {
			dependencies.setReadOnly(true);
			return dependencies.getPreferences();
		}
		const preferences = dependencies.productId === 'soundscaper'
			&& loaded.preferences.workspace.activeId === 'video-editor'
			? dependencies.applyWorkspace(loaded.preferences, 'modern')
			: loaded.preferences;
		dependencies.setPreferences(preferences);
		await guard(dependencies.persistSetting(dependencies.preferenceSettingKey, preferences));
		return preferences;
	}

	function persist(nextPreferences: Preferences): Promise<Preferences> {
		if (dependencies.getReadOnly()) throw new Error(dependencies.newerSchemaMessage);
		durablePreferences ??= dependencies.getPreferences();
		dependencies.setPreferences(nextPreferences);
		dependencies.publish();
		const operation = persistenceTail.then(
			persistPublishedPreferences,
			persistPublishedPreferences,
		);
		persistenceTail = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;

		async function persistPublishedPreferences(): Promise<Preferences> {
			const write = dependencies.persistSettingRequired ?? dependencies.persistSetting;
			let compatibilityPersisted = false;
			try {
				if (dependencies.productId === 'soundscaper') {
					await write('audio-editor-preferences-v1', nextPreferences);
					compatibilityPersisted = true;
				}
				await write(dependencies.preferenceSettingKey, nextPreferences);
				durablePreferences = nextPreferences;
				return nextPreferences;
			} catch (error) {
				const rollbackPreferences = durablePreferences ?? dependencies.getPreferences();
				let rollbackError: unknown = null;
				if (compatibilityPersisted) {
					try {
						await write('audio-editor-preferences-v1', rollbackPreferences);
					} catch (caught) {
						rollbackError = caught;
					}
				}
				if (dependencies.getPreferences() === nextPreferences) {
					dependencies.setPreferences(rollbackPreferences);
					dependencies.publish();
				}
				if (rollbackError) {
					throw new AggregateError(
						[error, rollbackError],
						'Preference persistence and compatibility rollback both failed.',
					);
				}
				throw error;
			}
		}
	}

	function update(patch: unknown): Promise<Preferences> {
		return persist(dependencies.updatePreferences(dependencies.getPreferences(), patch));
	}

	function revertFactorySettings(): Promise<Preferences> {
		dependencies.setReadOnly(false);
		return persist(dependencies.createPreferences(dependencies.defaultWorkspace));
	}

	function setWorkspace(workspaceId: string): Promise<Preferences> {
		return persist(dependencies.applyWorkspace(dependencies.getPreferences(), workspaceId));
	}

	function toggleToolbar(toolbarId: string): Promise<Preferences> {
		const toolbar = dependencies.getPreferences().workspace.toolbars[toolbarId];
		if (!toolbar) throw new ReferenceError(`Toolbar ${toolbarId} does not exist.`);
		return update({ workspace: { toolbars: { [toolbarId]: { ...toolbar, visible: !toolbar.visible } } } });
	}

	function moveToolbar(toolbarId: string, requestedIndex: unknown): Promise<Preferences> {
		const toolbars = dependencies.getPreferences().workspace.toolbars;
		if (!toolbars[toolbarId]) throw new ReferenceError(`Toolbar ${toolbarId} does not exist.`);
		const orderedIds = Object.keys(toolbars)
			.filter((id) => id !== toolbarId)
			.sort((left, right) => toolbars[left]!.order - toolbars[right]!.order);
		const index = Math.max(0, Math.min(orderedIds.length, Math.round(Number(requestedIndex) || 0)));
		orderedIds.splice(index, 0, toolbarId);
		const changes = Object.fromEntries(orderedIds.map((id, order) => [id, { ...toolbars[id], order }]));
		return update({ workspace: { toolbars: changes } });
	}

	function setToolbarButton(buttonId: string, visible: boolean): Promise<Preferences> {
		if (typeof buttonId !== 'string' || !buttonId.trim()) throw new TypeError('Toolbar button ID is required.');
		if (typeof visible !== 'boolean') throw new TypeError('Toolbar button visibility must be boolean.');
		return update({ workspace: { toolbarButtons: { [buttonId]: visible } } });
	}

	function togglePanel(panelId: string): Promise<Preferences> {
		const panel = dependencies.getPreferences().workspace.panels[panelId];
		if (!panel) throw new ReferenceError(`Panel ${panelId} does not exist.`);
		return setPanel(panelId, { visible: !panel.visible });
	}

	function setPanel(panelId: string, changes: Record<string, unknown> = {}): Promise<Preferences> {
		const panel = dependencies.getPreferences().workspace.panels[panelId];
		if (!panel) throw new ReferenceError(`Panel ${panelId} does not exist.`);
		return update({ workspace: { panels: { [panelId]: { ...panel, ...changes } } } });
	}

	function movePanel(panelId: string, dock: unknown, requestedIndex: unknown): Promise<Preferences> {
		const panels = dependencies.getPreferences().workspace.panels;
		const panel = panels[panelId];
		if (!panel) throw new ReferenceError(`Panel ${panelId} does not exist.`);
		const destinationIds = Object.keys(panels)
			.filter((id) => id !== panelId && panels[id]!.dock === dock)
			.sort((left, right) => panels[left]!.order - panels[right]!.order);
		const visibleDestinationIds = destinationIds.filter((id) => panels[id]!.visible);
		const index = Math.max(0, Math.min(visibleDestinationIds.length, Math.round(Number(requestedIndex) || 0)));
		const nextVisibleId = visibleDestinationIds[index];
		const previousVisibleId = visibleDestinationIds[index - 1];
		const insertionIndex = nextVisibleId
			? destinationIds.indexOf(nextVisibleId)
			: previousVisibleId
				? destinationIds.indexOf(previousVisibleId) + 1
				: destinationIds.length;
		destinationIds.splice(insertionIndex, 0, panelId);
		const changes: Record<string, Record<string, unknown>> = Object.fromEntries(destinationIds.map((id, order) => [id, {
			...panels[id],
			dock,
			order,
		}]));
		if (panel.dock !== dock) {
			Object.keys(panels)
				.filter((id) => id !== panelId && panels[id]!.dock === panel.dock)
				.sort((left, right) => panels[left]!.order - panels[right]!.order)
				.forEach((id, order) => { changes[id] = { ...panels[id], order }; });
		}
		return update({ workspace: { panels: changes } });
	}

	function setShortcut(actionId: string, bindings: string | string[]): Promise<Preferences> {
		if (typeof actionId !== 'string' || !actionId.trim()) {
			throw new TypeError(dependencies.shortcutActionRequired || 'A shortcut action is required.');
		}
		const shortcuts = { ...dependencies.getPreferences().shortcuts };
		const values = (Array.isArray(bindings) ? bindings : [bindings])
			.map((binding) => String(binding ?? '').trim())
			.filter(Boolean)
			.map(dependencies.normalizeShortcut);
		if (values.length) shortcuts[actionId] = [...new Set(values)];
		else delete shortcuts[actionId];
		const conflict = dependencies.findShortcutConflicts(shortcuts)
			.find((entry) => entry.actionIds.includes(actionId));
		if (conflict) {
			const message = dependencies.shortcutConflict || 'Shortcut {binding} conflicts with {action}.';
			throw new RangeError(message
				.replace('{binding}', conflict.binding)
				.replace('{action}', conflict.actionIds.find((id) => id !== actionId) || actionId));
		}
		return update({ shortcuts });
	}

	function createWorkspace(name: unknown, workspaceId: string): Promise<Preferences> {
		return persist(dependencies.createWorkspace(dependencies.getPreferences(), {
			id: workspaceId,
			name: String(name || '').trim(),
		}));
	}

	function updateWorkspace(workspaceId: string, changes: unknown = {}): Promise<Preferences> {
		return persist(dependencies.updateWorkspace(dependencies.getPreferences(), workspaceId, changes));
	}

	function deleteWorkspace(workspaceId: string): Promise<Preferences> {
		return persist(dependencies.deleteWorkspace(dependencies.getPreferences(), workspaceId));
	}
}

export interface EditorPreferenceActionSource {
	readonly setWorkspace: (workspaceId: string) => unknown;
	readonly toggleToolbar: (toolbarId: string) => unknown;
	readonly moveToolbar: (toolbarId: string, requestedIndex: unknown) => unknown;
	readonly setToolbarButton: (buttonId: string, visible: unknown) => unknown;
	readonly togglePanel: (panelId: string) => unknown;
	readonly setPanel: (panelId: string, changes?: unknown) => unknown;
	readonly movePanel: (panelId: string, dock: unknown, requestedIndex: unknown) => unknown;
	readonly setShortcut: (actionId: string, bindings: unknown) => unknown;
	readonly createWorkspace: (name: unknown, workspaceId: string) => unknown;
	readonly updateWorkspace: (workspaceId: string, changes?: unknown) => unknown;
	readonly deleteWorkspace: (workspaceId: string) => unknown;
}

/**
 * Names the preference service surface the way editor actions expose it, so the composition
 * root binds one delegate factory instead of a wrapper per preference action.
 */
export function createEditorPreferenceActionDelegates(
	preferences: EditorPreferenceActionSource,
	createId: (prefix: string) => string,
) {
	return Object.freeze({
		setWorkspacePreference: (workspaceId: string) => preferences.setWorkspace(workspaceId),
		toggleToolbarPreference: (toolbarId: string) => preferences.toggleToolbar(toolbarId),
		moveToolbarPreference: (toolbarId: string, requestedIndex: unknown) => preferences.moveToolbar(toolbarId, requestedIndex),
		setToolbarButtonPreference: (buttonId: string, visible: unknown) => preferences.setToolbarButton(buttonId, visible),
		togglePanelPreference: (panelId: string) => preferences.togglePanel(panelId),
		setPanelPreference: (panelId: string, changes: unknown = {}) => preferences.setPanel(panelId, changes),
		movePanelPreference: (panelId: string, dock: unknown, requestedIndex: unknown) => preferences.movePanel(panelId, dock, requestedIndex),
		setShortcutPreference: (actionId: string, bindings: unknown) => preferences.setShortcut(actionId, bindings),
		createWorkspacePreference: (name: unknown, workspaceId: string = createId('workspace')) => preferences.createWorkspace(name, workspaceId),
		updateWorkspacePreference: (workspaceId: string, changes: unknown = {}) => preferences.updateWorkspace(workspaceId, changes),
		deleteWorkspacePreference: (workspaceId: string) => preferences.deleteWorkspace(workspaceId),
	});
}
