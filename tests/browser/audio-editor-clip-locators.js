// Clip locators live outside audio-editor-test-helpers.js, which sits at the
// maintainability size cap.
//
// The vendored design system announces a clip's placement after its name
// ("<name> clip, starts at …, … long"), so anchor the accessible-name match on
// the name and stop at the comma. Matching the whole announcement would force
// every caller to predict the clip's start and duration.
export function clipNameAccessiblePattern(name) {
	return new RegExp(`^${escapeForRegExp(name)} clip(?:,|$)`);
}

export function clipByName(editor, name) {
	return editor.getByRole('group', { name: clipNameAccessiblePattern(name) });
}

function escapeForRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
