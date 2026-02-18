# Embedded AI assets

Place your bundled local AI runtime and model in this folder before building installer:

- `llama-server.exe` (or set `EMBEDDED_RUNTIME_FILE`)
- `planner-model.gguf` (or set `EMBEDDED_MODEL_FILE`)

The installer includes this `ai/` folder as app resources.
At runtime the app copies these files to user data and starts the local runtime automatically.

## Notes
- Keep model licensing terms and attribution with your distribution.
- Large models produce large installers.
