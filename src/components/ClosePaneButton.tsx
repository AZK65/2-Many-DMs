import { CloseIcon } from "./icons";

export function ClosePaneButton({
  onClick,
  className = "",
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close second pane"
      title="Close second pane — keep the pinned chat open"
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white ${className}`}
    >
      <CloseIcon className="h-4 w-4" />
    </button>
  );
}
