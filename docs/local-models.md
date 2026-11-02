# Local models included in setup

2Many uses local Ollama models for translation and reply drafting, image text search, and autocorrect. The setup command downloads the configured models; the Git repository does not contain model weights. The optional OpenRouter chat assistant remains separate and uses a cloud provider.

## Guided install

1. Clone the public repository into a new directory.
2. Install and open [Ollama](https://ollama.com/download) on the computer hosting the workspace. On a headless host, run `ollama serve` bound to loopback. Do not expose port 11434 publicly. Follow the official installer for your OS; the repository does not execute a remote installer or elevate permissions for you.
3. Run `npm run setup`. This installs the repository dependencies and asks before downloading missing local models. You can decline and continue setting up the inbox without them. `npm install` by itself never downloads model weights.
4. Follow the README for the new local database, encryption key, web app, and sync worker. If you changed model settings in `.env`, run model setup again.
5. Run `npm run models:check` to verify the model files. Open a chat and choose Translate to use translation. Image text becomes searchable after OCR indexing finishes.

Already have the repository dependencies? Run:

```sh
npm run setup:models -- --dry-run  # Show the plan without contacting Ollama
npm run setup:models              # Confirm and download missing models
npm run models:check              # Verify files; no downloads or inference
```

For a coding assistant or noninteractive terminal, use `npm run setup:models -- --yes` **only after the person installing has reviewed and approved the downloads**. `--skip` explicitly defers models. The installer is safe to rerun: it skips installed models, downloads missing models one at a time, and verifies the final list. It never deletes model files, changes `.env`, reads chats, or starts an inference job.

## Default model plan

| Feature | Model | Environment setting |
| --- | --- | --- |
| Translation and reply drafting | `translategemma:4b` | `OLLAMA_TRANSLATION_MODEL` |
| Image text search | `glm-ocr:latest` | `OLLAMA_OCR_MODEL` |
| Autocorrect | `qwen3.5:4b` | `OLLAMA_AUTOCORRECT_MODEL` |
| Photo translation OCR | `qwen3.5:4b` | `OLLAMA_PHOTO_OCR_MODEL` |

An explicit `OLLAMA_REPLY_MODEL` is installed too if it differs. Shell environment settings take priority over `.env`. Custom models must be local Ollama names, not URLs or cloud variants. A model marked as cloud backed in Ollama does not satisfy the local check. The script does not validate whether a custom model supports the feature; you are responsible for compatible overrides.

The default files need several GB each; leave additional space for temporary downloads, chat attachments, and the database. Sizes and tags can change. Review the current download sizes, hardware requirements, and licenses at [TranslateGemma](https://ollama.com/library/translategemma:4b), [GLM OCR](https://ollama.com/library/glm-ocr), and [Qwen](https://ollama.com/library/qwen3.5:4b) before installing. A download succeeding does not prove inference fits in RAM. Start with a tiny synthetic test, not a full history OCR backfill.

Ollama stores weights outside Git in its own model storage. Downloads go through Ollama's model registry. After installation, translation and OCR run on the workspace host; they are not redirected to a cloud model if local setup fails. Keep Ollama running while using these features. OCR's conservative pacing and unload settings remain unchanged.

## Recovery

### Translate a photo privately

Open a downloaded photo's message menu and choose **Translate photo to English locally**. The inline panel first reads the image with local Qwen vision, then translates the recognized text with local TranslateGemma. Expand **Original text from photo** to compare, or copy the translation. Your photo, caption and outgoing messages are unchanged. This also makes the recognized text searchable in this workspace.

PNG, JPEG and WebP photos up to the configured `OCR_MAX_MB` (20 MB by default) are supported. Use **Recover** first for a missing attachment. Remote image URLs are not fetched by OCR. Blurry text can be misread; verify important details against the photo. For dense documents or a text-limit warning, crop into smaller sections.

Photo OCR and translation require downloaded models on the workspace host. There is no cloud fallback: remote Ollama addresses, HTTP redirects and cloud-backed models are rejected before inference. This is separate from the optional OpenRouter chat assistant. The photo action is available only through the local workspace, not public or guest links.

### Troubleshooting

- **Cannot check local Ollama:** install or update Ollama, open it, and confirm `OLLAMA_URL` is the local origin (normally `http://127.0.0.1:11434`). This installer rejects remote hosts and redirects.
- **Interrupted, no space, or network error:** make room or restore connectivity, then rerun model setup. Existing models are retained; Ollama manages reusable download layers. No need to reset the database or reconnect accounts.
- **Model not found or unsupported:** check the configured model name and update Ollama. The script stops with an error and does not claim success.
- **Too slow or out of memory during inference:** defer models or choose a compatible smaller local model and update its `.env` setting. Restart the web app and sync worker after changing settings. The installer never launches models to benchmark your machine.
- **Server installation:** models must be installed on the server running the workspace, not just your laptop. Browser based account login still has its own desktop requirements; installing models does not solve those.

No model downloads run inside onboarding or from the public website. The website's Get started modal copies an installation prompt for Codex, Cursor, or Claude Code. It does not control those applications or bypass their confirmations.
