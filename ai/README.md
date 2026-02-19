# Embedded AI assets

Place your bundled local AI runtime and model in this folder before building installer:

- `llama-server.exe` (or set `EMBEDDED_RUNTIME_FILE`)
- `planner-model.gguf` (or set `EMBEDDED_MODEL_FILE`)

The installer includes this `ai/` folder as app resources.
At runtime the app copies these files to user data and starts the local runtime automatically.

## Configurable environment variables
- `EMBEDDED_AI_ENABLED` (default `true`) — disable embedded runtime when set to `false`
- `EMBEDDED_AI_HOST` (default `127.0.0.1`)
- `EMBEDDED_AI_PORT` (default `11435`)
- `EMBEDDED_AI_STARTUP_TIMEOUT_MS` (default `15000`)
- `EMBEDDED_RUNTIME_FILE` (default `llama-server.exe`)
- `EMBEDDED_MODEL_FILE` (default `planner-model.gguf`)

## Notes
- Keep model licensing terms and attribution with your distribution.
- Large models produce large installers.
