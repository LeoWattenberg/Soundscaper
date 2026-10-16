/* SPDX-License-Identifier: AGPL-3.0-only */

import { localizedAudacityParityLabel } from '../../../i18n/action-parity.js';
import {
	AUDACITY_ACTION_MANIFEST,
	AUDACITY_ACTION_STATUS,
	audacityActionDefinition,
	evaluateAudacityActionEnablement,
	isAudacityShortcutCommandDisabled,
	resolveAudacityActionHandler,
	resolveAudacityActionId,
} from '../../audacity-action-parity.js';
import { materializeApplicationMenu, type ApplicationMenuResolution } from '../application-menu-materialization.ts';

export interface CustomToolbarButtonMenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly parityActionId?: string;
	readonly disabled?: boolean;
	readonly disabledReason?: string | null;
	readonly divider?: boolean;
	readonly items?: readonly CustomToolbarButtonMenuItem[];
	readonly nativePreferences?: readonly CustomToolbarButtonMenuItem[];
	readonly onClick?: () => unknown;
	readonly resolve?: () => Readonly<ApplicationMenuResolution>;
}

export interface CustomToolbarButtonAction {
	readonly actionId: string;
	readonly label: string;
	/** Localized menu or command-inventory location, including the command label. */
	readonly path: readonly string[];
	readonly disabled: boolean;
	readonly disabledReason?: string;
	readonly onClick?: () => unknown;
}

export interface CustomToolbarButtonActionOptions {
	readonly actionRuntime?: unknown;
	readonly actionContext?: unknown;
	readonly disabledActionIds?: readonly string[];
	readonly locale?: string;
	readonly copy?: unknown;
}

interface ActionDefinition {
	readonly id: string;
	readonly label: string;
	readonly status: string;
	readonly locations: readonly string[];
}

const manifest = AUDACITY_ACTION_MANIFEST as Readonly<Record<string, ActionDefinition>>;
const definitionFor = audacityActionDefinition as (id: string) => ActionDefinition | null;
const localizedLabel = localizedAudacityParityLabel as (label: string, localization: unknown) => string;

/**
 * Build a current, selectable inventory from menu callbacks and runtime-only
 * commands. Persist only actionId: callbacks and availability belong to the
 * current editor snapshot and must be collected again when that snapshot changes.
 */
export function collectCustomToolbarButtonActions(
	menus: readonly CustomToolbarButtonMenuItem[],
	options: CustomToolbarButtonActionOptions = {},
): readonly CustomToolbarButtonAction[] {
	const { actionRuntime, disabledActionIds = [], locale = 'en', copy } = options;
	const actionContext = options.actionContext ?? currentActionContext(actionRuntime);
	const localization = copy || locale;
	const actions = new Map<string, CustomToolbarButtonAction>();
	const visit = (
		items: readonly CustomToolbarButtonMenuItem[],
		parents: readonly string[],
		ancestorDisabled = false,
		ancestorReason?: string,
	): void => {
		for (const input of items) {
			if (input.divider) continue;
			const item = materializeApplicationMenu(input);
			const path = item.label ? [...parents, item.label] : parents;
			const disabled = ancestorDisabled || item.disabled === true;
			const reason = ancestorDisabled ? ancestorReason : item.disabledReason || undefined;
			if (item.items !== undefined) {
				visit(item.items, path, disabled, reason);
			} else if (item.id && item.label) {
				// Canonicalize the concrete id, never a parameterized parity template.
				const actionId = resolveAudacityActionId(item.id) as string;
				const definition = definitionFor(actionId);
				const implemented = !definition || definition.status === AUDACITY_ACTION_STATUS.IMPLEMENTED;
				const hasAction = typeof item.onClick === 'function' || Boolean(definition) || item.disabled === true;
				if (implemented && hasAction && !actions.has(actionId)
					&& !isAudacityShortcutCommandDisabled(actionId, disabledActionIds)) {
					const stateDisabled = disabled || typeof item.onClick !== 'function'
						|| (definition !== null && actionContext !== undefined
							&& !evaluateAudacityActionEnablement(actionId, actionContext));
					actions.set(actionId, Object.freeze({
						actionId, label: item.label, path: Object.freeze([...path]), disabled: stateDisabled,
						...(stateDisabled && reason ? { disabledReason: reason } : {}),
						...(!stateDisabled ? { onClick: item.onClick } : {}),
					}));
				}
			}
			// The Preferences command can also own an embedded native menu. Its
			// own action remains selectable alongside those independent descendants.
			if (item.nativePreferences) visit(item.nativePreferences, path, disabled, reason);
		}
	};
	visit(menus, []);

	for (const inventoryDefinition of Object.values(manifest)) {
		const actionId = resolveAudacityActionId(inventoryDefinition.id) as string;
		const definition = definitionFor(actionId) || inventoryDefinition;
		if (definition.status !== AUDACITY_ACTION_STATUS.IMPLEMENTED
			|| actionId.includes('%1')
			|| actions.has(actionId)
			|| isAudacityShortcutCommandDisabled(actionId, disabledActionIds)) continue;
		const handler: unknown = resolveAudacityActionHandler(actionId, actionRuntime);
		if (typeof handler !== 'function') continue;
		const disabled = !evaluateAudacityActionEnablement(actionId, actionContext);
		const label = localizedLabel(definition.label, localization);
		const location = definition.locations[0]?.split(' > ') ?? [];
		actions.set(actionId, Object.freeze({
			actionId, label,
			path: Object.freeze([...location.map((segment) => localizedLabel(segment, localization)), label]),
			disabled,
			...(!disabled ? { onClick: handler as () => unknown } : {}),
		}));
	}
	return Object.freeze([...actions.values()]);
}

function currentActionContext(runtime: unknown): unknown {
	if (runtime === null || typeof runtime !== 'object') return undefined;
	const candidate = runtime as { getActionContext?: unknown };
	if (typeof candidate.getActionContext !== 'function') return undefined;
	try {
		return candidate.getActionContext();
	} catch {
		// A refused context must withhold state-dependent commands.
		return null;
	}
}
