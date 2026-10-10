"use client";

import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { DashboardNav } from "@/components/dashboard-nav";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { MailboxSelector } from "@/components/mailbox-selector";
import { SidebarAside, MobileMenuButton } from "@/components/sidebar-aside";
import { SidebarResizeBoundary } from "@/components/sidebar-resize-boundary";
import { SidebarProvider } from "@/components/sidebar-state";
import { ShortcutsProvider } from "@/components/shortcuts";

export default function IntegrationsLayout({ children }: { children: React.ReactNode }) {
	return (
		<AuthGuard>
			<SidebarProvider mobileOverlay>
				<MailboxProvider>
					<ComposeProvider>
						<MailSearchProvider>
							<ShortcutsProvider>
								<div className="grid h-dvh grid-cols-[minmax(0,1fr)] overflow-hidden bg-[#f6f8fc] md:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
									<SidebarAside>
										<DashboardNav />
										<SidebarResizeBoundary />
									</SidebarAside>
									<div className="flex min-h-0 min-w-0 flex-col">
										<header className="flex h-16 shrink-0 items-center gap-3 pr-4">
											<MobileMenuButton className="ml-2" />
											<p className="min-w-0 flex-1 px-4 text-sm font-medium text-neutral-600">Connections</p>
											<MailboxSelector />
										</header>
										<main className="min-h-0 flex-1 overflow-y-auto rounded-t-2xl bg-white p-5 md:mr-4 md:rounded-2xl md:p-8">{children}</main>
									</div>
								</div>
								<FloatingComposer />
							</ShortcutsProvider>
						</MailSearchProvider>
					</ComposeProvider>
				</MailboxProvider>
			</SidebarProvider>
		</AuthGuard>
	);
}
