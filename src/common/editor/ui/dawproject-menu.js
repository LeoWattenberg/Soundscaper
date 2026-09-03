/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The File > DAWproject submenu.
 *
 * It mirrors the Audacity projects submenu beside it — open, export, and the
 * report of what the exchange could not carry — and lives behind its own seam
 * because `application-menus.js` sits at its size ceiling. The report entry
 * opens the shared delivery-report dialog, which is where every interchange
 * profile publishes its conversions; it is enabled only while the report on
 * hand is a DAWproject one, so the entry never opens a report about something
 * else under this menu's name.
 */
export function createDawprojectMenu({ copy, blocked, snapshot, actions }) {
	const reportAvailable = snapshot?.deliveryReport?.subject?.format === 'dawproject';
	return {
		id: 'dawproject',
		label: copy.dawprojectMenu,
		disabled: blocked,
		items: [
			{ id: 'open-dawproject', label: copy.openDawproject, disabled: blocked, onClick: actions.openDawproject },
			{ id: 'save-dawproject', label: copy.saveDawproject, disabled: blocked, onClick: actions.saveDawproject },
			{
				id: 'dawproject-report',
				label: copy.dawprojectReport,
				disabled: !reportAvailable,
				onClick: actions.openDeliveryReport,
			},
		],
	};
}
