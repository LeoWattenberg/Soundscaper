/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ProjectBinNotices from '../src/common/editor/ui/workspace/ProjectBinNotices.tsx';

const copy = { projectBinReadOnly: 'Project bin is read-only', projectBinBusy: 'Project bin is busy', close: 'Close' };

test('project-bin conditions use a bounded dismissible toast instead of an inline notice row', () => {
	const readOnly = renderToStaticMarkup(<ProjectBinNotices readOnly busy copy={copy} projectId="one" />);
	assert.match(readOnly, /data-project-bin-toast/u);
	assert.match(readOnly, /data-editor-toast="project-bin-read-only"/u);
	assert.match(readOnly, /Project bin is read-only/u);
	assert.doesNotMatch(readOnly, /Project bin is busy|kw-audio-editor__project-bin-notice/u);
	const busy = renderToStaticMarkup(<ProjectBinNotices readOnly={false} busy copy={copy} projectId="one" />);
	assert.match(busy, /data-editor-toast="project-bin-busy"/u);
	assert.equal(renderToStaticMarkup(<ProjectBinNotices readOnly={false} busy={false} copy={copy} projectId="one" />), '');
});
