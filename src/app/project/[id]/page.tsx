import type { Metadata } from "next";
import { WorkspaceClient } from "@/components/ClientOnly";

export const metadata: Metadata = {
  title: "Editor",
};

export default async function ProjectPage({ params }: PageProps<"/project/[id]">) {
  const { id } = await params;
  return <WorkspaceClient id={id} />;
}
