export interface Stage {
  id: string;
  name: string;
  color: string;
}

// The CRM deal pipeline. `null` stage = not yet in the pipeline.
export const PIPELINE: Stage[] = [
  { id: "lead", name: "Lead", color: "#94a3b8" },
  { id: "contacted", name: "Contacted", color: "#3b82f6" },
  { id: "negotiating", name: "Negotiating", color: "#f59e0b" },
  { id: "won", name: "Won", color: "#22c55e" },
  { id: "lost", name: "Lost", color: "#ef4444" },
];

export const STAGE_IDS = PIPELINE.map((s) => s.id);
