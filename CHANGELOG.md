# Changelog

All notable changes to this project will be documented in this file.

This project follows Semantic Versioning for public SDK APIs.

## [0.1.0] - 2026-04-23

### Added

- Initial TypeScript/Node SDK for SeaCloudAI sandbox control-plane, build-plane, and runtime CMD APIs.
- Unified root client initialization with `new SandboxClient({ baseUrl, apiKey })`.
- Build namespace through `client.build`.
- Runtime helpers through `client.runtime(...)`, `client.runtimeFromSandbox(...)`, and bound sandbox objects.
- Typed API errors with retry classification.
- Configurable request timeout through `timeoutMs`.
- Examples, unit tests, and integration-test scaffolding.
