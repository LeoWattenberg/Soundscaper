/* SPDX-License-Identifier: AGPL-3.0-only */
import { chooseCommandAction, chooseNestedCommandAction } from '../audio-editor-test-helpers.js';

const TASK_MENUS = {
	'Transcribe & Captions': ['Analyze', 'Speech'],
	'Identify Speakers': ['Analyze', 'Speech'],
	'Mark Reactions': ['Analyze', 'Speech'],
	'Enhance Dialogue': ['Effect', 'Noise removal and repair'],
	'Reduce Reverb': ['Effect', 'Noise removal and repair'],
	'Clean Filler & Silence': ['Effect', 'Noise removal and repair'],
	'Detect Beats & Tempo': ['Analyze', 'Music'],
	'Mark Cuts': ['Analyze', 'Video'],
	'Index Transcript': ['Tools', 'Search'],
	'Index Video': ['Tools', 'Search'],
	'Reframe': ['Effect', 'Video effects'],
	'Make Highlights': ['Edit'],
	'Generate Editorial Text': ['Generate'],
};

export async function openAssistanceTask(page, editor, label) {
	const [menu, group] = TASK_MENUS[label];
	if (group) await chooseNestedCommandAction(page, editor, menu, [group, `${label}…`]);
	else await chooseCommandAction(page, editor, menu, `${label}…`);
	return page.getByRole('dialog', { name: label, exact: true });
}

export async function openNativePreferences(page, editor, section, label) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: new RegExp(`${section}$`, 'u') }).click();
	await preferences.getByRole('button', { name: label, exact: true }).click();
}
