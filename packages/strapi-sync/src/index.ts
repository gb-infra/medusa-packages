import { Module } from "@medusajs/framework/utils";
import { UpdateMedusaService } from "@services";

export const CMS_MODULE = "cms";
export default Module(CMS_MODULE, {
  service: UpdateMedusaService,
});
