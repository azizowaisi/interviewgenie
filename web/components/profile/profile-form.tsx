"use client";

import { useEffect, useState } from "react";

import { appFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Language = "en" | "sv";

type UserMe = {
  id: string;
  auth0_id?: string | null;
  email?: string | null;
  name?: string | null;
  language?: string | null;
};

export function ProfileForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setError(null);
      try {
        const r = await appFetch("/users/me");
        if (!r.ok) throw new Error(await r.text());
        const user = (await r.json()) as UserMe;
        if (cancelled) return;
        setEmail(user.email ?? "");
        setName(user.name ?? "");
        setLanguage(user.language === "sv" ? "sv" : "en");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await appFetch("/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, language }),
      });
      if (!r.ok) throw new Error(await r.text());

      const user = (await r.json()) as UserMe;
      setEmail(user.email ?? "");
      setName(user.name ?? "");
      setLanguage(user.language === "sv" ? "sv" : "en");
      setSuccess("Profile updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mx-auto max-w-2xl shadow-md">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Update your email, display name, and language.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading profile...</p>
        ) : (
          <>
            <div className="grid gap-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="profile-language">Language</Label>
              <select
                id="profile-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value === "sv" ? "sv" : "en")}
                className="flex h-10 w-full rounded-xl border border-input bg-secondary/50 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="en">English</option>
                <option value="sv">Swedish</option>
              </select>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {success ? <p className="text-sm text-green-600">{success}</p> : null}

            <div>
              <Button type="button" onClick={onSave} disabled={saving}>
                {saving ? "Saving..." : "Save profile"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
