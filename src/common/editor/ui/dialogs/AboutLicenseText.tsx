/* SPDX-License-Identifier: AGPL-3.0-only */

import licenseText from '../../../../../LICENSE?raw';

/** The repository license stays available without opening a network page. */
export default function AboutLicenseText() {
	return <pre className="kw-audio-editor-about__license-text">{licenseText}</pre>;
}
