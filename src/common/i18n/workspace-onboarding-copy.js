/* SPDX-License-Identifier: AGPL-3.0-only */

const ENTRIES = Object.freeze([
	['workspaceOnboardingTitle', 'Getting started', 'Erste Schritte'],
	['workspaceOnboardingQuestion', 'What UI layout (workspace) do you want?', 'Welches Layout (Arbeitsbereich) möchtest du?'],
	['workspaceOnboardingAudacityDescription', 'Closely matches the layout of Audacity 4', 'Entspricht weitgehend dem Layout von Audacity 4'],
	['workspaceOnboardingSoundscaperDescription', "Soundscaper's own layout with the project bin, vertical rulers and side meters", 'Das eigene Soundscaper-Layout mit Projektablage, vertikalen Skalen und seitlichen Pegelanzeigen'],
	['workspaceOnboardingHint', 'You can change between these layouts at any time from View > Workspace', 'Du kannst jederzeit unter Ansicht > Arbeitsbereich zwischen diesen Layouts wechseln'],
	['workspaceOnboardingSelect', 'Select workspace layout', 'Arbeitsbereich-Layout auswählen'],
	['workspaceOnboardingDone', 'Done', 'Fertig'],
	['workspaceOnboardingMenu', 'Set up workspace', 'Arbeitsbereich einrichten'],
]);

export const WORKSPACE_ONBOARDING_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(ENTRIES.map(([key, , de]) => [key, de]))),
});
