"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Layout } from "@/components/layout";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Layout>{children}</Layout>
      <Toaster />
    </TooltipProvider>
  );
}
