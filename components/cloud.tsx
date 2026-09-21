"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  ConvexReactClient,
  useConvex,
  useConvexAuth,
  useQuery,
} from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import type { SavedRoom } from "@/lib/room";
import type { Id } from "@/convex/_generated/dataModel";
// Public deployment address, never a provider credential. The fallback keeps
// static client bundles connected when hosting supplies env vars only at runtime.
const url =
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  "https://fleet-cheetah-120.convex.cloud";
const client = url ? new ConvexReactClient(url) : null;
type Cloud = {
  ready: boolean;
  configured: boolean;
  rooms: SavedRoom[] | undefined;
  client: ConvexReactClient | null;
};
const Context = createContext<Cloud>({
  ready: false,
  configured: false,
  rooms: undefined,
  client: null,
});
function Session({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const started = useRef(false);
  const convex = useConvex();
  const rooms = useQuery(api.rooms.list, isAuthenticated ? {} : "skip");
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !started.current) {
      started.current = true;
      void signIn("anonymous").catch(() => {
        started.current = false;
      });
    }
  }, [isLoading, isAuthenticated, signIn]);
  return (
    <Context.Provider
      value={{
        ready: isAuthenticated,
        configured: true,
        rooms: rooms as SavedRoom[] | undefined,
        client: convex,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function CloudProvider({ children }: { children: ReactNode }) {
  return client ? (
    <ConvexAuthProvider client={client}>
      <Session>{children}</Session>
    </ConvexAuthProvider>
  ) : (
    children
  );
}
export const useCloud = () => useContext(Context);
export async function uploadImage(
  client: ConvexReactClient,
  url: string,
): Promise<Id<"_storage">> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Image unavailable");
  const blob = await response.blob();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return client.action(api.files.upload, { data });
}
