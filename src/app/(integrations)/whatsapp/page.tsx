"use client";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { MessageCircle, QrCode, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth/client";
import type { WhatsAppStatus } from "@/lib/whatsapp/types";
const labels: Record<WhatsAppStatus["state"], string> = {
	disconnected: "Not connected",
	connecting: "Connecting…",
	pairing: "Ready to scan",
	connected: "Connected",
	reconnecting: "Reconnecting…",
	expired: "QR code expired",
	error: "Connection needs attention",
};
export default function WhatsAppPage() {
	const [status, setStatus] = useState<WhatsAppStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const refresh = useCallback(async () => {
		try {
			const response = await authFetch("/api/whatsapp", { cache: "no-store" });
			const data = (await response.json()) as WhatsAppStatus;
			if (!response.ok) throw new Error(data.error ?? "Unable to load connection");
			setStatus(data);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to load connection");
		}
	}, []);
	useEffect(() => {
		const initial = setTimeout(() => void refresh(), 0);
		const timer = setInterval(() => void refresh(), 3000);
		return () => {
			clearTimeout(initial);
			clearInterval(timer);
		};
	}, [refresh]);
	async function change(method: "POST" | "DELETE") {
		setBusy(true);
		setError(null);
		try {
			const response = await authFetch("/api/whatsapp", { method });
			const data = (await response.json()) as WhatsAppStatus;
			if (!response.ok) throw new Error(data.error ?? "Unable to update connection");
			setStatus(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unable to update connection");
		} finally {
			setBusy(false);
		}
	}
	const pairing = status && ["connecting", "pairing", "reconnecting"].includes(status.state);
	return (
		<div className="mx-auto max-w-3xl p-6 md:p-10">
			<div className="mb-8 flex items-center gap-3">
				<div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700">
					<MessageCircle className="h-7 w-7" />
				</div>
				<div>
					<h1 className="text-2xl font-semibold text-slate-900">WhatsApp</h1>
					<p className="text-sm text-slate-500">
						Link your account to this Mailflare installation.
					</p>
				</div>
			</div>
			<section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div>
						<h2 className="text-lg font-semibold">Your connection</h2>
						<p aria-live="polite" className="mt-1 text-sm text-slate-500">
							{status ? labels[status.state] : "Loading…"}
							{status?.account ? ` · +${status.account}` : ""}
						</p>
					</div>
					<span
						className={`rounded-full px-3 py-1 text-xs font-medium ${status?.state === "connected" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
					>
						{status?.state === "connected" ? "Linked device" : "Personal account"}
					</span>
				</div>
				{error || status?.error ? (
					<p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">
						{error ?? status?.error}
					</p>
				) : null}
				{status && !status.available ? (
					<div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
						<p className="font-medium text-slate-900">WhatsApp is not enabled on this server.</p>
						<p className="mt-2">
							Your administrator can enable it on the self-hosted Node server. Cloudflare Workers
							cannot run the persistent connection required for pairing.
						</p>
					</div>
				) : null}
				{status?.available && status.state !== "connected" ? (
					<div className="mt-6 grid gap-6 sm:grid-cols-[300px_1fr]">
						<div className="flex min-h-[300px] items-center justify-center rounded-xl border border-slate-200 bg-white">
							{status.qrDataUrl ? (
								<Image
									unoptimized
									src={status.qrDataUrl}
									width={300}
									height={300}
									alt="WhatsApp pairing QR code"
								/>
							) : (
								<div className="px-6 text-center text-slate-400">
									<QrCode className="mx-auto mb-3 h-12 w-12" />
									<p className="text-sm">
										{pairing ? "Waiting for WhatsApp…" : "Connect to generate your QR code."}
									</p>
								</div>
							)}
						</div>
						<div className="self-center">
							<h3 className="font-medium text-slate-900">Scan with WhatsApp on your phone</h3>
							<ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
								<li>Open WhatsApp and go to Settings or the menu.</li>
								<li>Choose Linked devices, then Link a device.</li>
								<li>Scan this QR code. It refreshes automatically.</li>
							</ol>
							<p className="mt-4 text-xs text-slate-500">
								Only your Mailflare user can view this pairing code. Do not share it.
							</p>
						</div>
					</div>
				) : null}
				<div className="mt-6 flex flex-wrap gap-3">
					{status?.available && status.state !== "connected" && !pairing ? (
						<Button disabled={busy} onClick={() => void change("POST")}>
							<QrCode className="mr-2 h-4 w-4" />
							{status.state === "disconnected" ? "Connect WhatsApp" : "Generate new QR code"}
						</Button>
					) : null}
					{status?.available && (pairing || status.state === "connected") ? (
						<Button variant="outline" disabled={busy} onClick={() => void change("DELETE")}>
							<Unplug className="mr-2 h-4 w-4" />
							{pairing ? "Cancel pairing" : "Disconnect"}
						</Button>
					) : null}
					{error ? (
						<Button variant="outline" onClick={() => void refresh()}>
							<RefreshCw className="mr-2 h-4 w-4" />
							Retry
						</Button>
					) : null}
				</div>
			</section>
			<p className="mt-5 text-sm text-slate-500">
				This connects a linked device using Baileys. Connection management is available here;
				WhatsApp conversations and sending will be added separately. Disconnecting removes the saved
				session from this server.
			</p>
		</div>
	);
}
