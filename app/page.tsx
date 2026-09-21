import Studio from "@/components/studio";
import { CloudProvider } from "@/components/cloud";
export default function Page() {
  return (
    <CloudProvider>
      <Studio />
    </CloudProvider>
  );
}
