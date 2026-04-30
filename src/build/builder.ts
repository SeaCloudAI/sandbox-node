import type { BuildRequest, BuildStep, RegistryConfig } from "./types.js";

export interface CopyStepOptions {
  force?: boolean;
}

export interface CommandStepOptions {
  force?: boolean;
}

export class TemplateBuildBuilder {
  private readonly request: BuildRequest = { steps: [] };

  fromImage(image: string): this {
    this.request.fromImage = image;
    return this;
  }

  fromTemplate(template: string): this {
    this.request.fromTemplate = template;
    return this;
  }

  fromImageRegistry(config: RegistryConfig): this {
    this.request.fromImageRegistry = config;
    return this;
  }

  force(enabled = true): this {
    this.request.force = enabled;
    return this;
  }

  copy(src: string, dest: string, filesHash: string, options: CopyStepOptions = {}): this {
    return this.pushStep({
      type: "COPY",
      args: [src, dest],
      filesHash,
      force: options.force,
    });
  }

  run(command: string, options: CommandStepOptions = {}): this {
    return this.pushStep({
      type: "RUN",
      args: [command],
      force: options.force,
    });
  }

  env(name: string, value: string): this;
  env(values: Record<string, string>): this;
  env(nameOrValues: string | Record<string, string>, value?: string): this {
    const args: string[] = [];
    if (typeof nameOrValues === "string") {
      args.push(nameOrValues, value ?? "");
    } else {
      for (const [key, envValue] of Object.entries(nameOrValues)) {
        args.push(key, envValue);
      }
    }
    return this.pushStep({ type: "ENV", args });
  }

  workdir(path: string, options: CommandStepOptions = {}): this {
    return this.pushStep({
      type: "WORKDIR",
      args: [path],
      force: options.force,
    });
  }

  user(user: string, options: CommandStepOptions = {}): this {
    return this.pushStep({
      type: "USER",
      args: [user],
      force: options.force,
    });
  }

  startCmd(command: string): this {
    this.request.startCmd = command;
    return this;
  }

  readyCmd(command: string): this {
    this.request.readyCmd = command;
    return this;
  }

  filesHash(filesHash: string): this {
    this.request.filesHash = filesHash;
    return this;
  }

  toRequest(): BuildRequest {
    return {
      ...this.request,
      steps: this.request.steps ? this.request.steps.map((step) => ({ ...step, args: step.args ? [...step.args] : step.args })) : undefined,
      fromImageRegistry: this.request.fromImageRegistry ? { ...this.request.fromImageRegistry } : undefined,
    };
  }

  private pushStep(step: BuildStep): this {
    if (!this.request.steps) {
      this.request.steps = [];
    }
    this.request.steps.push(step);
    return this;
  }
}

export function templateBuild(): TemplateBuildBuilder {
  return new TemplateBuildBuilder();
}
