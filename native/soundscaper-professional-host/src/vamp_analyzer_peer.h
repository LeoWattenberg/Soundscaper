/* SPDX-License-Identifier: AGPL-3.0-only */

#ifndef SOUNDSCAPER_VAMP_ANALYZER_PEER_H
#define SOUNDSCAPER_VAMP_ANALYZER_PEER_H

namespace soundscaper::vamp {

/** Runs the closed M5A1 analyzer protocol on binary stdin/stdout. */
int runVampAnalyzerPeer();

} // namespace soundscaper::vamp

#endif
