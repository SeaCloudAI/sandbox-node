import { SandboxCommandService } from "./cmd/service.js";
import type { CmdOptions } from "./cmd/types.js";
import type { Sandbox, SandboxDetail } from "./control/types.js";
import { ConfigurationError } from "./core/errors.js";

export type SandboxRuntimeTarget = Pick<Sandbox | SandboxDetail, "envdUrl" | "envdAccessToken">;

export class SandboxRuntime extends SandboxCommandService {
  constructor(options: CmdOptions) {
    super(options);
  }

  static fromSandbox(
    target: SandboxRuntimeTarget,
    options: Omit<CmdOptions, "baseUrl" | "accessToken"> = {},
  ): SandboxRuntime {
    const baseUrl = target.envdUrl?.trim() ?? "";
    if (!baseUrl) {
      throw new ConfigurationError("envdUrl is required");
    }

    return new SandboxRuntime({
      ...options,
      baseUrl,
      accessToken: target.envdAccessToken ?? "",
    });
  }
}
