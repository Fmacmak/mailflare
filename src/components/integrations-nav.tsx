"use client";

import { MessageCircle, UsersRound } from "lucide-react";
import { NavItem } from "./components-nav";
import { integrationDestinations } from "./integrations-nav-utils";
import { useSidebar } from "./sidebar-state";

export function IntegrationsNav() {
	const { minimal } = useSidebar();
	return (
		<div className="mt-4 border-t border-neutral-200/70 pt-3" aria-label="Connections">
			{!minimal && <p className="mb-1 pl-5 text-xs font-medium text-neutral-500">Connections</p>}
			{integrationDestinations.map((destination) => (
				<NavItem key={destination.href} link={{ ...destination, icon: destination.href === "/whatsapp" ? MessageCircle : UsersRound }} />
			))}
		</div>
	);
}
