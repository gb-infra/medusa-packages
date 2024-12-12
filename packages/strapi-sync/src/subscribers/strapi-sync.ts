import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa";
import { CMS_MODULE } from "..";
import { UpdateStrapiService } from "@services";
import { AuthInterface } from "@types";
import { createProductWorkflow } from "../workflows/strapi-sync/workflows";

export default async function createProductToStrapi({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const updateStrapiService: UpdateStrapiService =
    container.resolve(CMS_MODULE);
  const authInterface: AuthInterface = updateStrapiService.defaultAuthInterface;

  await createProductWorkflow(container).run({
    input: { data, authInterface },
  });
}

export const config: SubscriberConfig = {
  event: "product.created",
};
