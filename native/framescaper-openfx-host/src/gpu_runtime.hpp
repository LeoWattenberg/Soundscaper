/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "isolation_contract.hpp"
#include "openfx_abi.hpp"
#include "rgba_frame.hpp"

#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace framescaper::openfx {

class gpu_runtime_error final : public std::runtime_error {
public:
	gpu_runtime_error(std::string code, std::string message)
		: std::runtime_error(std::move(message)), code_{std::move(code)} {}
	const std::string& code() const { return code_; }

private:
	std::string code_;
};

struct GpuFrameBinding final {
	std::string name;
	RgbaFrame* frame{};
	bool output{};
};

class GpuRenderSession {
public:
	virtual ~GpuRenderSession() = default;
	GpuRenderSession(const GpuRenderSession&) = delete;
	GpuRenderSession& operator=(const GpuRenderSession&) = delete;

	[[nodiscard]] static std::unique_ptr<GpuRenderSession> create(
		Backend backend,
		const std::vector<GpuFrameBinding>& frames
	);
	[[nodiscard]] virtual void* image_data(RgbaFrame& frame) = 0;
	[[nodiscard]] virtual void* opencl_image(RgbaFrame&) { return nullptr; }
	[[nodiscard]] virtual void* command_queue() const = 0;
	[[nodiscard]] virtual std::uint32_t open_gl_texture(RgbaFrame&, bool) {
		throw gpu_runtime_error{"gpu-execution-failed", "The OpenGL texture provider is unavailable."};
	}
	[[nodiscard]] virtual std::uint32_t open_gl_target() const { return 0; }
	virtual void free_open_gl_texture(std::uint32_t, bool) {}
	virtual void flush() = 0;
	virtual void complete() = 0;
	virtual void release() noexcept = 0;
	[[nodiscard]] virtual bool released() const noexcept = 0;
	[[nodiscard]] virtual Backend backend() const noexcept = 0;

	void make_active() noexcept;
	void clear_active() noexcept;

protected:
	GpuRenderSession() = default;
};

[[nodiscard]] GpuRenderSession* active_gpu_session() noexcept;
OfxStatus compile_active_opencl_program(const char* source, int optional, void* result) noexcept;

} // namespace framescaper::openfx
