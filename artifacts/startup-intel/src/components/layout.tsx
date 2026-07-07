"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  BarChart2, 
  UploadCloud, 
  Terminal
} from "lucide-react";
import { ReactNode, useEffect } from "react";

export function Layout({ children }: { children: ReactNode }) {
  const location = usePathname();

  // Force dark mode
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const navItems = [
    { href: "/", label: "Dashboard", icon: BarChart2 },
    { href: "/upload", label: "Import CSV", icon: UploadCloud },
  ];

  return (
    <div className="min-h-[100dvh] flex bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col z-10 shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.2)]">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-2 text-primary font-mono font-bold tracking-tight">
            <Terminal className="w-5 h-5" />
            <span>STARTUP_RADAR</span>
          </div>
        </div>
        
        <nav className="flex-1 py-6 px-3 flex flex-col gap-1 overflow-y-auto">
          <div className="px-3 mb-2 text-xs font-mono text-muted-foreground uppercase tracking-widest">
            Modules
          </div>
          {navItems.map((item) => {
            const isActive = location === item.href || 
                            (item.href !== "/" && location.startsWith(item.href));
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center border border-border">
              <span className="text-xs font-mono text-muted-foreground">SYS</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium">System Online</span>
              <span className="text-[10px] text-primary font-mono">v1.0.4_STABLE</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-[100dvh] overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-card/50 pointer-events-none z-0" />
        <div className="flex-1 overflow-y-auto relative z-10 p-6 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
