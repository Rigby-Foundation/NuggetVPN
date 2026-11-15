import { Link } from "react-router";
import { defaultPage } from "@/app/pages";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Ghost } from "lucide-react";
import { EmptyState } from "@/components/Workspace";
import { useT } from "@/lib/i18n";

export default function NotFoundPage() {
  const t = useT();
  return (
    <Page
      title={t("ui.notFound")}
      hideTitle
      className="flex min-h-full justify-center"
    >
      <div data-page-part="1">
        <EmptyState
          icon={Ghost}
          title={t("ui.notFound")}
          description={t("ui.notFoundHint")}
        >
          <Button
            variant="outline"
            className="mt-1 rounded-full border-border/60 bg-card/70"
            render={<Link to={defaultPage} />}
          >
            {t("ui.connectionPage")}
          </Button>
        </EmptyState>
      </div>
    </Page>
  );
}
