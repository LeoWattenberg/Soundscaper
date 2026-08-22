// SPDX-License-Identifier: AGPL-3.0-only

#include "image_sequence_pack.hpp"
#include "sha256.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <cstdint>
#include <fstream>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <string>
#include <string_view>

namespace framescaper::media {
namespace {

constexpr std::size_t header_bytes = 128;
constexpr std::size_t index_bytes = 64;
constexpr std::string_view magic = "FSISPK01";

class sequence_error final : public std::runtime_error {
public:
	using std::runtime_error::runtime_error;
};

[[nodiscard]] std::uint32_t u32(const std::uint8_t* value) noexcept {
	return static_cast<std::uint32_t>(value[0])
		| (static_cast<std::uint32_t>(value[1]) << 8U)
		| (static_cast<std::uint32_t>(value[2]) << 16U)
		| (static_cast<std::uint32_t>(value[3]) << 24U);
}

[[nodiscard]] std::uint64_t u64(const std::uint8_t* value) noexcept {
	std::uint64_t result{};
	for (std::size_t index = 0; index < 8; ++index) {
		result |= static_cast<std::uint64_t>(value[index]) << (index * 8U);
	}
	return result;
}

[[nodiscard]] unsigned hex(const char value) {
	if (value >= '0' && value <= '9') return static_cast<unsigned>(value - '0');
	if (value >= 'a' && value <= 'f') return static_cast<unsigned>(value - 'a' + 10);
	throw sequence_error("The canonical inventory contains an invalid lowercase hexadecimal digit.");
}

[[nodiscard]] std::string binary_digest(const std::uint8_t* value) {
	constexpr std::string_view digits = "0123456789abcdef";
	std::string result(64, '0');
	for (std::size_t index = 0; index < 32; ++index) {
		result[index * 2] = digits[value[index] >> 4U];
		result[index * 2 + 1] = digits[value[index] & 0x0fU];
	}
	return result;
}

[[nodiscard]] bool all_zero(const std::uint8_t* value, const std::size_t count) noexcept {
	return std::all_of(value, value + count, [](const std::uint8_t byte) { return byte == 0; });
}

void read_exact(std::ifstream& input, std::uint8_t* output, const std::size_t count) {
	input.read(reinterpret_cast<char*>(output), static_cast<std::streamsize>(count));
	if (input.gcount() != static_cast<std::streamsize>(count)) {
		throw sequence_error("The image-sequence pack is truncated.");
	}
}

class inventory_reader final {
public:
	explicit inventory_reader(const std::filesystem::path& path) : input_{path, std::ios::binary} {
		if (!input_) throw sequence_error("The authenticated image-sequence inventory cannot be opened.");
		expect("{\"schemaVersion\":1,\"entries\":[");
	}

	struct entry final {
		std::string file_name;
		std::uint32_t frame_number{};
		std::uint64_t byte_length{};
		std::string sha256;
	};

