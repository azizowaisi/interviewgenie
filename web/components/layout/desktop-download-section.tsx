import Link from "next/link";
import { Apple, Download, Monitor, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDesktopDownloadLinks } from "@/lib/desktop-downloads";

const platforms = [
  {
    key: "mac" as const,
    label: "macOS",
    hint: ".dmg",
    icon: Apple,
  },
  {
    key: "win" as const,
    label: "Windows",
    hint: ".exe installer",
    icon: Monitor,
  },
  {
    key: "linux" as const,
    label: "Linux",
    hint: "AppImage",
    icon: Terminal,
  },
];

export async function DesktopDownloadSection() {
  const links = getDesktopDownloadLinks();

  return (
    <section id="desktop-app" className="scroll-mt-24">
      <div className="mb-8 text-center md:text-left">
        <h2 className="text-2xl font-semibold md:text-3xl">Desktop application</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Native app for live interview help — same product as the site. Install and sign in with your InterviewGenie
          account.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {platforms.map(({ key, label, hint, icon: Icon }) => {
          const href = links[key];
          const ready = !!href;
          return (
            <Card key={key} className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Icon className="h-6 w-6 shrink-0 text-primary" aria-hidden />
                  {label}
                </CardTitle>
                <CardDescription>{hint}</CardDescription>
              </CardHeader>
              <CardContent>
                {ready ? (
                  <Button className="w-full" asChild>
                    <a href={href} download rel="noopener noreferrer" target="_blank">
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </a>
                  </Button>
                ) : links.releasesPage ? (
                  <Button variant="secondary" className="w-full" asChild>
                    <a href={links.releasesPage} rel="noopener noreferrer" target="_blank">
                      <Download className="mr-2 h-4 w-4" />
                      View releases
                    </a>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">Download link coming soon.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {links.releasesPage ? (
        <p className="mt-4 text-center text-sm text-muted-foreground md:text-left">
          <Link href={links.releasesPage} className="text-primary underline-offset-4 hover:underline">
            All releases
          </Link>
        </p>
      ) : null}
    </section>
  );
}
