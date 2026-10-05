"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

function Spinner() {
  return (
    <div className="flex h-dvh items-center justify-center text-fg-muted">
      <Loader2 className="spin" size={22} />
    </div>
  );
}

// Both screens depend on IndexedDB, pdf.js and CodeMirror, which only exist in the browser.
export const DashboardClient = dynamic(() => import("./dashboard/ProjectDashboard"), { ssr: false, loading: Spinner });
export const WorkspaceClient = dynamic(() => import("./editor/Workspace"), { ssr: false, loading: Spinner });
export const JoinClient = dynamic(() => import("./dashboard/JoinProject"), { ssr: false, loading: Spinner });
