/* SPDX-License-Identifier: AGPL-3.0-only */

#include "delivery_fs_platform.hpp"
#include "delivery_fs_protocol.hpp"
#include "delivery_fs_sha256.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <memory>
#include <optional>
#include <span>
#include <string>

#ifndef _WIN32
#include <csignal>
#endif

namespace soundscaper::delivery_fs {
namespace {

enum class session_state { waiting, writing, sealed, settled };

class protocol_session final {
public:
	int run() {
		for (;;) {
			auto incoming = read_frame();
			if (!incoming) {
				if (native_) native_->abort();
				return 0;
			}
			current_request_id_ = incoming->request_id;
			if (current_request_id_ <= previous_request_id_) {
				throw protocol_error("malformed-frame", "frame-order", false,
					"SDF1 request identifiers must increase monotonically.");
			}
			previous_request_id_ = current_request_id_;
			switch (incoming->operation) {
			case opcode::init: initialize(*incoming); break;
			case opcode::data: write_data(*incoming); break;
			case opcode::patch_prefix: patch_prefix(*incoming); break;
			case opcode::seal: seal(*incoming); break;
			case opcode::publish: publish(*incoming); return 0;
			case opcode::abort: abort(*incoming); return 0;
			default: throw protocol_error("invalid-state", "dispatch", false,
				"The SDF1 request opcode is invalid in a write session.");
			}
		}
	}

	std::uint32_t current_request_id() const noexcept { return current_request_id_; }
	void safe_abort() noexcept { if (native_) native_->abort(); }

private:
	void initialize(const frame& incoming) {
		if (state_ != session_state::waiting) invalid("init");
		request_ = parse_init(incoming);
		native_ = create_platform_session(*request_);
		state_ = session_state::writing;
		write_frame(opcode::ready, incoming.request_id,
			"{\"schemaVersion\":1,\"sessionId\":\"" + json_escape(request_->session_id)
			+ "\",\"rootIdentity\":" + root_identity_json(native_->root())
			+ ",\"fileIdentity\":" + file_identity_json(native_->file())
			+ ",\"stagingReference\":\"" + json_escape(native_->staging_reference())
			+ "\",\"maxChunkBytes\":" + std::to_string(request_->limits.maximum_chunk_bytes) + "}");
	}

	void write_data(const frame& incoming) {
		require_writing("write");
		if (data_closed_ || incoming.payload.empty()
			|| incoming.payload.size() > request_->limits.maximum_chunk_bytes
			|| incoming.payload.size() > request_->limits.maximum_bytes - total_bytes_) {
			throw protocol_error("write-limit-exceeded", "write", false,
				"The SDF1 data frame violates its negotiated sequential bounds.");
		}
		native_->write_at(total_bytes_, incoming.payload);
		total_bytes_ += incoming.payload.size();
		ack(incoming.request_id, incoming.payload.size());
	}

	void patch_prefix(const frame& incoming) {
		require_writing("patch-prefix");
		if (prefix_patched_ || request_->limits.final_prefix_bytes != 32
			|| incoming.payload.size() != 32 || total_bytes_ < 32) {
			throw protocol_error("invalid-prefix", "patch-prefix", false,
				"SDF1 permits one declared 32-byte prefix patch after the sequential stream.");
		}
		native_->write_at(0, incoming.payload);
		prefix_patched_ = true;
		data_closed_ = true;
		ack(incoming.request_id, incoming.payload.size());
	}

	void seal(const frame& incoming) {
		require_writing("seal");
		const auto requested = parse_seal(incoming);
		if ((request_->limits.final_prefix_bytes == 32 && !prefix_patched_)
			|| requested.byte_length != total_bytes_
			|| requested.byte_length > request_->limits.maximum_bytes) {
			throw protocol_error("sealed-length-mismatch", "seal", false,
				"The retained delivery file does not match its final declared length.");
		}
		native_->flush_file();
		sealed_sha256_ = authenticate_staged("seal");
		state_ = session_state::sealed;
		write_frame(opcode::sealed, incoming.request_id,
			"{\"schemaVersion\":1,\"byteLength\":" + std::to_string(total_bytes_)
			+ ",\"sha256\":\"" + sealed_sha256_ + "\",\"rootIdentity\":"
			+ root_identity_json(native_->root()) + ",\"fileIdentity\":"
			+ file_identity_json(native_->file()) + ",\"stagingReference\":\""
			+ json_escape(native_->staging_reference()) + "\"}");
	}

	std::string authenticate_staged(const char* phase) {
		if (native_->size() != total_bytes_) {
			throw protocol_error("sealed-length-mismatch", std::string(phase) + "-stat", false,
				"The retained delivery file changed size before authentication.");
		}
		sha256 digest;
		constexpr std::size_t authentication_buffer_bytes = 1024U * 1024U;
		auto buffer = std::make_unique<std::byte[]>(authentication_buffer_bytes);
		std::uint64_t offset = 0;
		while (offset < total_bytes_) {
			const auto requested_bytes = static_cast<std::size_t>(
				std::min<std::uint64_t>(authentication_buffer_bytes, total_bytes_ - offset));
			const auto requested = std::span(buffer.get(), requested_bytes);
			const auto count = native_->read_at(offset, requested);
			if (count == 0 || count > requested_bytes) {
				throw protocol_error("staging-read-failed", std::string(phase) + "-read", true,
					"The retained delivery file returned a short authenticated read.");
			}
			digest.update(requested.first(count));
			offset += count;
		}
		if (native_->size() != total_bytes_) {
			throw protocol_error("staging-identity-mismatch", std::string(phase) + "-stat", false,
				"The retained delivery file changed while it was hashed.");
		}
		return digest.finish_hex();
	}

