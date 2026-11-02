export function LocalTranslationHelp() {
  return <details className="mt-6 rounded-xl bg-slate-100 p-4 text-left text-sm dark:bg-neutral-800">
    <summary className="cursor-pointer rounded font-medium focus-visible:outline-accent">Local models: setup or check</summary>
    <p className="mt-4 leading-relaxed text-slate-500 dark:text-neutral-400">Translation is separate from the chat assistant. It does not need an OpenRouter key. Install the local model on the computer running your workspace, not just the browser you use to open it.</p>
    <ol className="mt-4 list-inside list-decimal space-y-3 text-slate-600 dark:text-neutral-300">
      <li><a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-4">Install and open Ollama ↗</a> on that computer.</li>
      <li>In the repository folder, run the included installer:<code className="mt-2 block select-all break-all rounded-lg bg-white p-3 text-xs dark:bg-neutral-900">npm run setup:models</code><span className="mt-2 block text-xs leading-relaxed">It asks before downloading translation, OCR, and autocorrect models, and skips models already installed. If you ran guided setup, they may already be ready.</span></li>
      <li>Keep Ollama running. Open a chat, choose Translate, then select the conversation language. For a photo, open its message menu and choose Translate photo to English locally. Compare the original text and translation directly below the photo.</li>
    </ol>
    <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-neutral-400">Check installed files with <code>npm run models:check</code>. Downloads take several GB and speed depends on your hardware. Nothing downloads from this screen. You can defer models and use messaging without them. <a href="https://ollama.com/library/translategemma:4b" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Translation model details ↗</a></p>
  </details>;
}
