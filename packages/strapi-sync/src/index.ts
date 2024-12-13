import { Module } from "@medusajs/framework/utils";
import { UpdateStrapiService } from "@services";

export * from "@utils";
export * from "@services";
export * from "@types";
export * from "@constants";

export const CMS_MODULE = "cms";
export default Module(CMS_MODULE, {
  service: UpdateStrapiService,
});
