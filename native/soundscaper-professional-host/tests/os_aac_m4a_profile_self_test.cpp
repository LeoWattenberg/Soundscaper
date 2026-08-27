/* SPDX-License-Identifier: AGPL-3.0-only */

#include "os_aac_m4a_profile.h"

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <iterator>
#include <span>
#include <string>
#include <vector>

namespace {

std::vector<uint8_t> bytes(const char *path)
{
	std::ifstream input(path, std::ios::binary);
	return std::vector<uint8_t>(std::istreambuf_iterator<char>(input), {});
}

} // namespace

int main(int argc, char **argv)
{
	if (argc != 3) return 1;
	const auto lc = bytes(argv[1]);
	const auto he = bytes(argv[2]);
	if (lc.empty() || he.empty()) return 2;
	if (!soundscaper::os_audio::exactAacLcM4a(lc, 48000u, 2u)) return 3;
	if (soundscaper::os_audio::exactAacLcM4a(lc, 44100u, 2u)
		|| soundscaper::os_audio::exactAacLcM4a(lc, 48000u, 1u)) return 4;
	if (soundscaper::os_audio::exactAacLcM4a(he, 48000u, 2u)) return 5;

	/* Both reviewed targets admit an input by reading exactly the length that was
	 * already authenticated for it, so a file that has since grown or been
	 * truncated is refused rather than judged on the part that still matches. */
	if (!soundscaper::os_audio::exactAacLcM4aFile(argv[1], lc.size(), 48000u, 2u)) return 6;
	if (soundscaper::os_audio::exactAacLcM4aFile(argv[2], he.size(), 48000u, 2u)) return 7;
	if (soundscaper::os_audio::exactAacLcM4aFile(argv[1], lc.size() - 1u, 48000u, 2u)
		|| soundscaper::os_audio::exactAacLcM4aFile(argv[1], lc.size() + 1u, 48000u, 2u)
		|| soundscaper::os_audio::exactAacLcM4aFile(argv[1], 0u, 48000u, 2u)
		|| soundscaper::os_audio::exactAacLcM4aFile(nullptr, lc.size(), 48000u, 2u)) return 8;

	/* An unattended target reports only what the refusal names, so each layer has
	 * to name itself rather than collapse into one opaque verdict. */
	using soundscaper::os_audio::AacLcM4aRefusal;
	AacLcM4aRefusal refusal = AacLcM4aRefusal::audioSpecificConfig;
	if (!soundscaper::os_audio::exactAacLcM4a(lc, 48000u, 2u, refusal)
		|| refusal != AacLcM4aRefusal::none) return 9;
	if (soundscaper::os_audio::exactAacLcM4a(he, 48000u, 2u, refusal)
		|| refusal != AacLcM4aRefusal::audioSpecificConfig) return 10;
	std::vector<uint8_t> tiny(8u, 0u);
	if (soundscaper::os_audio::exactAacLcM4a(tiny, 48000u, 2u, refusal)
		|| refusal != AacLcM4aRefusal::bounds) return 11;
	auto truncated = lc;
	truncated.resize(lc.size() - 1u);
	if (soundscaper::os_audio::exactAacLcM4a(truncated, 48000u, 2u, refusal)
		|| refusal != AacLcM4aRefusal::boxStructure) return 12;
	auto brandless = lc;
	brandless[8] = 'X';
	brandless[16] = 'X';
	brandless[20] = 'X';
	brandless[24] = 'X';
	if (soundscaper::os_audio::exactAacLcM4a(brandless, 48000u, 2u, refusal)
		|| refusal != AacLcM4aRefusal::fileType) return 13;
	if (soundscaper::os_audio::exactAacLcM4aFile(argv[2], he.size(), 48000u, 2u, refusal)
		|| refusal != AacLcM4aRefusal::audioSpecificConfig) return 14;

	/* The decoder configuration's second byte packs streamType, upStream and one
	 * reserved bit. Writers disagree about the reserved bit, so both spellings of
	 * an audio stream are admitted while the fields that carry meaning are not. */
	constexpr uint8_t decoderConfig[] = { 0x40u, 0x15u, 0x00u, 0x00u, 0x00u };
	const auto found = std::search(lc.begin(), lc.end(),
		std::begin(decoderConfig), std::end(decoderConfig));
	if (found == lc.end()
		|| std::search(found + 1, lc.end(), std::begin(decoderConfig),
			std::end(decoderConfig)) != lc.end()) return 15;
	const size_t streamTypeOffset = static_cast<size_t>(found - lc.begin()) + 1u;
	auto reservedClear = lc;
	reservedClear[streamTypeOffset] = 0x14u;
	if (!soundscaper::os_audio::exactAacLcM4a(reservedClear, 48000u, 2u, refusal)
		|| refusal != AacLcM4aRefusal::none) return 16;
	auto visualStream = lc;
	visualStream[streamTypeOffset] = 0x11u;
	if (soundscaper::os_audio::exactAacLcM4a(visualStream, 48000u, 2u, refusal)
		|| refusal != AacLcM4aRefusal::esdsStreamType) return 17;
	auto upstream = lc;
	upstream[streamTypeOffset] = 0x17u;
	if (soundscaper::os_audio::exactAacLcM4a(upstream, 48000u, 2u, refusal)
		|| refusal != AacLcM4aRefusal::esdsStreamType) return 18;
	auto wrongObject = lc;
	wrongObject[streamTypeOffset - 1u] = 0x67u;
	if (soundscaper::os_audio::exactAacLcM4a(wrongObject, 48000u, 2u, refusal)
		|| refusal != AacLcM4aRefusal::esdsObjectType) return 19;

	/* The same container is branded differently by different writers, so the
	 * declaration is admitted broadly while the track itself still has to prove
	 * what it is. The brands sit at the major brand and every compatible brand. */
	auto rebrand = [&lc](const char *major, const char *compatible) {
		auto copy = lc;
		for (size_t index = 0u; index < 4u; ++index) {
			copy[8u + index] = static_cast<uint8_t>(major[index]);
			copy[16u + index] = static_cast<uint8_t>(compatible[index]);
			copy[20u + index] = static_cast<uint8_t>(compatible[index]);
			copy[24u + index] = static_cast<uint8_t>(compatible[index]);
		}
		return copy;
	};
	for (const char *brand : { "mp42", "mp41", "isom", "iso2", "M4A " }) {
		if (!soundscaper::os_audio::exactAacLcM4a(rebrand(brand, brand), 48000u, 2u, refusal)
			|| refusal != AacLcM4aRefusal::none) return 20;
	}
	// A brand carried only as a compatible brand is still a declaration.
	if (!soundscaper::os_audio::exactAacLcM4a(rebrand("qt  ", "mp42"), 48000u, 2u, refusal)
		|| refusal != AacLcM4aRefusal::none) return 21;
	if (soundscaper::os_audio::exactAacLcM4a(rebrand("qt  ", "wave"), 48000u, 2u, refusal)
		|| refusal != AacLcM4aRefusal::fileType) return 22;
	return 0;
}