	[[nodiscard]] entry next(const std::uint32_t index) {
		if (index > 0) expect(",");
		expect("{\"fileName\":");
		auto name = string();
		expect(",\"frameNumber\":");
		const auto number = integer("frame number", 1'000'000'000, true);
		expect(",\"byteLength\":");
		const auto length = integer("frame byte length", image_sequence_maximum_frame_bytes, false);
		expect(",\"sha256\":\"");
		std::string digest(64, '0');
		for (char& value : digest) { value = take(); static_cast<void>(hex(value)); }
		expect("\"}");
		return {std::move(name), static_cast<std::uint32_t>(number), length, std::move(digest)};
	}

	void finish() {
		expect("]}");
		if (input_.peek() != std::char_traits<char>::eof()) {
			throw sequence_error("The canonical inventory has trailing bytes.");
		}
	}

private:
	[[nodiscard]] char take() {
		const auto value = input_.get();
		if (value == std::char_traits<char>::eof()) throw sequence_error("The canonical inventory is truncated.");
		return static_cast<char>(value);
	}

	void expect(const std::string_view value) {
		for (const char expected : value) {
			if (take() != expected) throw sequence_error("The image-sequence inventory is not canonical JSON.");
		}
	}

	[[nodiscard]] std::uint64_t integer(
		const std::string_view label,
		const std::uint64_t maximum,
		const bool allow_zero
	) {
		std::array<char, 24> bytes{};
		std::size_t count{};
		while (true) {
			const auto value = input_.peek();
			if (value < '0' || value > '9') break;
			if (count == bytes.size()) throw sequence_error(std::string{label} + " is oversized.");
			bytes[count++] = take();
		}
		if (count == 0 || (count > 1 && bytes[0] == '0')) {
			throw sequence_error(std::string{label} + " is not a canonical integer.");
		}
		std::uint64_t result{};
		const auto converted = std::from_chars(bytes.data(), bytes.data() + count, result);
		if (converted.ec != std::errc{} || converted.ptr != bytes.data() + count
			|| (!allow_zero && result == 0) || result > maximum) {
			throw sequence_error(std::string{label} + " is outside its bounded domain.");
		}
		return result;
	}

	[[nodiscard]] std::string string() {
		if (take() != '"') throw sequence_error("An inventory file name must be a JSON string.");
		std::string result;
		while (true) {
			const auto value = take();
			if (value == '"') break;
			if (static_cast<unsigned char>(value) < 0x20U) {
				throw sequence_error("An inventory file name contains a control byte.");
			}
			if (value != '\\') {
				const auto first = static_cast<unsigned char>(value);
				result += value;
				if (first >= 0x80U) {
					int remaining{};
					std::uint32_t code{};
					std::uint32_t minimum{};
					if ((first & 0xe0U) == 0xc0U) { remaining = 1; code = first & 0x1fU; minimum = 0x80U; }
					else if ((first & 0xf0U) == 0xe0U) { remaining = 2; code = first & 0x0fU; minimum = 0x800U; }
					else if ((first & 0xf8U) == 0xf0U) { remaining = 3; code = first & 0x07U; minimum = 0x10000U; }
					else throw sequence_error("An inventory file name is not valid UTF-8.");
					for (int index = 0; index < remaining; ++index) {
						const auto continuation = static_cast<unsigned char>(take());
						if ((continuation & 0xc0U) != 0x80U) {
							throw sequence_error("An inventory file name is not valid UTF-8.");
						}
						result += static_cast<char>(continuation);
						code = (code << 6U) | (continuation & 0x3fU);
					}
					if (code < minimum || code > 0x10ffffU || (code >= 0xd800U && code <= 0xdfffU)) {
						throw sequence_error("An inventory file name is not canonical scalar UTF-8.");
					}
				}
			}
			else {
				const auto escaped = take();
				if (escaped == '"' || escaped == '\\') result += escaped;
				else if (escaped == 'b') result += '\b';
				else if (escaped == 'f') result += '\f';
				else if (escaped == 'n') result += '\n';
				else if (escaped == 'r') result += '\r';
				else if (escaped == 't') result += '\t';
				else if (escaped == 'u') {
					unsigned code{};
					for (int index = 0; index < 4; ++index) code = (code << 4U) | hex(take());
					if (code > 0x7fU || code == 0) {
						throw sequence_error("A native inventory name uses an unsupported escaped scalar.");
					}
					result += static_cast<char>(code);
				} else throw sequence_error("An inventory file name uses a noncanonical JSON escape.");
			}
			if (result.size() > 512) throw sequence_error("An inventory file name exceeds its byte ceiling.");
		}
		if (result.empty() || result.find('/') != std::string::npos
			|| result.find('\\') != std::string::npos || result.find('\0') != std::string::npos) {
			throw sequence_error("An inventory file name is not one bounded plain name.");
		}
		return result;
	}

	std::ifstream input_;
};

[[nodiscard]] bool extension_matches(const std::string& name, const image_sequence_profile profile) {
	const auto dot = name.find_last_of('.');
	if (dot == std::string::npos || dot + 1 == name.size()) return false;
	auto extension = name.substr(dot + 1);
	std::transform(extension.begin(), extension.end(), extension.begin(), [](const unsigned char value) {
		return static_cast<char>(value >= 'A' && value <= 'Z' ? value - 'A' + 'a' : value);
	});
	if (profile == image_sequence_profile::png) return extension == "png";
	if (profile == image_sequence_profile::tiff) return extension == "tif" || extension == "tiff";
	return extension == "exr";
}

[[nodiscard]] std::uint64_t checked_add(const std::uint64_t left, const std::uint64_t right) {
	if (right > image_sequence_maximum_pack_bytes - left) {
		throw sequence_error("The image-sequence pack offset schedule overflows its ceiling.");
	}
	return left + right;
}

} // namespace

image_sequence_profile parse_image_sequence_profile(const std::string_view value) {
	if (value == "decode-png-sequence") return image_sequence_profile::png;
	if (value == "decode-tiff-sequence") return image_sequence_profile::tiff;
	if (value == "decode-openexr-sequence") return image_sequence_profile::openexr;
	throw sequence_error("The image-sequence decoder profile is outside its closed registry.");
}

admitted_image_sequence authenticate_image_sequence_pack(
	const image_sequence_profile profile,
	const std::filesystem::path& pack_path,
	const std::string& pack_sha256,
	const std::uint64_t pack_byte_length,
	const std::filesystem::path& inventory_path,
	const std::string& inventory_sha256,
	const std::uint64_t inventory_byte_length,
	const std::uint32_t frame_rate_num,
	const std::uint32_t frame_rate_den
) {
	if (pack_byte_length > image_sequence_maximum_pack_bytes
		|| inventory_byte_length > image_sequence_maximum_inventory_bytes
		|| frame_rate_num == 0 || frame_rate_num > 1'000'000
		|| frame_rate_den == 0 || frame_rate_den > 1'000'000
		|| std::gcd(frame_rate_num, frame_rate_den) != 1) {
		throw sequence_error("The image-sequence pack metadata exceeds its bounded domain.");
	}
	std::ifstream pack{pack_path, std::ios::binary};
	if (!pack) throw sequence_error("The authenticated image-sequence pack cannot be opened.");
	std::array<std::uint8_t, header_bytes> header{};
	read_exact(pack, header.data(), header.size());
	if (!std::equal(magic.begin(), magic.end(), header.begin())
		|| u32(header.data() + 8) != header_bytes || u32(header.data() + 12) != index_bytes
		|| u32(header.data() + 16) != 1 || u32(header.data() + 20) != 0
		|| u64(header.data() + 24) != inventory_byte_length
		|| u32(header.data() + 36) != frame_rate_num || u32(header.data() + 40) != frame_rate_den
		|| u32(header.data() + 44) != 0 || u64(header.data() + 48) != header_bytes
		|| u64(header.data() + 64) != pack_byte_length
		|| binary_digest(header.data() + 72) != inventory_sha256
		|| !all_zero(header.data() + 104, 24)) {
		throw sequence_error("The image-sequence pack header fails its exact inventory/rate identity.");
	}
	const auto frame_count = u32(header.data() + 32);
	if (frame_count == 0 || frame_count > image_sequence_maximum_frames) {
		throw sequence_error("The image-sequence frame count exceeds its bounded domain.");
	}
	const auto index_end = checked_add(header_bytes, static_cast<std::uint64_t>(frame_count) * index_bytes);
	if (u64(header.data() + 56) != index_end || index_end > pack_byte_length) {
		throw sequence_error("The image-sequence pack index boundary is not canonical.");
	}
	inventory_reader inventory{inventory_path};
	admitted_image_sequence result{
		profile, pack_path, inventory_path, pack_sha256, inventory_sha256,
		pack_byte_length, inventory_byte_length, frame_rate_num, frame_rate_den, {},
	};
	result.frames.reserve(frame_count);
	std::uint64_t expected_offset = index_end;
	std::uint32_t first_frame{};
	for (std::uint32_t index = 0; index < frame_count; ++index) {
		std::array<std::uint8_t, index_bytes> entry_bytes{};
		read_exact(pack, entry_bytes.data(), entry_bytes.size());
		const auto external = inventory.next(index);
		const auto frame_number = u32(entry_bytes.data());
		const auto offset = u64(entry_bytes.data() + 8);
		const auto length = u64(entry_bytes.data() + 16);
		const auto digest = binary_digest(entry_bytes.data() + 24);
		if ((index == 0 ? false : frame_number != first_frame + index)
			|| u32(entry_bytes.data() + 4) != 0 || !all_zero(entry_bytes.data() + 56, 8)
			|| frame_number != external.frame_number || length != external.byte_length
			|| digest != external.sha256 || offset != expected_offset
			|| length == 0 || length > image_sequence_maximum_frame_bytes
			|| !extension_matches(external.file_name, profile)) {
			throw sequence_error("A source-pack frame index disagrees with its canonical inventory.");
		}
		if (index == 0) first_frame = frame_number;
		expected_offset = checked_add(expected_offset, length);
		result.frames.push_back({frame_number, offset, length, digest});
	}
	inventory.finish();
	if (expected_offset != pack_byte_length) {
		throw sequence_error("The image-sequence frame schedule does not reach the exact pack length.");
	}
	if (!sha256_file_ranges_match(pack_path, result.frames.size(), [&](const std::size_t index) {
		const auto& frame = result.frames[index];
		return sha256_range_identity{frame.offset, frame.byte_length, frame.sha256};
	})) {
		throw sequence_error("An image-sequence frame payload fails its inventory SHA-256 identity.");
	}
	return result;
}

} // namespace framescaper::media
