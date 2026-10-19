import { AppShell } from "@/components/app-shell";
import { LibraryHydrator } from "@/components/library-hydrator";

/**
 * Everything that is the player rather than something about the player.
 *
 * A route group, so these paths stay exactly where they were -- `/library`,
 * `/search`, `/radio` and the rest are unchanged -- while the sidebar, top bar
 * and player bar apply only to pages inside the player.
 *
 * The landing page sits outside this group and therefore outside all of it.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LibraryHydrator />
      <AppShell>{children}</AppShell>
    </>
  );
}
