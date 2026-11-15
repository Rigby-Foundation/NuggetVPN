import { Link, useRevalidator } from "react-router";
import { defaultPage } from "@/app/pages";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export function PageError() {
  const t = useT();
  const revalidator = useRevalidator();

  return (
    <Page title={t("ui.pageFailed")}>
      <div className="flex gap-2">
        <Button
          onClick={() => void revalidator.revalidate()}
          disabled={revalidator.state !== "idle"}
        >
          {t("ui.retry")}
        </Button>
        <Button variant="outline" render={<Link to={defaultPage} />}>
          {t("ui.connectionPage")}
        </Button>
      </div>
    </Page>
  );
}
