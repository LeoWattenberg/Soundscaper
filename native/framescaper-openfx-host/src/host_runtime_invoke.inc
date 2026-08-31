/* SPDX-License-Identifier: AGPL-3.0-only */

InvocationResult HostRuntime::invoke(OfxPlugin& plugin, Context context, std::string_view action,
	Backend backend, bool cancelled,
	std::vector<InvocationFrame> inputs,
	const std::vector<HydratedParameterState>& parameters,
	std::function<bool()> cancellation_probe,
	RgbaFrameLayout output_layout,
	bool exact_frames,
	OfxTime render_time,
	std::optional<double> host_standard_parameter_value) {
	if (!member_of(action, kActions)) throw std::invalid_argument("The OpenFX action is outside the closed host contract.");
	if (!std::isfinite(render_time) || render_time < 0) throw std::invalid_argument("The OpenFX render time is outside its exact frame domain.");
	if (std::find(impl_->supported_backends.begin(), impl_->supported_backends.end(), backend) == impl_->supported_backends.end()) {
		throw gpu_runtime_error{"unsupported-backend", "The requested GPU backend lacks exact platform support."};
	}
	if (backend != Backend::cpu && action != "render") {
		throw gpu_runtime_error{"unsupported-backend", "GPU execution is admitted only for an exact render action."};
	}
	InvocationResult result;
	result.requested_backend = kRenderBackends[static_cast<std::size_t>(backend)];
	result.backend = result.requested_backend;
	result.suites_dispatched = impl_->state.suites_ready();
	if (cancelled || action == "abort") { result.cancellation_observed = true; return result; }
	impl_->state.reset(false, std::move(cancellation_probe)); impl_->state.effect_record.time = render_time; plugin.setHost(host());
	auto& state = impl_->state; auto* target = &state.effect_record;
	PropertySet context_args; context_args.owner = &state; prop_set_string(handle(context_args), kOfxImageEffectPropContext, 0, official_context(context));
	const bool loaded = accepted_status(call(plugin, kOfxActionLoad, nullptr));
	const bool described = loaded && accepted_status(call(plugin, kOfxActionDescribe, target));
	const bool in_context = described && state.descriptor_valid(context)
		&& accepted_status(call(plugin, kOfxImageEffectActionDescribeInContext, target, &context_args));
	const auto declared_backends = in_context ? state.declared_render_backends() : std::nullopt;
	if (backend != Backend::cpu && (!declared_backends.has_value()
		|| std::find(declared_backends->begin(), declared_backends->end(), result.backend) == declared_backends->end())) {
		if (loaded) call(plugin, kOfxActionUnload, nullptr);
		throw gpu_runtime_error{"unsupported-backend", "The plug-in did not declare the supported GPU backend."};
	}
	bool frames_bound = in_context;
	if (frames_bound) {
		std::set<std::string> names;
		const auto output = state.effect_record.clips.find("Output");
		if (!valid_rgba_frame_layout(output_layout) || output == state.effect_record.clips.end()) frames_bound = false;
		else try { output->second->image.frame = {output_layout, std::vector<unsigned char>(output_layout.byte_length)}; }
		catch (...) { frames_bound = false; }
		for (auto& input : inputs) {
			const auto found = state.effect_record.clips.find(input.name);
			if (input.name == "Output" || !names.insert(input.name).second || found == state.effect_record.clips.end()
				|| !valid_rgba_frame_layout(input.frame.layout) || input.frame.rgba.size() != input.frame.layout.byte_length) {
				frames_bound = false; break;
			}
			if (context == Context::retimer && input.name == "Source") {
				if (!host_standard_parameter_value.has_value()) { frames_bound = false; break; }
				found->second->exact_image_time = *host_standard_parameter_value;
				result.retimer_source_time_enforced = true;
			}
			found->second->image.frame = std::move(input.frame);
		}
		if (exact_frames && state.effect_record.clips.size() != inputs.size() + 1U) frames_bound = false;
		for (auto& [name, clip] : state.effect_record.clips) {
			if (context == Context::retimer && name == "Source"
				&& host_standard_parameter_value.has_value()) {
				clip->exact_image_time = *host_standard_parameter_value;
			}
			auto& image = clip->image;
			if (!exact_frames && image.frame.rgba.size() != image.frame.layout.byte_length) image.frame.rgba.assign(image.frame.layout.byte_length, 0);
			prop_set_pointer(handle(image.properties), kOfxImagePropData, 0, image.frame.rgba.data());
			prop_set_int(handle(image.properties), kOfxImagePropRowBytes, 0, static_cast<int>(image.frame.layout.row_bytes));
			const int bounds[]{0, 0, static_cast<int>(image.frame.layout.width), static_cast<int>(image.frame.layout.height)};
			prop_set_int_n(handle(image.properties), kOfxImagePropBounds, 4, bounds);
		}
	}
	PropertySet render_args; render_args.owner = &state;
	prop_set_double(handle(render_args), kOfxPropTime, 0, render_time);
	const double scale[]{1, 1}; prop_set_double_n(handle(render_args), kOfxImageEffectPropRenderScale, 2, scale);
	const int window[]{0, 0, static_cast<int>(output_layout.width), static_cast<int>(output_layout.height)};
	prop_set_int_n(handle(render_args), kOfxImageEffectPropRenderWindow, 4, window);
	prop_set_int(handle(render_args), kOfxImageEffectPropOpenGLEnabled, 0, backend == Backend::opengl ? 1 : 0);
	prop_set_int(handle(render_args), kOfxImageEffectPropOpenCLEnabled, 0, backend == Backend::opencl ? 1 : 0);
	prop_set_int(handle(render_args), kOfxImageEffectPropCudaEnabled, 0, backend == Backend::cuda ? 1 : 0);
	prop_set_int(handle(render_args), kOfxImageEffectPropMetalEnabled, 0, backend == Backend::metal ? 1 : 0);
	const bool parameters_bound = frames_bound && bind_host_standard_parameter(
		state.effect_record.parameters, context, host_standard_parameter_value, result
	) && hydrate_parameter_state(state.effect_record.parameters, parameters, result.hydrated_parameter_count, result.hydrated_keyframe_count);
	const bool created = parameters_bound && !observe_cancellation(target)
		&& accepted_status(call(plugin, kOfxActionCreateInstance, target));
	if (created) static_cast<void>(render_overlay_interact_v2(state, result));
	std::unique_ptr<GpuRenderSession> gpu;
	bool attached = false;
	try {
		if (created && backend != Backend::cpu) {
			std::vector<GpuFrameBinding> bindings; bindings.reserve(state.effect_record.clips.size());
			for (auto& [name, clip] : state.effect_record.clips) bindings.push_back({name, &clip->image.frame, name == "Output"});
			gpu = GpuRenderSession::create(backend, bindings); state.gpu_session = gpu.get(); gpu->make_active();
			for (auto& [name, clip] : state.effect_record.clips) {
				static_cast<void>(name); auto& image = clip->image;
				prop_set_pointer(handle(image.properties), kOfxImagePropData, 0, gpu->image_data(image.frame));
				if (backend == Backend::opencl) prop_set_pointer(handle(image.properties), kOfxImageEffectPropOpenCLImage, 0, gpu->opencl_image(image.frame));
			}
			if (backend == Backend::opencl) prop_set_pointer(handle(render_args), kOfxImageEffectPropOpenCLCommandQueue, 0, gpu->command_queue());
			if (backend == Backend::cuda) {
				const auto stream = state.effect_record.properties.values.find(kOfxImageEffectPropCudaStreamSupported);
				const auto* supported = stream == state.effect_record.properties.values.end() || stream->second.size() != 1
					? nullptr : std::get_if<std::string>(&stream->second.front());
				if (supported != nullptr && *supported == "true") prop_set_pointer(handle(render_args), kOfxImageEffectPropCudaStream, 0, gpu->command_queue());
			}
			if (backend == Backend::metal) prop_set_pointer(handle(render_args), kOfxImageEffectPropMetalCommandQueue, 0, gpu->command_queue());
			if (backend == Backend::opengl) {
				attached = accepted_status(call(plugin, kOfxActionOpenGLContextAttached, target));
				if (!attached) throw gpu_runtime_error{"gpu-execution-failed", "The OpenGL context-attached action failed."};
			}
			result.gpu_context_setup = true;
		}
		OfxStatus status = kOfxStatFailed;
		if (created) if (const auto* mapped = official_action(action); mapped != nullptr) {
			status = call(plugin, mapped, target, action == "render" ? &render_args : &context_args);
		}
		const bool action_cancelled = !accepted_status(status) && observe_cancellation(target);
		if (backend != Backend::cpu && !action_cancelled
			&& (status == kOfxStatGPUOutOfMemory || status == kOfxStatGPURenderFailed || !accepted_status(status))) {
			throw gpu_runtime_error{"gpu-execution-failed", "The supported GPU render action failed."};
		}
		if ((!accepted_status(status) && !action_cancelled)
			|| (action == "render" && !state.effect_record.clips.contains("Output"))) {
			throw std::runtime_error("The OpenFX plug-in failed the admitted action lifecycle.");
		}
		if (gpu != nullptr) gpu->complete();
	} catch (...) {
		if (attached) static_cast<void>(call(plugin, kOfxActionOpenGLContextDetached, target));
		if (gpu != nullptr) { gpu->clear_active(); gpu->release(); result.gpu_context_released = gpu->released(); }
		state.gpu_session = nullptr; state.textures.clear();
		if (created) call(plugin, kOfxActionDestroyInstance, target);
		if (loaded) call(plugin, kOfxActionUnload, nullptr);
		throw;
	}
	if (attached && !accepted_status(call(plugin, kOfxActionOpenGLContextDetached, target))) {
		if (gpu != nullptr) { gpu->clear_active(); gpu->release(); }
		state.gpu_session = nullptr; state.textures.clear();
		if (created) call(plugin, kOfxActionDestroyInstance, target);
		if (loaded) call(plugin, kOfxActionUnload, nullptr);
		throw gpu_runtime_error{"gpu-execution-failed", "The OpenGL context-detached action failed."};
	}
	if (gpu != nullptr) { gpu->clear_active(); gpu->release(); result.gpu_context_released = gpu->released(); }
	state.gpu_session = nullptr; state.textures.clear();
	const bool cancellation_observed = observe_cancellation(target);
	if (created) call(plugin, kOfxActionDestroyInstance, target);
	if (loaded) call(plugin, kOfxActionUnload, nullptr);
	if (cancellation_observed) { result.cancellation_observed = true; return result; }
	if (!created) throw std::runtime_error("The OpenFX plug-in failed the admitted action lifecycle.");
	if (action == "render") result.output_frame = std::move(state.effect_record.clips.at("Output")->image.frame);
	result.cpu_rendered = action == "render" && backend == Backend::cpu;
	return result;
}