	void publish(const frame& incoming) {
		if (state_ != session_state::sealed) invalid("publish");
		const auto authority = parse_publish(incoming);
		native_->flush_file();
		if (authenticate_staged("publish-authenticate") != sealed_sha256_) {
			throw protocol_error("staging-content-mismatch", "publish-authenticate", false,
				"The sealed delivery bytes changed before exclusive publication.");
		}
		const auto result = native_->publish();
		state_ = session_state::settled;
		write_frame(opcode::published, incoming.request_id,
			"{\"schemaVersion\":1,\"journalId\":\"" + json_escape(authority.journal_id)
			+ "\",\"byteLength\":" + std::to_string(total_bytes_) + ",\"sha256\":\""
			+ sealed_sha256_ + "\",\"rootIdentity\":" + root_identity_json(native_->root())
			+ ",\"fileIdentity\":" + file_identity_json(native_->file())
			+ ",\"finalIdentity\":" + file_identity_json(result.final_identity) + "}");
	}

	void abort(const frame& incoming) {
		if (state_ == session_state::waiting || state_ == session_state::settled) invalid("abort");
		require_empty_payload(incoming, "abort");
		native_->abort();
		state_ = session_state::settled;
		write_frame(opcode::aborted, incoming.request_id,
			"{\"schemaVersion\":1,\"status\":\"aborted\"}");
	}

	void ack(std::uint32_t request_id, std::size_t accepted) {
		write_frame(opcode::ack, request_id,
			"{\"acceptedBytes\":" + std::to_string(accepted)
			+ ",\"totalBytes\":" + std::to_string(total_bytes_) + "}");
	}

	void require_writing(const char* phase) const {
		if (state_ != session_state::writing || !native_ || !request_) invalid(phase);
	}

	[[noreturn]] static void invalid(const char* phase) {
		throw protocol_error("invalid-state", phase, false,
			"The SDF1 operation is invalid in the current session state.");
	}

	session_state state_ = session_state::waiting;
	std::optional<init_request> request_;
	std::unique_ptr<platform_session> native_;
	std::uint64_t total_bytes_ = 0;
	std::uint32_t previous_request_id_ = 0;
	std::uint32_t current_request_id_ = 0;
	std::string sealed_sha256_;
	bool prefix_patched_ = false;
	bool data_closed_ = false;
};

int run_recovery() {
	const auto incoming = read_frame();
	if (!incoming) throw protocol_error("unexpected-eof", "recover", false,
		"Recovery requires one SDF1 request.");
	const auto request = parse_recovery(*incoming);
	const auto result = recover_platform_session(request);
	std::string inspection = "null";
	if (result.identity) {
		inspection = "{\"byteLength\":" + std::to_string(result.byte_length)
			+ ",\"sha256\":\"" + json_escape(result.sha256) + "\",\"volumeIdentity\":\""
			+ json_escape(result.identity->volume_identity) + "\",\"fileIdentity\":\""
			+ json_escape(result.identity->file_identity_value) + "\"}";
	}
	write_frame(opcode::recovery, incoming->request_id,
		"{\"schemaVersion\":1,\"status\":\"" + json_escape(result.status)
		+ "\",\"inspection\":" + inspection + "}");
	return 0;
}

int run_final_inspection() {
	const auto incoming = read_frame();
	if (!incoming) throw protocol_error("unexpected-eof", "inspect-final", false,
		"Final inspection requires one SDF1 request.");
	const auto request = parse_final_inspection(*incoming);
	const auto result = inspect_platform_final(request);
	std::string inspection = "null";
	if (result.identity) {
		inspection = "{\"byteLength\":" + std::to_string(result.byte_length)
			+ ",\"sha256\":\"" + json_escape(result.sha256) + "\",\"volumeIdentity\":\""
			+ json_escape(result.identity->volume_identity) + "\",\"fileIdentity\":\""
			+ json_escape(result.identity->file_identity_value) + "\"}";
	}
	write_frame(opcode::final_inspection, incoming->request_id,
		"{\"schemaVersion\":1,\"status\":\"" + json_escape(result.status)
		+ "\",\"rootIdentity\":" + root_identity_json(request.expected_root_identity)
		+ ",\"inspection\":" + inspection + "}");
	return 0;
}

} // namespace
} // namespace soundscaper::delivery_fs

int main(int argc, char** argv) {
	using namespace soundscaper::delivery_fs;
#ifndef _WIN32
	std::signal(SIGPIPE, SIG_IGN);
#endif
	std::uint32_t request_id = 1;
	std::unique_ptr<protocol_session> session;
	try {
		configure_binary_standard_io();
		if (argc == 2 && std::string(argv[1]) == "--recover") return run_recovery();
		if (argc == 2 && std::string(argv[1]) == "--inspect-final") return run_final_inspection();
		if (argc != 1) throw protocol_error("invalid-invocation", "startup", false,
			"The delivery filesystem helper accepts only its closed private modes.");
		session = std::make_unique<protocol_session>();
		const auto result = session->run();
		return result;
	} catch (const protocol_error& error) {
		if (session) { request_id = session->current_request_id(); session->safe_abort(); }
		try { write_error(request_id, error); } catch (...) {}
		return 125;
	} catch (const std::exception& error) {
		if (session) { request_id = session->current_request_id(); session->safe_abort(); }
		try { write_error(request_id, protocol_error("internal-failure", "internal", false,
			error.what())); } catch (...) {}
		return 125;
	}
}
