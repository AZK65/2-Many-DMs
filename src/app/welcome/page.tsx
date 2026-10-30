import { Welcome } from "@/components/Welcome";
import { WorkspaceOnboarding } from "@/components/WorkspaceOnboarding";

export const dynamic = "force-dynamic";

export default function WelcomePage() {
  return process.env.OMNI_WORKSPACE_ID ? <WorkspaceOnboarding /> : <Welcome />;
}
