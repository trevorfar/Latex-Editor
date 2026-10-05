import type { Metadata } from "next";
import { JoinClient } from "@/components/ClientOnly";

export const metadata: Metadata = { title: "Join project" };

export default async function JoinPage({ params }: PageProps<"/join/[code]">) {
  const { code } = await params;
  return <JoinClient code={code} />;
}
