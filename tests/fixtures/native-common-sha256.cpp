/* SPDX-License-Identifier: AGPL-3.0-only */

#include "../../native/common/sha256.hpp"
#include "../../native/framescaper-media-host/src/sha256.hpp"
#include "../../native/framescaper-openfx-host/src/sha256.hpp"
#include "../../native/soundscaper-professional-host/src/delivery_fs_sha256.hpp"

#include <cstddef>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <iostream>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

void require(const bool condition, const std::string_view message) {
	if (!condition) throw std::runtime_error(std::string(message));
}

template<typename Digest>
void update(Digest& digest, const std::string_view value) {
	digest.update(std::as_bytes(std::span(value.data(), value.size())));
}

std::string core_digest(const std::string_view value, const std::size_t split) {
	scape::native_common::sha256 digest;
	update(digest, value.substr(0, split));
	update(digest, value.substr(split));
	return digest.finish_hex();
}

void verify_core_vectors() {
	require(core_digest("", 0)
		== "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		"empty SHA-256 vector drifted");
	require(core_digest("abc", 1)
		== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		"chunked abc SHA-256 vector drifted");
	constexpr std::string_view multi_block =
		"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
	require(core_digest(multi_block, 55)
		== "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
		"multi-block SHA-256 vector drifted");

	scape::native_common::sha256 finalized;
	update(finalized, "abc");
	(void)finalized.finish_hex();
	try {
		update(finalized, "again");
		throw std::runtime_error("finalized SHA-256 update was accepted");
	} catch (const std::logic_error& error) {
		require(std::string_view(error.what()) == "SHA-256 was already finalized.",
			"finalized SHA-256 error wording drifted");
	}
}

void verify_delivery_adapter() {
	soundscaper::delivery_fs::sha256 digest;
	update(digest, "a");
	update(digest, "bc");
	require(digest.finish_hex()
		== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		"delivery SHA-256 adapter drifted");
	try {
		(void)digest.finish_hex();
		throw std::runtime_error("delivery SHA-256 finalized twice");
	} catch (const std::logic_error& error) {
		require(std::string_view(error.what()) == "SHA-256 was already finalized.",
			"delivery SHA-256 error wording drifted");
	}
}

void verify_media_adapter(
	const std::filesystem::path& path,
	const std::string& file_sha256,
	const std::string& first_range_sha256,
	const std::string& second_range_sha256
) {
	using framescaper::media::sha256_file;
	using framescaper::media::sha256_file_range;
	using framescaper::media::sha256_file_ranges_match;
	using framescaper::media::sha256_range_identity;
	require(sha256_file(path) == file_sha256, "media whole-file SHA-256 drifted");
	require(sha256_file_range(path, 0, 7) == first_range_sha256,
		"media first range SHA-256 drifted");
	require(sha256_file_range(path, 11, 13) == second_range_sha256,
		"media second range SHA-256 drifted");
	const sha256_range_identity ranges[]{
		{.offset = 0, .byte_length = 7, .sha256 = first_range_sha256},
		{.offset = 11, .byte_length = 13, .sha256 = second_range_sha256},
	};
	require(sha256_file_ranges_match(path, 2, [&](const std::size_t index) {
		return ranges[index];
	}), "media range-set authentication drifted");
	auto mismatched = ranges[1];
	mismatched.sha256.assign(64, '0');
	require(!sha256_file_ranges_match(path, 2, [&](const std::size_t index) {
		return index == 0 ? ranges[0] : mismatched;
	}), "media range-set mismatch was accepted");
	try {
		(void)sha256_file_range(path, 30, 64);
		throw std::runtime_error("truncated media range was accepted");
	} catch (const std::runtime_error& error) {
		require(std::string_view(error.what()) == "The authenticated media range is truncated.",
			"media range error wording drifted");
	}
	try {
		(void)framescaper::media::sha256_bytes(nullptr, 1);
		throw std::runtime_error("null media SHA-256 bytes were accepted");
	} catch (const std::invalid_argument& error) {
		require(std::string_view(error.what()) == "SHA-256 bytes are null.",
			"media byte error wording drifted");
	}
}

void verify_openfx_adapter(const std::filesystem::path& path, const std::string& expected) {
	require(framescaper::openfx::sha256_file(path) == expected,
		"OpenFX whole-file SHA-256 drifted");
	try {
		(void)framescaper::openfx::sha256_file(path.string() + ".missing");
		throw std::runtime_error("missing OpenFX binary was accepted");
	} catch (const std::runtime_error& error) {
		require(std::string_view(error.what())
			== "The authenticated OpenFX binary cannot be opened.",
			"OpenFX file error wording drifted");
	}
}

} // namespace

int main(const int argc, const char* argv[]) {
	try {
		if (argc != 5) throw std::invalid_argument("expected file and three digests");
		verify_core_vectors();
		verify_delivery_adapter();
		verify_media_adapter(argv[1], argv[2], argv[3], argv[4]);
		verify_openfx_adapter(argv[1], argv[2]);
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
