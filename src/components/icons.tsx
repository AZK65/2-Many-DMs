type IconProps = { className?: string };
const D = "h-4 w-4";

export function PencilIcon(p: IconProps) {
  return <Svg {...p}><path d="m16 3 5 5L8 21H3v-5L16 3Z" /><path d="m13 6 5 5" /></Svg>;
}

export function SettingsIcon(p: IconProps) {
  return <Svg {...p}><path d="m9 3 1-1h4l1 1 .4 2 1.8 1 2-.6 1.4 2.4-.8 1.6v2.2l.8 1.6-1.4 2.4-2-.6-1.8 1L15 19l-1 1h-4l-1-1-.4-2-1.8-1-2 .6-1.4-2.4.8-1.6v-2.2L3.4 8.8l1.4-2.4 2 .6 1.8-1L9 3Z" /><circle cx="12" cy="11" r="3" /></Svg>;
}

export function MicrophoneIcon(p: IconProps) {
  return <Svg {...p}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></Svg>;
}

function Svg({ className = D, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}
export function SidebarIcon(p: IconProps) {
  return <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 3v18" /></Svg>;
}
export function ImageIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </Svg>
  );
}
export function FunnelIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </Svg>
  );
}
export function SortIcon(p: IconProps & { direction?: "asc" | "desc" | "both" }) {
  const { direction = "both", ...iconProps } = p;
  return (
    <Svg {...iconProps}>
      <path d="M12 5v14" />
      {direction !== "desc" && <path d="m8 9 4-4 4 4" />}
      {direction !== "asc" && <path d="m8 15 4 4 4-4" />}
    </Svg>
  );
}
export function EyeOffIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </Svg>
  );
}
export function LinkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" x2="16" y1="12" y2="12" />
    </Svg>
  );
}
export function ExternalLinkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 3h6v6" />
      <path d="m10 14 11-11" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Svg>
  );
}
export function CopyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Svg>
  );
}
export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Svg>
  );
}
export function SendIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22 11 13 2 9z" />
    </Svg>
  );
}
export function MoreIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </Svg>
  );
}
export function FolderIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </Svg>
  );
}
export function ArchiveIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 8h18v12H3z" />
      <path d="M2 4h20v4H2z" />
      <path d="M9 12h6" />
    </Svg>
  );
}
export function BellIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </Svg>
  );
}
export function AtSignIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </Svg>
  );
}
export function PinIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z" />
    </Svg>
  );
}
export function EyeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}
export function LockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14v3" />
    </Svg>
  );
}
export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}
export function SunIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </Svg>
  );
}
export function MoonIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </Svg>
  );
}
export function InfoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </Svg>
  );
}
export function CloseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}
export function MailIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </Svg>
  );
}
export function DownloadIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Svg>
  );
}
export function SheetIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 2h9l4 4v16H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
      <path d="M14 2v5h5" />
      <path d="M8 11h8M8 15h8M11 11v8M8 19h8" />
    </Svg>
  );
}
export function PhoneIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z" />
    </Svg>
  );
}
export function BuildingIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect width="16" height="20" x="4" y="2" rx="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
    </Svg>
  );
}
export function UserIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Svg>
  );
}
export function ZapIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </Svg>
  );
}
export function SparklesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m12 3-1 3.2a4 4 0 0 1-2.6 2.6L5 10l3.4 1.2a4 4 0 0 1 2.6 2.6l1 3.2 1-3.2a4 4 0 0 1 2.6-2.6L19 10l-3.4-1.2A4 4 0 0 1 13 6.2Z" />
      <path d="m5 3-.4 1.2a2 2 0 0 1-1.2 1.2L2 6l1.4.6a2 2 0 0 1 1.2 1.2L5 9l.4-1.2a2 2 0 0 1 1.2-1.2L8 6l-1.4-.6a2 2 0 0 1-1.2-1.2Z" />
      <path d="m19 16-.5 1.5A2.3 2.3 0 0 1 17 19l-1.5.5 1.5.5a2.3 2.3 0 0 1 1.5 1.5L19 23l.5-1.5A2.3 2.3 0 0 1 21 20l1.5-.5L21 19a2.3 2.3 0 0 1-1.5-1.5Z" />
    </Svg>
  );
}
export function ArrowLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  );
}
export function RefreshIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
    </Svg>
  );
}
export function TrashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Svg>
  );
}
export function ClockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}
export function CheckCircleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21.8 10A10 10 0 1 1 17 3.3" />
      <path d="m9 11 3 3L22 4" />
    </Svg>
  );
}
export function ReplyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 17l-5-5 5-5" />
      <path d="M4 12h11a5 5 0 0 1 5 5v2" />
    </Svg>
  );
}
export function SmileyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <path d="M9 9h.01M15 9h.01" />
    </Svg>
  );
}
export function PaperclipIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Svg>
  );
}
export function GlobeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2Z" />
    </Svg>
  );
}
