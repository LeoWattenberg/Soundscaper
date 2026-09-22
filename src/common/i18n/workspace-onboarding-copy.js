/* SPDX-License-Identifier: AGPL-3.0-only */

const ENTRIES = Object.freeze([
	['workspaceOnboardingTitle', 'Getting started', 'Erste Schritte'],
	['workspaceOnboardingQuestion', 'What UI layout (workspace) do you want?', 'Welches Layout (Arbeitsbereich) möchtest du?'],
	['workspaceOnboardingAudacityDescription', 'Closely matches the layout of Audacity 4', 'Entspricht weitgehend dem Layout von Audacity 4'],
	['workspaceOnboardingSoundscaperDescription', "Soundscaper's own layout with vertical rulers, side meters and effects on the left", 'Das eigene Soundscaper-Layout mit vertikalen Skalen, seitlichen Pegelanzeigen und Effekten auf der linken Seite'],
	['workspaceOnboardingHint', 'You can change between these layouts at any time from View > Workspace', 'Du kannst jederzeit unter Ansicht > Arbeitsbereich zwischen diesen Layouts wechseln'],
	['workspaceOnboardingSelect', 'Select workspace layout', 'Arbeitsbereich-Layout auswählen'],
	['workspaceOnboardingMenu', 'Set up workspace', 'Arbeitsbereich einrichten'],
]);

export const WORKSPACE_ONBOARDING_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))),
});
