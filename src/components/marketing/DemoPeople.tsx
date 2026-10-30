import { BrandMark } from "./BrandMark";
import type { Platform } from "@/lib/platforms";

// Deliberately fictional identities. No profile or account requests are made.
export const people = [
  { name: "Maya Chen", initials: "MC", platform: "telegram", preview: "The new direction looks great. Let’s do it.", time: "10:42", note: "Brand direction", body: "The new direction looks great. Let’s do it. Can you send the next steps?", email: "maya@sample.example", company: "Studio Common" },
  { name: "Diego Alvarez", initials: "DA", platform: "x", preview: "Did you get a chance to look at the brief?", time: "10:38", note: "Website project", body: "Did you get a chance to look at the brief? I’d love to hear what you think.", email: "diego@sample.example", company: "Forma Studio" },
  { name: "Priya Nair", initials: "PN", platform: "whatsapp", preview: "Perfect. I’ll introduce you to the team.", time: "10:24", note: "Introduction", body: "Perfect. I’ll introduce you to the team. Should we find a time next week?", email: "priya@sample.example", company: "Field Notes" },
  { name: "Lukas Vogt", initials: "LV", platform: "discord", preview: "Sent the references in our group.", time: "09:56", note: "References", body: "Sent the references in our group. The second one is closest to what we have in mind.", email: "lukas@sample.example", company: "North Practice" },
] as const;

export function DemoAvatar({ index, small = false, badge = true }: { index: number; small?: boolean; badge?: boolean }) {
  const person = people[index];
  const hair = ["M10 18C8 2 32 2 30 18l-5-7-15 7Z", "M10 17c-5-2-4-8 0-9-1-5 7-7 10-3 5-4 13 1 10 5 5 3 3 9-1 9l-2-8-14 1Z", "M8 32V15C8-2 32-2 32 15v17l-7-5 2-16-14 3 2 13Z", "M10 16C8 6 17 3 23 5c7 0 9 5 7 12l-5-6-15 5Z"];
  return <span className={`relative inline-flex shrink-0 ${small ? "h-8 w-8" : "h-10 w-10"}`}>
    <span className={`flex h-full w-full overflow-hidden rounded-full ${index % 2 ? "bg-slate-200 text-slate-700 dark:bg-neutral-700 dark:text-neutral-300" : "bg-accent/15 text-accent"}`}>
      <svg viewBox="0 0 40 40" aria-hidden="true" className="h-full w-full"><path d="M2 40c0-16 36-16 36 0" fill="currentColor" opacity=".7" /><path d={hair[index]} fill="currentColor" /><ellipse cx="20" cy="19" rx="8" ry="10" fill="white" opacity=".8" /><path d={hair[index]} fill="currentColor" /><path d="M17 24q3 2 6 0" fill="none" stroke="currentColor" strokeLinecap="round" /><circle cx="17" cy="19" r="1" fill="currentColor" /><circle cx="23" cy="19" r="1" fill="currentColor" />{index === 3 && <path d="M12 17h7v5h-7zm9 0h7v5h-7zm-2 2h2" fill="none" stroke="currentColor" />}</svg>
    </span>
    {badge && <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-white dark:ring-[#1F1F1F]"><BrandMark platform={person.platform as Platform} className="h-4 w-4 !rounded-full" /></span>}
  </span>;
}
