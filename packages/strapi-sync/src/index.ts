import { Module } from "@medusajs/framework/utils";
import { UpdateStrapiService } from "@services";

export const CMS_MODULE = "cms";
export default Module(CMS_MODULE, {
  service: UpdateStrapiService,
});
