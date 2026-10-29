import { Landing } from "@/components/Landing";
import { websiteMetadata } from "@/lib/website-metadata";

export const metadata = websiteMetadata();

export default function LandingPage() {
  return <Landing />;
}
