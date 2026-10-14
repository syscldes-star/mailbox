"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { apiGet, apiPut, ApiError } from "@/lib/api/client";
import { cardClass, inputClass, primaryButton } from "./ui";

interface Settings {
  postalAddress: string;
  canEdit: boolean;
}

export default function SettingsTab({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [postalAddress, setPostalAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Settings>("/api/email/settings")
      .then((s) => {
        setSettings(s);
        setPostalAddress(s.postalAddress);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load settings."));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await apiPut<Settings>("/api/email/settings", { postalAddress });
      setSettings((s) => (s ? { ...s, ...saved } : s));
      setNotice("Settings saved.");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-slate-400">Loading…</p>;
  }

  const disabled = !settings.canEdit;

  return (
    <form onSubmit={save} className="space-y-4">
      {disabled && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Only admins and owners can change these settings.
        </p>
      )}

      <div className={cardClass}>
        <h2 className="text-sm font-semibold text-slate-900">Business postal address</h2>
        <p className="mt-1 text-xs text-slate-500">
          Shown in the footer of every bulk email. Anti-spam laws (such as CAN-SPAM) require a physical address in
          marketing email, so sending is blocked until this is set.
        </p>
        <textarea
          value={postalAddress}
          onChange={(e) => setPostalAddress(e.target.value)}
          rows={3}
          disabled={disabled}
          placeholder={"Acme Pvt Ltd\n12 MG Road, Bengaluru 560001\nIndia"}
          className={inputClass + " mt-3"}
        />
      </div>

      {!disabled && (
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className={primaryButton}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Save settings
          </button>
          {notice && <span className="text-sm text-emerald-600">{notice}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      )}
    </form>
  );
}
