# Changelog

All notable changes to this project will be documented in this file.

This project follows Semantic Versioning for public SDK APIs.

## [0.1.2] - 2026-04-24

### Changed

- Refined README and examples around the unified gateway flow and environment-based configuration.
- Added a full end-to-end workflow example covering template creation, sandbox startup, runtime execution, and cleanup.
- Reduced build request surface to the user-facing fields needed for production SDK usage.

## [0.1.1] - 2026-04-24

### Changed

- Added GitHub Actions npm publishing workflow.

## [0.1.0] - 2026-04-23

### Added

- Initial TypeScript/Node SDK for SeaCloudAI sandbox control-plane, build-plane, and runtime CMD APIs.
- Unified root client initialization with `new SandboxClient({ baseUrl, apiKey })`.
- Build namespace through `client.build`.
- Runtime helpers through `client.runtime(...)`, `client.runtimeFromSandbox(...)`, and bound sandbox objects.
- Typed API errors with retry classification.
- Configurable request timeout through `timeoutMs`.
- Examples, unit tests, and integration-test scaffolding.
