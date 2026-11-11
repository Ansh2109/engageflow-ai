import type { Metadata } from "next";
import { AutomationList } from "./automation-list";

export const metadata: Metadata = {
  title: "Automations",
};

export default function AutomationsPage() {
  return <AutomationList />;
}
