import { useEffect } from "react";
import { Database } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

export function InstanceDatabase() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "Database" },
    ]);
  }, [setBreadcrumbs]);

  return (
    <div className="-m-4 md:-m-6 overflow-hidden" style={{ height: "calc(100vh - 4.5rem)" }}>
      <iframe
        src="/api/instance/db-proxy/"
        className="w-full h-full border-0"
        title="muninndb"
      />
    </div>
  );
}
