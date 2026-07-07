import type { Metadata } from "next";
import "@/index.css";
import { AppProviders } from "@/components/app-providers";

export const metadata: Metadata = {
  title: "Startup Radar",
  description: "Internal startup intelligence platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
